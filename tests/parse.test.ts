import { describe, expect, it } from "vitest";
import { parseGCode } from "../lib/parse";
describe("parse", () => {
  it("parses modal motion and feed", () => { const r = parseGCode("G21 G90\nG0 X0 Y0\nG1 X10 Y0 F500\nG1 X20 Y0"); expect(r.segments).toHaveLength(2); expect(r.segments[1].feed).toBe(500); expect(r.segments[1].feedSet).toBe(false); });
  it("converts inches to millimetres", () => { const r = parseGCode("G20 G90\nG0 X0 Y0\nG1 X1 Y0 F100"); expect(r.segments[0].to.x).toBeCloseTo(25.4, 3); expect(r.units).toBe("in"); });
  it("flags arcs as not modeled", () => { const r = parseGCode("G21 G90\nG2 X10 Y0 I5 J0"); expect(r.diagnostics.some((d) => d.code === "NF100")).toBe(true); });
  it("flags incremental mode as unsupported", () => { const r = parseGCode("G91\nG1 X1 Y0 F100"); expect(r.diagnostics.some((d) => d.code === "NF101")).toBe(true); });
  it("ignores comments and parentheses", () => { const r = parseGCode("; hello\nG0 X5 Y5 (rapid)\n"); expect(r.segments).toHaveLength(1); });
});