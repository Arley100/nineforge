import { describe, expect, it } from "vitest";
import { analyze, placeSegments } from "../lib/analyze";
import { parseGCode } from "../lib/parse";
import { parseState } from "../lib/state";
import { parseWorkcell } from "../lib/workcell";

const wc = (extra: object = {}) => parseWorkcell(JSON.stringify({ machine: "t", limits: { min: { x: -250, y: -200, z: -100 }, max: { x: 250, y: 200, z: 100 } }, rapidFeed: 5000, feedLimit: 1000, fixtures: [], ...extra }));
const st = (s: object) => parseState(JSON.stringify(s));
const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

describe("parser: fail closed on input it cannot read", () => {
  it("a bare axis letter is unparseable, not zero", () => expect(codes(parseGCode("G0 X"))).toContain("NF105"));
  it("a ';' inside a (comment) cannot leak words into the program", () => expect(parseGCode("(T1; 6mm endmill)\nG0 X1").assumptions.toolsUsed).toEqual([]));
  it("an unclosed '(' comments out the rest of the line", () => expect(parseGCode("G0 X1 (note T9").assumptions.toolsUsed).toEqual([]));
  it("rotary/secondary axes block instead of being silently ignored", () => expect(analyze(parseGCode("G21 G90\nG0 Z5\nG0 A90"), wc()).verdict).toBe("block"));
  for (const g of ["G52 X5", "G10 L2 P1 X5", "G92 X0", "G16", "G51 I2", "G65 P9010", "G38.2 Z-10", "G44 H1", "G54.1 P1"]) {
    it(g + " blocks (NF106) and creates no bogus geometry", () => {
      const p = parseGCode("G21 G90\n" + g);
      expect(codes(p)).toContain("NF106");
      expect(p.segments).toHaveLength(0);
    });
  }
  it("subprogram calls (M98) block", () => expect(codes(parseGCode("M98 P1000"))).toContain("NF106"));
  it("standard CAM preamble codes are not reported as unmodeled", () => expect(codes(parseGCode("G17 G21 G40 G49 G80 G90 G94 G64"))).not.toContain("NF102"));
});

describe("parser: modal state", () => {
  it("G59.1 is a work offset", () => expect(parseGCode("G59.1\nG0 X1").assumptions.offsetsUsed).toEqual(["G59.1"]));
  it("G95 feed per rev stays modal on following lines", () => expect(parseGCode("G21 G90 G95 S1000\nG1 X10 F0.2\nG1 X20").segments.map((s) => s.feed)).toEqual([200, 200]));
  it("units in a block apply before its axis words", () => expect(parseGCode("X1 G20").segments[0].to.x).toBeCloseTo(25.4, 6));
  it("cutting with the spindle off blocks even before any F word", () => expect(analyze(parseGCode("G21 G90\nM5\nG1 X10"), wc()).verdict).toBe("block"));
  it("S0 blocks regardless of word order", () => expect(codes(parseGCode("S0 M3\nG1 X10 F100"))).toContain("NF109"));
  it("G4 dwell X is a time, not a move", () => expect(parseGCode("G4 X2.5").segments).toHaveLength(0));
  it("nothing after M30 runs", () => expect(parseGCode("G0 X1\nM30\nG0 X999").segments).toHaveLength(1));
  it("tracks the tool per move with M6 and preselect", () => {
    const segs = parseGCode("T1 M6\nG0 X1 Y1 Z1\nT2\nG0 X2\nM6\nG0 X3").segments;
    expect(segs.map((s) => s.tool)).toEqual(["T01", "T01", "T02"]);
  });
  it("tracks G43 per move and cancels with G49", () => expect(parseGCode("T3 M6 G43 H3\nG0 Z5\nG49\nG0 Z6").segments.map((s) => s.tlo)).toEqual(["T03", undefined]));
});

describe("parser: arcs in every plane", () => {
  const radiusAbout = (pts: { [k: string]: number }[], a: string, b: string, ca: number, cb: number) => pts.map((p) => Math.hypot(p[a] - ca, p[b] - cb));
  it("G18 arcs use I/K and stay on the XZ circle", () => {
    const p = parseGCode("G21 G90 G18\nG0 X0 Y0 Z0\nG2 X10 Z0 I5 K0 F500");
    expect(codes(p)).not.toContain("NF103");
    for (const r of radiusAbout(p.segments.map((s) => s.to), "x", "z", 5, 0)) expect(r).toBeCloseTo(5, 6);
    expect(p.segments.every((s) => s.to.y === 0)).toBe(true);
  });
  it("G19 arcs use J/K and stay on the YZ circle", () => {
    const p = parseGCode("G21 G90 G19\nG0 X0 Y0 Z0\nG3 Y10 Z0 J5 K0 F500");
    for (const r of radiusAbout(p.segments.map((s) => s.to), "y", "z", 5, 0)) expect(r).toBeCloseTo(5, 6);
    expect(p.segments.every((s) => s.to.x === 0)).toBe(true);
  });
  it("G18 CW bulges toward -Z (viewed from +Y)", () => {
    const zs = parseGCode("G21 G90 G18\nG0 X0 Y0 Z0\nG2 X10 Z0 R5 F500").segments.map((s) => s.to.z);
    expect(Math.min(...zs)).toBeLessThan(-4.9);
  });
});

describe("analyzer", () => {
  it("never invents the start position: WCS at the stock corner is not a rapid-in-stock", () => {
    const r = analyze(parseGCode("G21 G90\nG0 Z5\nG0 X10 Y10\nG1 Z-2 F500\nG1 X20"), wc({ stock: { min: { x: 0, y: 0, z: -10 }, max: { x: 50, y: 50, z: 0 } } }));
    expect(codes(r)).not.toContain("NF006");
    expect(codes(r)).toContain("NF110");
    expect(r.verdict).toBe("pass");
  });
  it("still checks the endpoint of the first fully-positioned move", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X100 Y0 Z0"), wc({ fixtures: [{ name: "c", min: { x: 90, y: -10, z: -5 }, max: { x: 110, y: 10, z: 5 } }] }));
    expect(codes(r)).toContain("NF001");
  });
  it("flags an over-limit feed set on a rapid line where the cut uses it", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X0 F2000\nG1 X10"), wc());
    expect(r.diagnostics.find((d) => d.code === "NF003")?.line).toBe(3);
  });
  it("swapped fixture corners still collide", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X0 Y0 Z5\nG1 Z0 F500\nG1 X200"), wc({ fixtures: [{ name: "c", min: { x: 120, y: 10, z: 20 }, max: { x: 80, y: -10, z: -5 } }] }));
    expect(codes(r)).toContain("NF001");
  });
  it("rejects fixtures that are not an array", () => expect(() => wc({ fixtures: { name: "c" } })).toThrow(/array/));
  it("state tool keys T1, T01 and T001 all match program T1", () => {
    for (const key of ["T1", "T01", "T001"]) expect(codes(analyze(parseGCode("T1 M6\nG0 X1"), wc(), st({ tools: { [key]: { diameter: 6 } } })))).not.toContain("NF202");
  });
  it("checks every operation under its own work offset", () => {
    const fixtures = [{ name: "vise2-jaw", min: { x: 95, y: 20, z: -20 }, max: { x: 105, y: 30, z: 10 } }];
    const prog = "G21 G90\nG54\nG0 X0 Y0 Z5\nG1 Z-1 F500\nG1 X10\nG55\nG0 X0 Y0 Z5\nG1 Y25 F500";
    const state = st({ offsets: { G54: { x: -100, y: 0, z: 0 }, G55: { x: 100, y: 0, z: 0 } } });
    const r = analyze(parseGCode(prog), wc({ fixtures }), state);
    expect(r.diagnostics.find((d) => d.code === "NF001")?.line).toBe(8);
    const placed = placeSegments(parseGCode(prog), state);
    expect(placed.at(-1)!.to.x).toBe(100);
  });
  it("uses each tool's own radius", () => {
    const fixtures = [{ name: "clamp", min: { x: 100, y: 4, z: -5 }, max: { x: 112, y: 20, z: 20 } }];
    const state = st({ tools: { T1: { diameter: 6 }, T2: { diameter: 12 } } });
    const run = (t: number) => analyze(parseGCode("T" + t + " M6\nG21 G90\nG0 X0 Y0 Z0\nG1 X200 F500"), wc({ fixtures }), state);
    expect(codes(run(1))).not.toContain("NF205");
    expect(codes(run(2))).toContain("NF205");
  });
  it("judges low rapids against the stock top", () => {
    const stock = { min: { x: 0, y: 0, z: -20 }, max: { x: 50, y: 50, z: 10 } };
    expect(codes(analyze(parseGCode("G21 G90\nG0 X60 Y60 Z11\nG0 X70"), wc({ stock })))).toContain("NF004");
  });
});

describe("independent review findings", () => {
  const clamp = (min: object, max: object) => ({ fixtures: [{ name: "clamp", min, max }] });
  const vises = st({ offsets: { G54: { x: -150, y: 0, z: 0 }, G55: { x: 100, y: 0, z: 0 } } });
  it("1: a work-offset switch moves the machine, and that traverse is checked", () => {
    const cell = wc(clamp({ x: -30, y: -10, z: -5 }, { x: 30, y: 10, z: 40 }));
    expect(analyze(parseGCode("G21 G90\nG54 G0 X0 Y0 Z10\nG55 X0 Y0 Z10"), cell, vises).verdict).toBe("block");
    expect(analyze(parseGCode("G21 G90\nG54 G0 X0 Y0 Z10\nG55 X1 Y0 Z10"), cell, vises).verdict).toBe("block");
  });
  it("1: incremental moves after a switch continue from the real machine position", () => {
    const cell = wc(clamp({ x: -145, y: -10, z: -5 }, { x: -135, y: 10, z: 40 }));
    expect(analyze(parseGCode("G21 G90\nG54 G0 X0 Y0 Z10\nG55\nG91 G0 X10"), cell, vises).verdict).toBe("block");
  });
  it("2: unknown G-codes and external subprogram calls fail closed", () => {
    for (const g of ["G41.1", "G154 P1", "G110", "G101", "G68.2", "G43.1", "G92.3", "G5.2", "G31 Z-10"]) expect(codes(parseGCode(g))).toContain("NF106");
    expect(codes(parseGCode("M198 P1234"))).toContain("NF106");
  });
  it("3: G43 with the H of a different tool blocks", () => {
    const state = st({ tools: { T1: { length: 50 }, T2: { length: 100 } } });
    expect(codes(analyze(parseGCode("T2 M6\nM3 S1000\nG43 H1 Z50\nG0 X0 Y0\nG1 Z-1 F100"), wc(), state))).toContain("NF207");
    expect(codes(analyze(parseGCode("T1 M6\nM3 S1000\nG43 H1 Z50\nG0 X0 Y0\nT2 M6\nM3\nG0 X0 Y0 Z50"), wc(), state))).toContain("NF207");
  });
  it("4: G50.1 axis words are not a move", () => {
    const r = analyze(parseGCode("G21 G90\nG0 X100 Y100 Z50\nG50.1 X0 Y0\nG0 Z-10"), wc(clamp({ x: 90, y: 90, z: -20 }, { x: 110, y: 110, z: 0 })));
    expect(codes(r)).toContain("NF001");
  });
  it("5: a tool change stops the spindle until M3/M4", () => {
    expect(codes(parseGCode("T1 M6\nG0 X0 Y0 Z5\nG1 Z-1 F100"))).toContain("NF109");
    expect(codes(parseGCode("T1 M6\nS8000 M3\nG0 X0 Y0 Z5\nG1 Z-1 F100"))).not.toContain("NF109");
  });
  it("6: block delete is checked both ways", () => {
    const cell = wc(clamp({ x: 90, y: -10, z: -5 }, { x: 110, y: 10, z: 20 }));
    const optionalEnd = analyze(parseGCode("G21 G90\nG0 X0 Y0 Z50\n/M30\nG0 Z5\nG0 X200"), cell);
    expect(optionalEnd.diagnostics.find((d) => d.code === "NF001")?.message).toContain("block delete on");
    expect(analyze(parseGCode("G21 G90\nG0 X0 Y0 Z5\n/G0 Z50\nG0 X200"), cell).verdict).toBe("block");
  });
  it("7: arc expansion is capped and fails closed", () => {
    const p = parseGCode("G21 G90\nG0 X0 Y0 Z0\n" + "G2 I99999 F100\n".repeat(400));
    expect(p.segments.length).toBeLessThanOrEqual(500_000 + 2048);
    expect(codes(p)).toContain("NF105");
  });
  it("8: an implicit G54 missing from the state blocks", () => {
    expect(codes(analyze(parseGCode("G21 G90\nG0 X0 Y0 Z5"), wc(), st({ offsets: { G55: { x: -100, y: 0, z: 0 } } })))).toContain("NF201");
  });
  it("9: a first move to X0 Y0 Z0 is still checked", () => {
    expect(codes(analyze(parseGCode("G0 X0 Y0 Z0\nM30"), wc(clamp({ x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 }))))).toContain("NF001");
  });
  it("text before the first word blocks instead of being dropped", () => expect(codes(parseGCode("G0 X0 Y0 Z50\n5 G0 Z5"))).toContain("NF105"));
  it("toggling G43 without moving keeps incremental Z moves in the old tool-length context", () => {
    const cell = wc(clamp({ x: -20, y: -20, z: -50 }, { x: 20, y: 20, z: -5 }));
    const r = analyze(parseGCode("G90 G54 T1 M6\nS1000 M3\nG0 X0 Y0 Z50\nG43 H1\nG91 G1 Z-10 F100"), cell, st({ offsets: { G54: { x: 0, y: 0, z: 0 } }, tools: { T1: { length: 50 } } }));
    expect(codes(r)).toContain("NF001");
  });
  it("a tool change only forgets Z: later cuts are checked once Z is set", () => {
    const cell = wc(clamp({ x: 0, y: 30, z: -50 }, { x: 20, y: 40, z: 10 }));
    const r = analyze(parseGCode("G90 G0 X0 Y0 Z5\nT1 M6\nG43 H1 Z5\nS1000 M3\nG1 Z-1 F100\nG1 X50"), cell, st({ tools: { T1: { diameter: 80 } } }));
    expect(codes(r)).toContain("NF205");
  });
  it("cutting from an unknown position is a warning, not a silent pass", () => expect(analyze(parseGCode("G21 G90\nG1 X10 Y0 F500"), wc()).verdict).toBe("caution"));
});
