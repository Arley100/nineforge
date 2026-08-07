import { describe, expect, it } from "vitest";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";

// Deterministic seeded PRNG so the suite is reproducible.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wcJson = (fixtures: unknown[]) => JSON.stringify({
  machine: "prop",
  limits: { min: { x: -500, y: -500, z: -200 }, max: { x: 500, y: 500, z: 200 } },
  rapidFeed: 5000, feedLimit: 1000, fixtures,
});

function randomProgram(rnd: () => number): string {
  const lines = ["G21 G90", "G0 Z5"];
  const n = 3 + Math.floor(rnd() * 8);
  for (let i = 0; i < n; i++) {
    const x = Math.round((rnd() * 400 - 200) * 1000) / 1000;
    const y = Math.round((rnd() * 400 - 200) * 1000) / 1000;
    const rapid = rnd() < 0.3;
    lines.push((rapid ? "G0" : "G1") + " X" + x + " Y" + y + (rapid ? "" : " F" + (200 + Math.floor(rnd() * 1200))));
  }
  return lines.join("\n");
}

describe("property: parser chain continuity", () => {
  it("every segment starts exactly where the previous one ended (200 programs)", () => {
    const rnd = mulberry32(1234);
    for (let k = 0; k < 200; k++) {
      const segs = parseGCode(randomProgram(rnd)).segments;
      for (let i = 1; i < segs.length; i++) expect(segs[i].from).toEqual(segs[i - 1].to);
    }
  });
});

describe("property: unit round-trip stability", () => {
  it("mm and inch renderings of the same path agree", () => {
    const rnd = mulberry32(777);
    for (let k = 0; k < 50; k++) {
      const pts: [number, number][] = [];
      const n = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) pts.push([Math.round(rnd() * 2000) / 100, Math.round(rnd() * 2000) / 100]);
      const mm = ["G21 G90", ...pts.map((p, i) => (i === 0 ? "G0" : "G1") + " X" + p[0] + " Y" + p[1] + " F500")].join("\n");
      const inch = ["G20 G90", ...pts.map((p, i) => (i === 0 ? "G0" : "G1") + " X" + (p[0] / 25.4).toFixed(6) + " Y" + (p[1] / 25.4).toFixed(6) + " F" + (500 / 25.4).toFixed(6))].join("\n");
      const a = parseGCode(mm).segments;
      const b = parseGCode(inch).segments;
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(b[i].to.x).toBeCloseTo(a[i].to.x, 2);
        expect(b[i].to.y).toBeCloseTo(a[i].to.y, 2);
      }
    }
  });
});

describe("property: monotonic fixture growth", () => {
  it("growing a fixture never flips block to pass", () => {
    const rnd = mulberry32(4242);
    for (let k = 0; k < 100; k++) {
      const prog = randomProgram(rnd);
      const x0 = rnd() * 100 - 50, x1 = rnd() * 100 - 50, y0 = rnd() * 100 - 50, y1 = rnd() * 100 - 50;
      const f = { name: "f", min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: -10 }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: 20 } };
      const grown = { ...f, min: { x: f.min.x - 5, y: f.min.y - 5, z: f.min.z }, max: { x: f.max.x + 5, y: f.max.y + 5, z: f.max.z } };
      const v1 = analyze(parseGCode(prog), parseWorkcell(wcJson([f]))).verdict;
      const v2 = analyze(parseGCode(prog), parseWorkcell(wcJson([grown]))).verdict;
      if (v1 === "block") expect(v2).toBe("block");
    }
  });
});

describe("property: finite stats and fail-closed typos", () => {
  it("stats are always finite and injected typos always block", () => {
    const rnd = mulberry32(999);
    for (let k = 0; k < 100; k++) {
      let prog = randomProgram(rnd);
      const injected = k % 2 === 0;
      if (injected) prog = prog + "\nG1 X1..2 Y0 F500"; // double dot => NaN word => NF105 (cannot be split into valid words)
      const r = analyze(parseGCode(prog), parseWorkcell(wcJson([])));
      expect(Number.isFinite(r.stats.distanceMm)).toBe(true);
      expect(Number.isFinite(r.stats.durationSec)).toBe(true);
      if (injected) expect(r.verdict).toBe("block");
    }
  });
});
