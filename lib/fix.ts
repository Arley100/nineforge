import { Segment, Workcell } from "./types";
export type FixSuggestion = { gcode: string; workcell: Workcell; notes: string[]; };
export function suggestFixes(gcode: string, workcell: Workcell, segments: Segment[]): FixSuggestion {
  const notes: string[] = [];
  const fixedGcode = gcode.split(/\r?\n/).map((line) => { const clean = line.split(";")[0]; if (!clean.trim()) return line; return clean.split(/\s+/).map((w) => { const u = w.toUpperCase(); if (u.startsWith("F") && Number(u.slice(1)) > 900) return "F900"; return w; }).join(" "); }).join("\n");
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segments) { for (const p of [s.from, s.to]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); } }
  const margin = 20;
  const fixedWorkcell: Workcell = { ...workcell, fixtures: workcell.fixtures.map((f) => { const overlaps = f.max.x >= minX && f.min.x <= maxX && f.max.y >= minY && f.min.y <= maxY; if (!overlaps) return f; const h = f.max.y - f.min.y; const newY = maxY + margin; notes.push("Suggested: move fixture '" + f.name + "' clear of the toolpath bounding box."); return { ...f, min: { x: f.min.x, y: newY, z: f.min.z }, max: { x: f.max.x, y: newY + h, z: f.max.z } }; }) };
  if (fixedGcode !== gcode) notes.push("Suggested: cap programmed feeds at 900 mm/min.");
  if (notes.length === 0) notes.push("No structural suggestions; review diagnostics manually.");
  return { gcode: fixedGcode, workcell: fixedWorkcell, notes };
}