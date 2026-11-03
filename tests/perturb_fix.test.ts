import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { stress } from "../lib/perturb";
import { suggestFixes } from "../lib/fix";
const read = (id: string, ext: string) => readFileSync("public/examples/" + id + ext, "utf8");
describe("perturbations", () => {
  it("clean job survives all perturbed workcells", () => { const rows = stress(read("clean", ".nc"), read("clean", ".workcell.json")); expect(rows.length).toBeGreaterThan(5); expect(rows.every((r) => r.verdict !== "block")).toBe(true); });
  it("bracket job blocks at nominal and reports the failing codes", () => { const [base] = stress(read("bracket", ".nc"), read("bracket", ".workcell.json")); expect(base.verdict).toBe("block"); expect(base.codes).toContain("NF001"); });
  it("returns no rows for an invalid workcell (check() reports NF107)", () => { expect(stress("G0 X1", "{ nope")).toEqual([]); });
});
describe("suggestFixes", () => {
  it("resolves the bracket job to pass", () => { const gcode = read("bracket", ".nc"); const fix = suggestFixes(gcode, parseWorkcell(read("bracket", ".workcell.json"))); const r = analyze(parseGCode(fix.gcode), fix.workcell); expect(r.verdict).toBe("pass"); expect(fix.notes.length).toBeGreaterThan(0); });
});
