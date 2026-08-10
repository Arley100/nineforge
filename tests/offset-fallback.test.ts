import { expect, test } from "vitest";
import { parseGCode } from "../lib/parse";
import { analyze, activeShift } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
const wc = parseWorkcell(JSON.stringify({ machine: "m", limits: { min: { x: -500, y: -500, z: -500 }, max: { x: 500, y: 500, z: 500 } } }));
test("missing referenced offset does not silently re-anchor to G54", () => {
  const p = parseGCode("G90 G21 G55 X10 Y10");
  const st = parseState(JSON.stringify({ offsets: { G54: { x: 100, y: 0, z: 0 } } }));
  expect(activeShift(p, st)).toEqual({ x: 0, y: 0, z: 0 });
  const r = analyze(p, wc, st);
  expect(r.diagnostics.some((d) => d.code === "NF201")).toBe(true);
  expect(r.verdict).toBe("block");
});
test("no offset referenced: G54 remains the documented default", () => {
  const p = parseGCode("G90 G21 X10 Y10");
  const st = parseState(JSON.stringify({ offsets: { G54: { x: 5, y: 5, z: 0 } } }));
  expect(activeShift(p, st)).toEqual({ x: 5, y: 5, z: 0 });
});
