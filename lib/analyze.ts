import { AnalysisResult, Diagnostic, FixtureBox, MachineState, ParseResult, Vec3, Workcell } from "./types";

function segmentIntersectsBox(a: Vec3, b: Vec3, box: FixtureBox): boolean {
  let tmin = 0, tmax = 1;
  for (const ax of ["x", "y", "z"] as const) {
    const d = b[ax] - a[ax];
    if (Math.abs(d) < 1e-12) {
      if (a[ax] < box.min[ax] || a[ax] > box.max[ax]) return false;
    } else {
      let t1 = (box.min[ax] - a[ax]) / d;
      let t2 = (box.max[ax] - a[ax]) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

function outOfLimits(p: Vec3, w: Workcell): boolean {
  return p.x < w.limits.min.x || p.x > w.limits.max.x || p.y < w.limits.min.y || p.y > w.limits.max.y || p.z < w.limits.min.z || p.z > w.limits.max.z;
}

function distance(a: Vec3, b: Vec3): number { return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2); }

export function activeShift(parse: ParseResult, state?: MachineState | null): Vec3 {
  if (!state) return { x: 0, y: 0, z: 0 };
  const a = parse.assumptions;
  const primaryName = a.offsetsUsed.find((o) => state.offsets[o]) ?? (state.offsets["G54"] ? "G54" : null);
  return primaryName && state.offsets[primaryName] ? state.offsets[primaryName] : { x: 0, y: 0, z: 0 };
}

function sweptBox(f: FixtureBox, radius: number): FixtureBox {
  return { name: f.name, min: { x: f.min.x - radius, y: f.min.y - radius, z: -1e9 }, max: { x: f.max.x + radius, y: f.max.y + radius, z: f.max.z } };
}

export function analyze(parse: ParseResult, workcell: Workcell, state?: MachineState | null): AnalysisResult {
  const diagnostics: Diagnostic[] = [...parse.diagnostics];
  if (workcell.feedLimit === undefined) diagnostics.push({ code: "NF005", severity: "info", message: "Workcell declares no feedLimit; assuming 1000 mm/min for feed checks." });
  const feedLimit = workcell.feedLimit ?? 1000;
  const a = parse.assumptions;
  const shift = activeShift(parse, state);
  let toolRadius = 0;
  let toolLabel = "";
  if (state) {
    for (const o of a.offsetsUsed) { if (!state.offsets[o]) diagnostics.push({ code: "NF201", severity: "error", message: "Program references " + o + " but it is not defined in the machine state." }); }
    for (const t of a.toolsUsed) {
      const tool = state.tools[t];
      if (!tool) { diagnostics.push({ code: "NF202", severity: "error", message: "Program references " + t + " but it is not present in the tool table." }); continue; }
      if (tool.diameter !== undefined && tool.diameter / 2 > toolRadius) { toolRadius = tool.diameter / 2; toolLabel = t + " (\u00d8 " + tool.diameter + " mm)"; }
    }
    if (a.envelope) {
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
    for (const f of workcell.fixtures) {
      if (segmentIntersectsBox(from, to, f)) diagnostics.push({ code: "NF001", severity: "error", message: "Toolpath intersects fixture '" + f.name + "' (line " + seg.line + ").", line: seg.line });
      else if (toolRadius > 0 && segmentIntersectsBox(from, to, sweptBox(f, toolRadius))) diagnostics.push({ code: "NF205", severity: "error", message: "Tool " + toolLabel + " sweeps into fixture '" + f.name + "' (line " + seg.line + "); the centerline clears it by less than the tool radius.", line: seg.line });
    }
    if (seg.motion === "linear" && seg.feedSet && seg.feed > feedLimit) diagnostics.push({ code: "NF003", severity: "warning", message: "Feed " + Math.round(seg.feed) + " mm/min exceeds workcell feed limit " + feedLimit + " (line " + seg.line + ").", line: seg.line });
    const horizontal = Math.abs(from.x - to.x) > 0.1 || Math.abs(from.y - to.y) > 0.1;
    if (seg.motion === "rapid" && horizontal && Math.min(from.z, to.z) < 2 && d > 0.1) diagnostics.push({ code: "NF004", severity: "warning", message: "Rapid traverse at low Z (" + Math.min(from.z, to.z).toFixed(2) + ") near line " + seg.line + ".", line: seg.line });
  }
  if (!Number.isFinite(distanceMm) || !Number.isFinite(durationSec)) diagnostics.push({ code: "NF105", severity: "error", message: "Program produced non-finite geometry; the program cannot be validated." });
  const seen = new Set<string>();
  const deduped = diagnostics.filter((x) => { const k = x.code + "|" + (x.line ?? 0) + "|" + x.message; if (seen.has(k)) return false; seen.add(k); return true; });
  const verdict = deduped.some((x) => x.severity === "error") ? "block" : deduped.some((x) => x.severity === "warning") ? "caution" : "pass";
  return { diagnostics: deduped, verdict, stats: { segments: parse.segments.length, distanceMm: Math.round(distanceMm), rapidDistanceMm: Math.round(rapidDistanceMm), durationSec: Math.round(durationSec) } };
}
