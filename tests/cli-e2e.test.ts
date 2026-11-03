import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ex = (f: string) => "public/examples/" + f;
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "cli/main.ts", ...args], { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
};
const tmp = mkdtempSync(join(tmpdir(), "nf-cli-"));
const T = 30_000;

describe("CLI", () => {
  it("an invalid workcell is a fail-closed NF107 block, not a crash", () => {
    writeFileSync(join(tmp, "bad.json"), "{ nope");
    const r = cli("check", ex("clean.nc"), "--workcell", join(tmp, "bad.json"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("NF107");
    expect(r.out).not.toContain("at parseWorkcell");
  }, T);

  it("writes SARIF with a location for every result", () => {
    const out = join(tmp, "m.sarif");
    cli("check", ex("mismatch.nc"), "--workcell", ex("mismatch.workcell.json"), "--state", ex("mismatch.state.json"), "--sarif", out);
    const results = JSON.parse(readFileSync(out, "utf8")).runs[0].results;
    expect(results.map((r: { ruleId: string }) => r.ruleId)).toEqual(expect.arrayContaining(["NF201", "NF202"]));
    expect(results.every((r: { locations: unknown[] }) => r.locations.length === 1)).toBe(true);
  }, T);

  it("keygen -> signed attestation -> verify, and tampering is detected", () => {
    expect(cli("keygen", "--out", join(tmp, "keys")).status).toBe(0);
    expect(cli("keygen", "--out", join(tmp, "keys")).status).toBe(2); // never overwrites a key
    const att = join(tmp, "att.json"), args = [ex("clean.nc"), "--workcell", ex("clean.workcell.json")];
    expect(cli("check", ...args, "--attest", att, "--sign", join(tmp, "keys", "nineforge.key"), "--history", join(tmp, "runs.jsonl")).status).toBe(0);
    const ok = cli("verify", att, "--key", join(tmp, "keys", "nineforge.pub"), "--program", ex("clean.nc"), "--workcell", ex("clean.workcell.json"));
    expect(ok).toMatchObject({ status: 0 });
    expect(ok.out).toContain("VALID");
    const wrongProgram = cli("verify", att, "--program", ex("bracket.nc"));
    expect(wrongProgram.status).toBe(1);
    expect(wrongProgram.out).toContain("program does not match");
    expect(JSON.parse(readFileSync(join(tmp, "runs.jsonl"), "utf8").trim())).toMatchObject({ verdict: "pass" });
    const blocked = join(tmp, "bracket.json");
    cli("check", ex("bracket.nc"), "--workcell", ex("bracket.workcell.json"), "--attest", blocked, "--sign", join(tmp, "keys", "nineforge.key"));
    const authenticBlock = cli("verify", blocked, "--key", join(tmp, "keys", "nineforge.pub"));
    expect(authenticBlock.status).toBe(1); // authentic, but the program must still not run
    expect(authenticBlock.out).toContain("VALID");
  }, T);

  it("suite exits 0 when expectations hold", () => {
    const r = cli("suite", ex("suite.json"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("7/7 jobs match");
  }, T);

  it("custom rules can block (exit 1, JSON output)", () => {
    const r = cli("check", ex("high-feed.nc"), "--workcell", ex("high-feed.workcell.json"), "--rules", ex("custom-rules.yaml"), "--json");
    expect(r.status).toBe(1);
    expect(JSON.parse(r.out).result.diagnostics.map((d: { code: string }) => d.code)).toContain("NO_HIGH_FEED");
  }, T);

  it("a flag missing its value or a missing file exits 2 with a clear error", () => {
    const flag = cli("check", ex("bracket.nc"), "--workcell", ex("bracket.workcell.json"), "--state", "--json");
    expect(flag.status).toBe(2);
    expect(flag.out).toMatch(/--state.*argument/);
    const file = cli("check", "does-not-exist.nc", "--workcell", ex("bracket.workcell.json"));
    expect(file.status).toBe(2);
    expect(file.out).toContain("cannot read program file");
  }, T);

  it("unknown commands and flags are usage errors (exit 2)", () => {
    expect(cli("explode").status).toBe(2);
    expect(cli("check", ex("clean.nc"), "--workcell", ex("clean.workcell.json"), "--nope").status).toBe(2);
  }, T);
});

describe("MCP server", () => {
  it("lists its tools and returns a versioned report", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "mcp/server.ts"], stderr: "ignore" }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["nineforge_check", "nineforge_fix", "nineforge_stress"]);
      const res = await client.callTool({ name: "nineforge_check", arguments: { gcode: readFileSync(ex("bracket.nc"), "utf8"), workcellJson: readFileSync(ex("bracket.workcell.json"), "utf8") } });
      const report = JSON.parse((res.content as { text: string }[])[0].text);
      expect(report).toMatchObject({ reportVersion: 1, verdict: "block" });
      const bad = await client.callTool({ name: "nineforge_fix", arguments: { gcode: "G0 X1", workcellJson: "{ nope" } });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, T);
});

it("built binaries exist after `npm run build:lib` (skipped otherwise)", () => {
  if (!existsSync("dist/cli.mjs")) return;
  const r = spawnSync(process.execPath, ["dist/cli.mjs", "check", ex("clean.nc"), "--workcell", ex("clean.workcell.json")], { encoding: "utf8" });
  expect(r.status).toBe(0);
});
