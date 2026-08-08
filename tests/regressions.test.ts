import { describe, expect, it } from "vitest";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
import { suggestFixes } from "../lib/fix";

const baseWc = (fixtures: unknown[] = [], feedLimit?: number) => parseWorkcell(JSON.stringify({
  machine: "t",
  limits: { min: { x: -250, y: -200, z: -100 }, max: { x: 250, y: 200, z: 100 } },
  rapidFeed: 5000,
  ...(feedLimit !== undefined ? { feedLimit } : {}),
  fixtures,
}));

describe("fail-closed parsing", () => {
  it("blocks a program with an unparseable coordinate word", () => {
    const r = analyze(parseGCode("G21 G90\nG0 Z5\nG1 X1.2.3 Y0 F500\nG1 Z-2"), baseWc([], 1000));
    expect(r.verdict).toBe("block");
    expect(r.diagnostics.some((d) => d.code === "NF105")).toBe(true);
    expect(Number.isFinite(r.stats.distanceMm)).toBe(true);
  });
  it("never reports NaN stats", () => {
    const r = analyze(parseGCode("G1 Xabc F500"), baseWc([], 1000));
    expect(Number.isFinite(r.stats.distanceMm)).toBe(true);
    expect(Number.isFinite(r.stats.durationSec)).toBe(true);
  });
});

describe("exact collision", () => {
  it("catches a 5mm fixture on a 440mm segment", () => {
    const wc = baseWc([{ name: "thin-post", min: { x: 94, y: -5, z: -5 }, max: { x: 99, y: 5, z: 20 } }], 1000);
    const r = analyze(parseGCode("G21 G90\nG0 Z10\nG0 X-200 Y0\nG1 Z0 F500\nG1 X240 Y0"), wc);
    expect(r.verdict).toBe("block");
    expect(r.diagnostics.some((d) => d.code === "NF001")).toBe(true);
  });
});

describe("arcs", () => {
  it("blocks an arc that bulges through a clamp its chord misses", () => {
    const wc = baseWc([{ name: "clamp", min: { x: 100, y: -44, z: -5 }, max: { x: 112, y: -36, z: 20 } }], 1000);
    const r = analyze(parseGCode("G21 G90\nG0 Z0\nG0 X80 Y-50\nG2 X132 Y-50 R40 F500"), wc);
    expect(r.diagnostics.some((d) => d.code === "NF001")).toBe(true);
    expect(r.verdict).toBe("block");
  });
  it("passes a valid IJK arc in open space", () => {
    const r = analyze(parseGCode("G21 G90\nG0 Z5\nG0 X0 Y0\nG2 X10 Y0 I5 J0 F500"), baseWc([], 1000));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === "NF100")).toBe(true);
  });
  it("blocks an IJK arc whose endpoint radius does not match", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X0 Y0\nG2 X10 Y3 I5 J0 F500"), baseWc([], 1000));
    expect(r.diagnostics.some((d) => d.code === "NF103")).toBe(true);
    expect(r.verdict).toBe("block");
  });
  it("blocks an arc with no I/J or R", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X0 Y0\nG2 X10 Y0 F500"), baseWc([], 1000));
    expect(r.diagnostics.some((d) => d.code === "NF103")).toBe(true);
  });
});

describe("units", () => {
  it("keeps earlier mm coordinates intact after a unit switch", () => {
    const r = parseGCode("G21 G90\nG0 X100 Y0\nG20\nG1 X5 Y0 F10");
    expect(r.segments[1].from.x).toBeCloseTo(100, 6);
    expect(r.segments[1].to.x).toBeCloseTo(127, 6);
  });
});

describe("fixes", () => {
  it("caps feeds at the declared workcell limit", () => {
    const wc = baseWc([], 500);
    const seg = parseGCode("G21 G90\nG1 X10 Y0 F1200").segments;
    const fix = suggestFixes("G21 G90\nG1 X10 Y0 F1200", wc, seg);
    expect(fix.gcode).toContain("F500");
    const r = analyze(parseGCode(fix.gcode), fix.workcell);
    expect(r.diagnostics.filter((d) => d.code === "NF003")).toHaveLength(0);
    expect(fix.actions.some((x) => x.type === "gcode-edit")).toBe(true);
  });
});

describe("honest defaults", () => {
  it("discloses an assumed feed limit when the workcell omits one", () => {
    const r = analyze(parseGCode("G21 G90\nG1 X10 Y0 F500"), baseWc());
    expect(r.diagnostics.some((d) => d.code === "NF005")).toBe(true);
  });
  it("warns when a cutting move happens before any F word", () => {
    const r = analyze(parseGCode("G21 G90\nG1 X10 Y0"), baseWc([], 1000));
    expect(r.diagnostics.some((d) => d.code === "NF104")).toBe(true);
    expect(r.verdict).toBe("caution");
  });
});

describe("fail-closed semantics for unmodeled motion", () => {
  it("models G91 incremental coordinates correctly instead of misreading them as absolute", () => {
    const p = parseGCode("G21 G91\nG1 X10 Y0 F100\nG1 X10 Y0");
    expect(p.segments[0].to.x).toBeCloseTo(10, 6);
    expect(p.segments[1].to.x).toBeCloseTo(20, 6);
    const r = analyze(p, baseWc([], 1000));
    expect(r.verdict).toBe("pass");
  });
  it("degrades canned cycles to at least caution", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X10 Y10\nG81 Z-5 R2 F200"), baseWc([], 1000));
    expect(r.verdict).not.toBe("pass");
  });
});

describe("tool geometry", () => {
  it("blocks a centerline that clears a clamp by less than the tool radius", () => {
    const wc = baseWc([{ name: "clamp", min: { x: 100, y: 5, z: -5 }, max: { x: 112, y: 20, z: 20 } }], 1000);
    const state = parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 0, y: 0, z: 0 } }, tools: { T01: { diameter: 12 } } }));
    const r = analyze(parseGCode("G21 G90\nT01 M6\nG0 Z0\nG0 X0 Y0\nG1 X200 Y0 F500"), wc, state);
    expect(r.diagnostics.some((d) => d.code === "NF205")).toBe(true);
    expect(r.verdict).toBe("block");
  });
});

describe("Stock model and air-cut detection", () => {
  it("blocks rapid traverse inside the stock volume (NF006)", () => {
    const wc = baseWc([], 1000);
    wc.stock = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
    const r = analyze(parseGCode("G21 G90\nG0 Z0\nG0 X5 Y0"), wc);
    expect(r.diagnostics.some((d) => d.code === "NF006")).toBe(true);
    expect(r.verdict).toBe("block");
  });

  it("warns on air-cut when G1 moves miss the stock entirely (NF007)", () => {
    const wc = baseWc([], 1000);
    // Place stock away from the origin (0,0,0) so the initial rapid moves don't trigger NF006
    wc.stock = { min: { x: 20, y: 20, z: -10 }, max: { x: 40, y: 40, z: 10 } };
    const r = analyze(parseGCode("G21 G90\nG0 Z15\nG0 X50 Y50\nG1 Z-2 F500\nG1 X60 Y50"), wc);
    expect(r.diagnostics.some((d) => d.code === "NF007")).toBe(true);
    expect(r.verdict).toBe("caution");
  });

  it("blocks cutting below the stock bottom into the table (NF008)", () => {
    const wc = baseWc([], 1000);
    wc.stock = { min: { x: -10, y: -10, z: 0 }, max: { x: 10, y: 10, z: 10 } };
    const r = analyze(parseGCode("G21 G90\nG0 Z5\nG1 Z-5 F500\nG1 X5 Y0"), wc);
    expect(r.diagnostics.some((d) => d.code === "NF008")).toBe(true);
    expect(r.verdict).toBe("block");
  });
});


describe("tool length offsets", () => {
  const clampWc = () => baseWc([{ name: "clamp", min: { x: 100, y: -10, z: -5 }, max: { x: 120, y: 10, z: 5 } }], 1000);
  const toolState = () => parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 0, y: 0, z: 0 } }, tools: { T01: { diameter: 6, length: 50 } } }));

  it("assumes the tip hangs below programmed Z when G43 is missing (NF206)", () => {
    const r = analyze(parseGCode("G21 G90\nT01 M6\nG0 Z50\nG0 X110 Y0"), clampWc(), toolState());
    expect(r.diagnostics.some((d) => d.code === "NF206")).toBe(true);
    expect(r.diagnostics.some((d) => d.code === "NF001")).toBe(true);
    expect(r.verdict).toBe("block");
  });

  it("G43 makes the tip follow programmed Z", () => {
    const r = analyze(parseGCode("G21 G90\nT01 M6\nG43 H01\nG0 Z50\nG0 X110 Y0"), clampWc(), toolState());
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(r.verdict).toBe("pass");
  });

  it("G43 with an unknown H reference fails closed (NF207)", () => {
    const r = analyze(parseGCode("G21 G90\nT01 M6\nG43 H02\nG0 Z50"), clampWc(), toolState());
    expect(r.diagnostics.some((d) => d.code === "NF207")).toBe(true);
    expect(r.verdict).toBe("block");
  });
});


describe("G95 feed per revolution", () => {
  it("multiplies F by S when G95 is active", () => {
    const r = parseGCode("G21 G90 G95\nS1000\nG1 X10 Y0 F0.2");
    expect(r.segments[0].feed).toBeCloseTo(200, 5);
  });
  it("warns when G95 is active but no S word is set (NF108)", () => {
    const r = parseGCode("G21 G90 G95\nG1 X10 Y0 F0.2");
    expect(r.diagnostics.some((d) => d.code === "NF108")).toBe(true);
  });
  it("reverts to G94 correctly", () => {
    const r = parseGCode("G21 G90 G95\nS1000\nG1 X10 Y0 F0.2\nG94\nG1 X20 Y0 F200");
    expect(r.segments[0].feed).toBeCloseTo(200, 5);
    expect(r.segments[1].feed).toBe(200);
  });
});


describe("spindle state", () => {
  it("blocks cutting moves when the spindle is explicitly off (NF109)", () => {
    const r = analyze(parseGCode("G21 G90\nG0 Z5\nM5\nG1 X10 Y0 F500"), baseWc([], 1000));
    expect(r.diagnostics.some((d) => d.code === "NF109")).toBe(true);
    expect(r.verdict).toBe("block");
  });
  it("passes when M3 is active", () => {
    const r = analyze(parseGCode("G21 G90\nM3 S1000\nG0 Z5\nG1 X10 Y0 F500"), baseWc([], 1000));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(r.verdict).toBe("pass");
  });
  it("blocks when S0 is programmed", () => {
    const r = analyze(parseGCode("G21 G90\nM3 S0\nG0 Z5\nG1 X10 Y0 F500"), baseWc([], 1000));
    expect(r.diagnostics.some((d) => d.code === "NF109")).toBe(true);
    expect(r.verdict).toBe("block");
  });
});
