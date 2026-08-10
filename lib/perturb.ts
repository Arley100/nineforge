import { Workcell } from "./types";
export type Perturbation = { id: string; name: string; apply: (gcode: string, workcell: Workcell) => { gcode: string; workcell: Workcell }; };
function shiftFixture(w: Workcell, dx: number, dy: number): Workcell { return { ...w, fixtures: w.fixtures.map((f) => ({ ...f, min: { x: f.min.x + dx, y: f.min.y + dy, z: f.min.z }, max: { x: f.max.x + dx, y: f.max.y + dy, z: f.max.z } })) }; }
function growFixtures(w: Workcell, margin: number): Workcell { return { ...w, fixtures: w.fixtures.map((f) => ({ ...f, min: { x: f.min.x - margin, y: f.min.y - margin, z: f.min.z }, max: { x: f.max.x + margin, y: f.max.y + margin, z: f.max.z } })) }; }
function shiftCoords(gcode: string, dx: number, dy: number): string {
  if (/\bG91\b/i.test(gcode)) {
    // In incremental mode, shifting every coordinate word changes relative step sizes.
    // A true work-zero shift requires tracking modal state; skip to avoid physically wrong geometry.
    return gcode;
  }
  return gcode.split(/\r?\n/).map((line) => {
    const clean = line.split(";")[0];
    if (!clean.trim()) return line;
    return clean.split(/\s+/).map((w) => {
      const u = w.toUpperCase();
      if (u.startsWith("X")) return "X" + (Number(u.slice(1)) + dx);
      if (u.startsWith("Y")) return "Y" + (Number(u.slice(1)) + dy);
      return w;
    }).join(" ");
  }).join("\n");
}
function scaleFeeds(gcode: string, factor: number): string { return gcode.split(/\r?\n/).map((line) => { const clean = line.split(";")[0]; if (!clean.trim()) return line; return clean.split(/\s+/).map((w) => { const u = w.toUpperCase(); if (u.startsWith("F")) return "F" + Math.round(Number(u.slice(1)) * factor); return w; }).join(" "); }).join("\n"); }
export const PERTURBATIONS: Perturbation[] = [
  { id: "base", name: "Nominal workcell", apply: (g, w) => ({ gcode: g, workcell: w }) },
  { id: "fx+2", name: "Fixture +2mm X", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 2, 0) }) },
  { id: "fx-2", name: "Fixture -2mm X", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, -2, 0) }) },
  { id: "fy+2", name: "Fixture +2mm Y", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 0, 2) }) },
  { id: "fy-2", name: "Fixture -2mm Y", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 0, -2) }) },
  { id: "zero+1", name: "Work zero +1mm X", apply: (g, w) => ({ gcode: shiftCoords(g, 1, 0), workcell: w }) },
  { id: "zero-1", name: "Work zero -1mm Y", apply: (g, w) => ({ gcode: shiftCoords(g, 0, -1), workcell: w }) },
  { id: "wear", name: "Fixture margin +0.5mm", apply: (g, w) => ({ gcode: g, workcell: growFixtures(w, 0.5) }) },
  { id: "feed110", name: "Feed override 110%", apply: (g, w) => ({ gcode: scaleFeeds(g, 1.1), workcell: w }) },
  { id: "feed125", name: "Feed override 125%", apply: (g, w) => ({ gcode: scaleFeeds(g, 1.25), workcell: w }) },
];