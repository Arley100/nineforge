import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as analyzeRoute } from "../app/api/analyze/route";
import { POST as batchRoute } from "../app/api/batch/route";
import { GET as openapi } from "../app/api/openapi/route";
import { analyze } from "../lib/analyze";
import { attest, canonical, generateKeys, verifyAttestation } from "../lib/attest";
import { check } from "../lib/check";
import { CODES } from "../lib/codes";
import { suggestFixes } from "../lib/fix";
import { parseGCode } from "../lib/parse";
import { stress } from "../lib/perturb";
import { parseRules } from "../lib/rules";
import { parseState } from "../lib/state";
import { runSuite } from "../lib/suite";
import { parseWorkcell } from "../lib/workcell";
import pkg from "../package.json";

const cell = (extra: object = {}) => JSON.stringify({ machine: "t", limits: { min: { x: -250, y: -200, z: -100 }, max: { x: 250, y: 200, z: 100 } }, rapidFeed: 5000, feedLimit: 1000, fixtures: [], ...extra });
const post = (route: (r: Request) => Promise<Response>, body: unknown) => route(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));

describe("suggestFixes", () => {
  const fixed = (g: string, feedLimit = 1000) => suggestFixes(g, parseWorkcell(cell({ feedLimit }))).gcode;
  it("scales inch feeds instead of comparing them to mm/min", () => {
    const g = fixed("G20 G90\nG1 X1 F60");
    expect(g).toBe("G20 G90\nG1 X1 F39.37");
    expect(analyze(parseGCode(g), parseWorkcell(cell())).diagnostics.map((d) => d.code)).not.toContain("NF003");
  });
  it("scales per-revolution (G95) feeds", () => expect(fixed("G21 G90 G95 S6000\nG1 X10 F0.2")).toContain("F0.1666"));
  it("keeps comments and spacing intact", () => expect(fixed("G21 G90\nG1 X10 (cut F9000) F2000 ; fast")).toBe("G21 G90\nG1 X10 (cut F9000) F1000 ; fast"));
  it("fixes the F word in effect even when it sits on a rapid line", () => expect(fixed("G21 G90\nG0 X0 F2000\nG1 X10")).toBe("G21 G90\nG0 X0 F1000\nG1 X10"));
  it("reads a feed with spaces the way the parser does (F2 000 = 2000)", () => expect(fixed("G21 G90\nG1 X10 F2 000 ; c")).toBe("G21 G90\nG1 X10 F1000 ; c"));
  it("relocates a clamp clear of a large tool, never into it", () => {
    const state = parseState(JSON.stringify({ tools: { T1: { diameter: 80 } } }));
    const clamp = { name: "clamp", min: { x: 40, y: 30, z: -5 }, max: { x: 60, y: 40, z: 10 } };
    const g = "T1 M6\nM3 S1000\nG21 G90\nG0 X0 Y0 Z0\nG1 X100 F500";
    const fix = suggestFixes(g, parseWorkcell(cell({ fixtures: [clamp] })), state);
    expect(fix.workcell.fixtures[0].min.y).toBeGreaterThan(clamp.min.y);
    expect(analyze(parseGCode(g), fix.workcell, state).diagnostics.map((d) => d.code)).not.toContain("NF205");
  });
  it("preserves CRLF line endings", () => expect(fixed("G21 G90\r\nG1 X10 F2000\r\n")).toBe("G21 G90\r\nG1 X10 F1000\r\n"));
  it("moves only fixtures the toolpath actually hits", () => {
    const fixtures = [{ name: "hit", min: { x: 40, y: -5, z: -5 }, max: { x: 60, y: 5, z: 10 } }, { name: "inside-bbox-but-clear", min: { x: 40, y: 15, z: -5 }, max: { x: 60, y: 25, z: 10 } }];
    const fix = suggestFixes("G21 G90\nG0 X0 Y0 Z0\nG1 X100 F500\nG1 Y40\nG1 X0", parseWorkcell(cell({ fixtures })));
    expect(fix.workcell.fixtures[1]).toEqual(fixtures[1]);
    expect(fix.actions.filter((a) => a.type === "physical-action")).toHaveLength(1);
  });
});

describe("stress", () => {
  const cellWithClamp = cell({ fixtures: [{ name: "c", min: { x: 10.5, y: -5, z: -5 }, max: { x: 20, y: 5, z: 5 } }] });
  it("perturbs space-less, commented and incremental programs alike", () => {
    for (const g of ["G21 G90\nG0X0Y0Z0\nG1X10F500", "G21 G90\nG0 X0 Y0 Z0 (start)\nG1 X10 F500 (cut)", "G21 G90\nG0 X0 Y0 Z0\nG91\nG1 X10 F500"]) {
      const rows = stress(g, cellWithClamp);
      expect(rows.find((r) => r.id === "base")!.verdict).toBe("pass");
      expect(rows.find((r) => r.id === "zero+1")!.verdict).toBe("block");
    }
  });
  it("catches a Z touch-off error that cuts into the table", () => {
    const rows = stress("G21 G90\nG0 X0 Y0 Z5\nG1 Z-9.8 F300\nG1 X20", cell({ stock: { min: { x: -10, y: -10, z: -10 }, max: { x: 30, y: 10, z: 0 } } }));
    expect(rows.find((r) => r.id === "zeroz")).toMatchObject({ verdict: "block", codes: ["NF008"] });
  });
  it("applies custom rules under perturbation", () => {
    const rules = parseRules({ version: "1.0", rules: [{ id: "SHOP_FEED", severity: "error", type: "max_feed", params: { max: 600 } }] });
    expect(stress("G21 G90\nG0 X0 Y0 Z0\nG1 X10 F500", cell(), null, rules).find((r) => r.id === "feed125")!.codes).toContain("SHOP_FEED");
  });
});

describe("rules", () => {
  const one = (r: object) => ({ version: "1.0", rules: [{ id: "R", severity: "error", ...r }] });
  it("rejects a typo in params instead of silently disabling the rule", () => expect(() => parseRules(one({ type: "max_feed", params: { maximum: 500 } }))).toThrow(/schema validation/));
  it("parses YAML, JSON text and objects alike", () => {
    const obj = one({ type: "min_z", params: { min: -5 } });
    expect(parseRules(JSON.stringify(obj))).toEqual(parseRules(obj));
    expect(parseRules('version: "1.0"\nrules:\n  - {id: R, severity: error, type: min_z, params: {min: -5}}')).toEqual(parseRules(obj));
  });
  it("min_rapid_z flags horizontal rapids under the clearance plane", () => {
    const r = check("G21 G90\nG0 X0 Y0 Z5\nG0 Z1\nG0 X50", cell(), null, parseRules(one({ type: "min_rapid_z", params: { min: 3 } })));
    expect(r.diagnostics.find((d) => d.code === "R")?.line).toBe(4);
  });
});

describe("REST API", () => {
  const job = { gcode: "G21 G90\nG0 X0 Y0 Z5\nG1 X10 F1000", workcell: JSON.parse(cell()) };
  it("/api/analyze applies custom rules", async () => {
    const res = await post(analyzeRoute, { ...job, rules: 'version: "1.0"\nrules:\n  - {id: SLOW, severity: error, type: max_feed, params: {max: 500}}' });
    expect((await res.json()).result.diagnostics.map((d: { code: string }) => d.code)).toContain("SLOW");
  });
  it("/api/analyze explains a missing workcell", async () => {
    const res = await post(analyzeRoute, { gcode: "G0 X1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("workcell is required");
  });
  it("/api/batch isolates null and oversized jobs", async () => {
    const res = await post(batchRoute, [null, { ...job, gcode: "G0 X0\n".repeat(400_000) }, { id: "ok", ...job }]);
    const { results } = await res.json();
    expect(results[0].error).toMatch(/gcode/);
    expect(results[1].error).toMatch(/too large/);
    expect(results[2]).toMatchObject({ id: "ok", result: { verdict: "pass" } });
  });
  it("/api/openapi reports the package version", async () => expect((await (await openapi()).json()).info.version).toBe(pkg.version));
});

describe("attestations", () => {
  const inputs = { program: "G21 G90\nG0 X0 Y0 Z5", workcell: cell() };
  const report = check(inputs.program, inputs.workcell);
  const keys = generateKeys();
  it("canonical JSON ignores key order", () => expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 })));
  it("a signed attestation verifies against the pinned key and the original inputs", () => {
    const att = attest(report, inputs, keys.privateKey);
    expect(verifyAttestation(att, inputs, keys.publicKey)).toEqual({ ok: true, pinned: true, problems: [] });
  });
  it("detects a tampered verdict, a changed input and a different signer", () => {
    const att = attest(report, inputs, keys.privateKey);
    expect(verifyAttestation({ ...att, report: { ...att.report, verdict: "block" } }).ok).toBe(false);
    expect(verifyAttestation(att, { program: inputs.program + "\nG0 X999" }).problems).toContain("program does not match the attested hash");
    expect(verifyAttestation(att, {}, generateKeys().publicKey).ok).toBe(false);
  });
  it("an unsigned attestation never verifies", () => expect(verifyAttestation(attest(report, inputs)).problems).toContain("attestation is not signed"));
});

describe("regression suites (Gate 4 exit criterion)", () => {
  it("the bundled suite matches every expectation", () => expect(runSuite("public/examples/suite.json").every((r) => r.ok)).toBe(true));
  it("catches a deliberately broken program change on a real workcell", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-suite-"));
    for (const f of readdirSync("public/examples")) copyFileSync(join("public/examples", f), join(dir, f));
    writeFileSync(join(dir, "clean.nc"), readFileSync(join(dir, "clean.nc"), "utf8").replace("G1 X60 Y30", "G1 X200 Y150"));
    const broken = runSuite(join(dir, "suite.json")).find((r) => r.program === "clean.nc")!;
    expect(broken).toMatchObject({ ok: false, expect: "pass", verdict: "block" });
  });
  it("rejects an invalid manifest with a readable error", () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-suite-"));
    writeFileSync(join(dir, "s.json"), JSON.stringify({ jobs: [{ program: "a.nc", expect: "maybe" }] }));
    expect(() => runSuite(join(dir, "s.json"))).toThrow(/invalid/);
  });
});

describe("docs stay honest", () => {
  it("the README diagnostic table lists exactly the built-in codes", () => {
    const readme = readFileSync("README.md", "utf8");
    const documented = [...readme.matchAll(/^\| (NF\d{3}) \|/gm)].map((m) => m[1]).sort();
    expect(documented).toEqual(Object.keys(CODES).sort());
  });
});
