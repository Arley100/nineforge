import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function runCli(args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", "cli/main.ts", ...args], { cwd: root, shell: true, encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}
test("CLI: --state followed by another flag exits 2 with a clear error", () => {
  const r = runCli(["check", "public/examples/bracket.nc", "--workcell", "public/examples/bracket.workcell.json", "--state", "--json"]);
  expect(r.status).toBe(2);
  expect(r.out).toContain("--state requires a file path");
}, 15000);
test("CLI: missing program file exits 2 instead of crashing", () => {
  const r = runCli(["check", "does-not-exist.nc", "--workcell", "public/examples/bracket.workcell.json"]);
  expect(r.status).toBe(2);
  expect(r.out).toContain("cannot read program file");
}, 15000);
