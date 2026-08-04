import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { PERTURBATIONS } from "../lib/perturb";
import { suggestFixes } from "../lib/fix";
function load(id: string) { const gcode = readFileSync("public/examples/" + id + ".nc", "utf8"); const workcell = parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")); return { gcode, workcell }; }
describe("perturbations", () => {
  it("clean job survives all perturbed workcells", () => { const { gcode, workcell } = load("clean"); for (const p of PERTURBATIONS) { const v = p.apply(gcode, workcell); expect(analyze(parseGCode(v.gcode), v.workcell).verdict).not.toBe("block"); } });
  it("bracket job blocks at nominal", () => { const { gcode, workcell } = load("bracket"); expect(analyze(parseGCode(gcode), workcell).verdict).toBe("block"); });
});
describe("suggestFixes", () => {
  it("resolves the bracket job to pass", () => { const { gcode, workcell } = load("bracket"); const segments = parseGCode(gcode).segments; const fix = suggestFixes(gcode, workcell, segments); const r = analyze(parseGCode(fix.gcode), fix.workcell); expect(r.verdict).toBe("pass"); expect(fix.notes.length).toBeGreaterThan(0); });
});