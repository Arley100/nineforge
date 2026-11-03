import { placeSegments, segmentIntersectsBox, sweptBox, toolRadius } from "./analyze";
import { parseGCode } from "./parse";
import { Box, MachineState, Workcell } from "./types";

export type FixAction = { type: "gcode-edit" | "physical-action"; description: string; autoApplicable: boolean };
export type FixSuggestion = { gcode: string; workcell: Workcell; notes: string[]; actions: FixAction[] };

const MARGIN = 20;
// Spaces inside a number are ignored by the parser (RS274), so "F1 500" is 1500: match it whole.
const COMMENT_OR_F = /(\([^)]*\)?|;.*$)|F[ \t]*([-+]?(?:\d[\d \t]*\.?[\d \t]*|\.[\d \t]+))/gi;
const codeOf = (line: string) => line.replace(/\([^)]*\)?/g, "").split(";")[0];
const fmt = (x: number) => String(Math.floor(x * 1e4 + 1e-6) / 1e4);

/**
 * Typed suggestions: `gcode-edit` (feed caps an agent may apply) vs `physical-action`
 * (moving a clamp: editing the workcell file does not move the clamp).
 */
export function suggestFixes(gcode: string, workcell: Workcell, state?: MachineState | null): FixSuggestion {
  const actions: FixAction[] = [];
  const parse = parseGCode(gcode);
  const cap = workcell.feedLimit ?? 1000;

  // Scale the F word in effect so the resulting mm/min feed lands on the cap. Scaling (not
  // replacing) keeps inch (G20) and per-revolution (G95) programs correct.
  const lines = gcode.split(/\r?\n/);
  const scale = new Map<number, number>();
  for (const s of parse.segments) {
    if (s.motion !== "linear" || s.feed <= cap) continue;
    let i = s.line - 1;
    while (i >= 0 && !/F/i.test(codeOf(lines[i]))) i--;
    if (i >= 0) scale.set(i, Math.min(scale.get(i) ?? 1, cap / s.feed));
  }
  const fixedGcode = lines.map((l, i) => (scale.has(i) ? l.replace(COMMENT_OR_F, (m, comment, v) => (comment ? m : m[0] + fmt(Number(v.replace(/\s+/g, "")) * scale.get(i)!) + v.match(/\s*$/)![0])) : l)).join(gcode.includes("\r\n") ? "\r\n" : "\n");
  if (scale.size) actions.push({ type: "gcode-edit", autoApplicable: true, description: "Cap programmed feeds at " + cap + " mm/min (the workcell feed limit)." });

  // Only fixtures the toolpath (or the tool radius) actually hits are moved, to a spot it then clears.
  const placed = placeSegments(parse, state).filter((s) => s.anchor !== "none");
  const hits = (b: Box) => placed.some((s) => { const r = toolRadius(s, state); return segmentIntersectsBox(s.from, s.to, r > 0 ? sweptBox(b, r) : b); });
  const margin = MARGIN + Math.max(0, ...new Set(placed.map((s) => toolRadius(s, state))));
  const lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
  for (const s of placed) for (const p of [s.from, s.to]) for (const ax of ["x", "y"] as const) { lo[ax] = Math.min(lo[ax], p[ax]); hi[ax] = Math.max(hi[ax], p[ax]); }
  const { limits } = workcell;
  const fixtures = workcell.fixtures.map((f) => {
    if (!hits(f)) return f;
    const w = f.max.x - f.min.x, h = f.max.y - f.min.y;
    const at = (desc: string, x: number, y: number) => ({ desc, min: { x, y, z: f.min.z }, max: { x: x + w, y: y + h, z: f.max.z } });
    const options = [at("+Y", f.min.x, hi.y + margin), at("-Y", f.min.x, lo.y - margin - h), at("+X", hi.x + margin, f.min.y), at("-X", lo.x - margin - w, f.min.y)];
    const fit = options.find((o) => o.min.x >= limits.min.x && o.max.x <= limits.max.x && o.min.y >= limits.min.y && o.max.y <= limits.max.y && !hits(o));
    const pick = fit ?? options[0];
    actions.push({ type: "physical-action", autoApplicable: false, description: "Move fixture '" + f.name + "' clear of the toolpath bounding box (" + (fit ? pick.desc : "suggested: min.y = " + pick.min.y + ", outside travel") + "), then update the workcell file to match. Do not edit the file without moving the clamp." });
    return { name: f.name, min: pick.min, max: pick.max };
  });

  if (!actions.length) actions.push({ type: "physical-action", autoApplicable: false, description: "No structural suggestions; review diagnostics manually." });
  return { gcode: fixedGcode, workcell: { ...workcell, fixtures }, notes: actions.map((a) => "Suggested: " + a.description), actions };
}
