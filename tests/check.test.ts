import { describe, expect, it } from "vitest";
import { check } from "../lib/check";
import { analyze } from "../lib/analyze";
import { parseGCode } from "../lib/parse";
import { parseWorkcell } from "../lib/workcell";

const wcJson = JSON.stringify({ machine: "t", limits: { min: { x: -250, y: -200, z: -100 }, max: { x: 250, y: 200, z: 100 } }, rapidFeed: 5000, feedLimit: 1000, fixtures: [] });

describe("check() SDK", () => {
  it("returns a versioned report identical to analyze()", () => {
    const gcode = "G21 G90\nG0 Z5\nG1 X10 Y0 F500";
    const r = check(gcode, wcJson, null);
    const direct = analyze(parseGCode(gcode), parseWorkcell(wcJson), null);
    expect(r.reportVersion).toBe(1);
    expect(r.verdict).toBe(direct.verdict);
    expect(r.diagnostics).toEqual(direct.diagnostics);
  });

  it("never throws on invalid workcell JSON; fails closed with NF107", () => {
    const r = check("G21 G90\nG1 X10 Y0 F500", "{ not json", null);
    expect(r.verdict).toBe("block");
    expect(r.diagnostics.some((d) => d.code === "NF107")).toBe(true);
  });

  it("never throws on invalid state JSON; fails closed with NF107", () => {
    const r = check("G21 G90\nG1 X10 Y0 F500", wcJson, "{ nope");
    expect(r.verdict).toBe("block");
    expect(r.diagnostics.some((d) => d.code === "NF107")).toBe(true);
  });
});
