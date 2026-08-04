import { AnalysisResult, Diagnostic, FixtureBox, MachineState, ParseResult, Vec3, Workcell } from "./types";
function pointInBox(p: Vec3, b: FixtureBox): boolean { return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z; }
function segmentIntersectsBox(a: Vec3, b: Vec3, box: FixtureBox): boolean { for (let i = 0; i <= 24; i++) { const t = i / 24; const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; if (pointInBox(p, box)) return true; } return false; }
function outOfLimits(p: Vec3, w: Workcell): boolean { return p.x < w.limits.min.x || p.x > w.limits.max.x || p.y < w.limits.min.y || p.y > w.limits.max.y || p.z < w.limits.min.z || p.z > w.limits.max.z; }
function distance(a: Vec3, b: Vec3): number { return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2); }
export function analyze(parse: ParseResult, workcell: Workcell, state?: MachineState | null): AnalysisResult {
  const diagnostics: Diagnostic[] = [...parse.diagnostics];
  const feedLimit = workcell.feedLimit ?? 1000;
  const a = parse.assumptions;
  let shift: Vec3 = { x: 0, y: 0, z: 0 };
  if (state) {
    for (const o of a.offsetsUsed) { if (!state.offsets[o]) diagnostics.push({ code: "NF201", severity: "error", message: "Program references " + o + " but it is not defined in the machine state." }); }
    for (const t of a.toolsUsed) { if (!state.tools[t]) diagnostics.push({ code: "NF202", severity: "error", message: "Program references " + t + " but it is not present in the tool table." }); }
    
    const primaryName = a.offsetsUsed.find((o) => state.offsets[o]) ?? (state.offsets["G54"] ? "G54" : null);
    if (primaryName && state.offsets[primaryName]) shift = state.offsets[primaryName];

    if (a.envelope) {
      // FIX: If no offsets are explicitly used, check against the default G54 if it exists in the state
      const offsetsToCheck = a.offsetsUsed.length > 0 ? a.offsetsUsed : (state.offsets["G54"] ? ["G54"] : []);
      for (const o of offsetsToCheck) {
        const off = state.offsets[o];
        if (!off) continue;
        const e = a.envelope;
        if (e.min.x + off.x < workcell.limits.min.x || e.max.x + off.x > workcell.limits.max.x || e.min.y + off.y < workcell.limits.min.y || e.max.y + off.y > workcell.limits.max.y || e.min.z + off.z < workcell.limits.min.z || e.max.z + off.z > workcell.limits.max.z) {
          diagnostics.push({ code: "NF203", severity: "error", message: "Work envelope under " + o + " exceeds machine travel." });
        }
      }
    }

    if (a.offsetsUsed.length > 1) diagnostics.push({ code: "NF204", severity: "info", message: "Multiple work offsets referenced; geometry checks use the first defined offset." });
  }
  const add = (p: Vec3): Vec3 => ({ x: p.x + shift.x, y: p.y + shift.y, z: p.z + shift.z });
  let distanceMm = 0, rapidDistanceMm = 0, durationSec = 0;
  for (const seg of parse.segments) {
    const from = add(seg.from); const to = add(seg.to); const d = distance(from, to); distanceMm += d;
    if (seg.motion === "rapid") { rapidDistanceMm += d; durationSec += (d / Math.max(1, workcell.rapidFeed)) * 60; } else { durationSec += (d / Math.max(1, seg.feed)) * 60; }
    if (outOfLimits(from, workcell) || outOfLimits(to, workcell)) diagnostics.push({ code: "NF002", severity: "error", message: "Motion exceeds machine travel limits (line " + seg.line + ").", line: seg.line });
    for (const f of workcell.fixtures) { if (segmentIntersectsBox(from, to, f)) diagnostics.push({ code: "NF001", severity: "error", message: "Toolpath intersects fixture '" + f.name + "' (line " + seg.line + ").", line: seg.line }); }
    if (seg.motion === "linear" && seg.feedSet && seg.feed > feedLimit) diagnostics.push({ code: "NF003", severity: "warning", message: "Feed " + Math.round(seg.feed) + " mm/min exceeds workcell feed limit " + feedLimit + " (line " + seg.line + ").", line: seg.line });
    const horizontal = Math.abs(from.x - to.x) > 0.1 || Math.abs(from.y - to.y) > 0.1;
    if (seg.motion === "rapid" && horizontal && Math.min(from.z, to.z) < 2 && d > 0.1) diagnostics.push({ code: "NF004", severity: "warning", message: "Rapid traverse at low Z (" + Math.min(from.z, to.z).toFixed(2) + ") near line " + seg.line + ".", line: seg.line });
  }
  const seen = new Set<string>();
  const deduped = diagnostics.filter((x) => { const k = x.code + "|" + (x.line ?? 0) + "|" + x.message; if (seen.has(k)) return false; seen.add(k); return true; });
  const verdict = deduped.some((x) => x.severity === "error") ? "block" : deduped.some((x) => x.severity === "warning") ? "caution" : "pass";
  return { diagnostics: deduped, verdict, stats: { segments: parse.segments.length, distanceMm: Math.round(distanceMm), rapidDistanceMm: Math.round(rapidDistanceMm), durationSec: Math.round(durationSec) } };
}