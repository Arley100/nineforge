import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
function load(id: string) { return { gcode: readFileSync("public/examples/" + id + ".nc", "utf8"), workcell: parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")), state: parseState(readFileSync("public/examples/" + id + ".state.json", "utf8")) }; }
describe("pre-flight state checks", () => {
  it("blocks a program whose offset and tool are not in the state", () => { const { gcode, workcell, state } = load("mismatch"); const r = analyze(parseGCode(gcode), workcell, state); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF201")).toBe(true); expect(r.diagnostics.some((d) => d.code === "NF202")).toBe(true); });
  it("passes examples against their own state", () => { for (const id of ["bracket", "clean", "overtravel", "messy"]) { const { gcode, workcell, state } = load(id); const withState = analyze(parseGCode(gcode), workcell, state); const without = analyze(parseGCode(gcode), workcell); expect(withState.verdict).toBe(without.verdict); } });
  it("flags a translated envelope that exceeds travel (NF203)", () => { const { gcode, workcell } = load("clean"); const shifted = parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 200, y: 0, z: 0 } }, tools: {} })); const r = analyze(parseGCode(gcode), workcell, shifted); expect(r.diagnostics.some((d) => d.code === "NF203")).toBe(true); });
  it("translates geometry checks by the active offset", () => { const { gcode, workcell } = load("clean"); const ok = parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 10, y: 10, z: 0 } }, tools: {} })); const r = analyze(parseGCode(gcode), workcell, ok); expect(r.diagnostics.filter((d) => d.code === "NF002")).toHaveLength(0); });
  it("rejects invalid state files hard", () => { expect(() => parseState("{ nope")).toThrow(); expect(() => parseState(JSON.stringify({ offsets: { G50: { x: 0, y: 0, z: 0 } } }))).toThrow(); });
});