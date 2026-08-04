import { describe, expect, it } from "vitest";
import { parseWorkcell } from "../lib/workcell";
describe("workcell validation", () => {
  it("rejects invalid JSON", () => { expect(() => parseWorkcell("{ nope")).toThrow(); });
  it("rejects missing limits", () => { expect(() => parseWorkcell(JSON.stringify({ machine: "x" }))).toThrow(); });
  it("accepts a minimal workcell with defaults", () => { const w = parseWorkcell(JSON.stringify({ limits: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } })); expect(w.rapidFeed).toBe(5000); expect(w.fixtures).toEqual([]); });
});