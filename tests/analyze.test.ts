import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
function load(id: string) { const gcode = readFileSync("public/examples/" + id + ".nc", "utf8"); const workcell = parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")); return analyze(parseGCode(gcode), workcell); }
describe("analyze on examples", () => {
  it("blocks the bracket job with collision and feed diagnostics", () => { const r = load("bracket"); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF001")).toBe(true); expect(r.diagnostics.some((d) => d.code === "NF003")).toBe(true); });
  it("passes the clean job", () => { expect(load("clean").verdict).toBe("pass"); });
  it("blocks over-travel", () => { const r = load("overtravel"); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF002")).toBe(true); });
  it("passes the messy real-world file", () => { expect(load("messy").verdict).toBe("pass"); });
});
describe("analyze regressions", () => {
  const wc = parseWorkcell(JSON.stringify({ machine: "t", limits: { min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } }, rapidFeed: 5000, fixtures: [] }));
  it("does not flag vertical rapids as low-Z hazards", () => { const r = analyze(parseGCode("G21 G90\nG0 Z5\nG0 Z10"), wc); expect(r.diagnostics.filter((d) => d.code === "NF004")).toHaveLength(0); });
  it("flags feed warnings only where the feed is set", () => { const r = analyze(parseGCode("G21 G90\nG1 X10 Y0 F1500\nG1 X20 Y0"), wc); const feeds = r.diagnostics.filter((d) => d.code === "NF003"); expect(feeds).toHaveLength(1); expect(feeds[0].line).toBe(2); });
});