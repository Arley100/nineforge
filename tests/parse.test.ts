import { describe, expect, it } from "vitest";
import { parseGCode } from "../lib/parse";
describe("parse", () => {
  it("parses modal motion and feed", () => { const r = parseGCode("G21 G90\nG0 X0 Y0\nG1 X10 Y0 F500\nG1 X20 Y0"); expect(r.segments).toHaveLength(2); expect(r.segments[1].feed).toBe(500); expect(r.segments[1].feedSet).toBe(false); });
  it("converts inches to millimetres", () => { const r = parseGCode("G20 G90\nG0 X0 Y0\nG1 X1 Y0 F100"); expect(r.segments[0].to.x).toBeCloseTo(25.4, 3); expect(r.units).toBe("in"); });
  it("models arcs and discloses chord tolerance", () => { const r = parseGCode("G21 G90\nG2 X10 Y0 I5 J0"); expect(r.diagnostics.some((d) => d.code === "NF100")).toBe(true); expect(r.segments.length).toBeGreaterThan(1); });
  it("supports incremental mode (G91) with correct accumulation", () => { const r = parseGCode("G21 G91\nG1 X1 Y0 F100\nG1 X1 Y0"); expect(r.segments[1].to.x).toBeCloseTo(2, 6); expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0); });
  it("ignores comments and parentheses", () => { const r = parseGCode("; hello\nG0 X5 Y5 (rapid)\n"); expect(r.segments).toHaveLength(1); });
  it("parses space-less words", () => { const r = parseGCode("G21G90\nG1X10Y0F500"); expect(r.segments).toHaveLength(1); expect(r.segments[0].to.x).toBe(10); });
});