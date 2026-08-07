const fs = require('fs');

console.log("Overwriting files with clean, OCR-free code...");

const files = {};

files["lib/parse.ts"] = `import { Diagnostic, ParseResult, Segment, Vec3 } from "./types";

const IN_TO_MM = 25.4;
const KNOWN_G = new Set([0, 1, 2, 3, 20, 21, 90, 91]);
const UNMODELED_MOTION_G = new Set([28, 30, 33, 41, 42, 53, 68, 73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89, 92]);
const CHORD_TOL_MM = 0.05;
const MAX_ARC_STEPS = 256;
const EPS = 1e-9;

type Motion = "rapid" | "linear" | "cw" | "ccw";

function xyDist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function tessellateArc(from: Vec3, to: Vec3, center: { x: number; y: number }, dir: "cw" | "ccw"): Vec3[] {
  const r = Math.hypot(from.x - center.x, from.y - center.y);
  if (r <= CHORD_TOL_MM) return [to];
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let sweep = dir === "ccw" ? a1 - a0 : a0 - a1;
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (sweep < EPS && xyDist(from, to) < EPS) sweep = 2 * Math.PI;
  if (sweep < EPS) return [to];
  const maxStep = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - CHORD_TOL_MM / r)));
  const n = Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(sweep / maxStep)));
  const points: Vec3[] = [];
  for (let i = 1; i <= n; i++) {
    if (i === n) { points.push(to); break; }
    const ang = dir === "ccw" ? a0 + (sweep * i) / n : a0 - (sweep * i) / n;
    points.push({ x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang), z: from.z + ((to.z - from.z) * i) / n });
  }
  return points;
}

function centerFromR(from: Vec3, to: Vec3, r: number, dir: "cw" | "ccw"): { x: number; y: number } | null {
  const d = xyDist(from, to);
  if (d < EPS || d > 2 * Math.abs(r) + 1e-6) return null;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const perp = { x: -(to.y - from.y) / d, y: (to.x - from.x) / d };
  const candidates = [
    { x: mid.x + perp.x * h, y: mid.y + perp.y * h },
    { x: mid.x - perp.x * h, y: mid.y - perp.y * h },
  ];
  const wantMinor = r > 0;
  for (const c of candidates) {
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    const a1 = Math.atan2(to.y - c.y, to.x - c.x);
    let sweep = dir === "ccw" ? a1 - a0 : a0 - a1;
    sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (wantMinor ? sweep <= Math.PI + 1e-6 : sweep >= Math.PI - 1e-6) return c;
  }
  return candidates[0];
}

export function parseGCode(code: string): ParseResult {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const noted = new Set<string>();
  const offsetsUsed: string[] = [];
  const toolsUsed: string[] = [];
  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let feed = 500;
  let feedEverSet = false;
  let motion: Motion = "rapid";
  let units: "mm" | "in" = "mm";
  let incremental = false;
  const note = (key: string, d: Diagnostic) => { if (!noted.has(key)) { noted.add(key); diagnostics.push(d); } };

  code.split(/\\r?\\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.split(";")[0].replace(/\\([^)]*\\)/g, " ").trim();
    if (!line) return;
    const words = line.match(/[A-Za-z][^A-Za-z]*/g) || [];
    const next = { ...pos };
    let localMotion: Motion = motion;
    let localFeed = feed;
    let localFeedSet = false;
    let iVal = 0, jVal = 0, sawIJ = false;
    let rVal: number | null = null;

    for (const w of words) {
      const cmd = w.toUpperCase();
      const letter = cmd[0];
      const value = Number(cmd.slice(1));
      if (cmd === "%") continue;
      if (Number.isNaN(value)) {
        diagnostics.push({ code: "NF105", severity: "error", message: "Unparseable word '" + cmd + "'; the program cannot be validated.", line: lineNo });
        continue;
      }
      const s = units === "in" ? IN_TO_MM : 1;
      if (letter === "G") {
        if (value === 0) localMotion = "rapid";
        else if (value === 1) localMotion = "linear";
        else if (value === 2) localMotion = "cw";
        else if (value === 3) localMotion = "ccw";
        else if (value === 20) units = "in";
        else if (value === 21) units = "mm";
        else if (value === 90) incremental = false;
        else if (value === 91) incremental = true;
        else if (value >= 54 && value <= 59) { const name = "G" + value; if (!offsetsUsed.includes(name)) offsetsUsed.push(name); }
        else if (UNMODELED_MOTION_G.has(value)) note("gmotion" + value, { code: "NF106", severity: "error", message: "G" + value + " commands machine motion that is not modeled; the program cannot be validated.", line: lineNo });
        else if (!KNOWN_G.has(value)) note("g" + value, { code: "NF102", severity: "info", message: "G" + value + " is not modeled and was ignored.", line: lineNo });
      } else if (letter === "X") next.x = incremental ? next.x + value * s : value * s;
      else if (letter === "Y") next.y = incremental ? next.y + value * s : value * s;
      else if (letter === "Z") next.z = incremental ? next.z + value * s : value * s;
      else if (letter === "I") { iVal = value * s; sawIJ = true; }
      else if (letter === "J") { jVal = value * s; sawIJ = true; }
      else if (letter === "K") note("arcK", { code: "NF102", severity: "info", message: "K is ignored; only XY-plane arcs are modeled.", line: lineNo });
      else if (letter === "R") rVal = value * s;
      else if (letter === "F") { localFeed = value * s; localFeedSet = true; feedEverSet = true; }
      else if (letter === "T") { const name = "T" + String(value).padStart(2, "0"); if (!toolsUsed.includes(name)) toolsUsed.push(name); }
      else if (letter === "M" || letter === "N" || letter === "S") {}
      else note("word" + letter, { code: "NF102", severity: "info", message: "Word '" + letter + "' is not modeled and was ignored.", line: lineNo });
    }

    const isArc = localMotion === "cw" || localMotion === "ccw";
    const hasMotion = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z || (isArc && sawIJ && xyDist(pos, next) < EPS && (Math.abs(iVal) > EPS || Math.abs(jVal) > EPS));
    if (hasMotion) {
      const push = (from: Vec3, to: Vec3, m: "rapid" | "linear", arc?: boolean) =>
        segments.push({ from: { ...from }, to: { ...to }, motion: m, feed: localFeed, feedSet: localFeedSet, line: lineNo, ...(arc ? { arc: true } : {}) });
      if ((localMotion === "linear" || isArc) && !feedEverSet) note("nofeed", { code: "NF104", severity: "warning", message: "Cutting move before any F word.", line: lineNo });
      if (isArc) {
        const dir: "cw" | "ccw" = localMotion === "cw" ? "cw" : "ccw";
        let center: { x: number; y: number } | null = null;
        if (rVal !== null) {
          center = centerFromR(pos, next, rVal, dir);
          if (!center) diagnostics.push({ code: "NF103", severity: "error", message: "Arc radius cannot reach endpoint.", line: lineNo });
        } else if (sawIJ) {
          center = { x: pos.x + iVal, y: pos.y + jVal };
          const r0 = Math.hypot(pos.x - center.x, pos.y - center.y);
          const r1 = Math.hypot(next.x - center.x, next.y - center.y);
          if (Math.abs(r0 - r1) > Math.max(0.01, 0.0005 * r0)) diagnostics.push({ code: "NF103", severity: "error", message: "Arc radius mismatch.", line: lineNo });
        } else {
          diagnostics.push({ code: "NF103", severity: "error", message: "Arc move without I/J or R.", line: lineNo });
        }
        if (center) {
          note("arcModeled", { code: "NF100", severity: "info", message: "Arc moves modeled within " + CHORD_TOL_MM + " mm tolerance.", line: lineNo });
          let prev = pos;
          for (const p of tessellateArc(pos, next, center, dir)) { push(prev, p, "linear", true); prev = p; }
        } else {
          push(pos, next, "linear", true);
        }
      } else {
        push(pos, next, localMotion === "rapid" ? "rapid" : "linear");
      }
      pos = next; motion = localMotion; feed = localFeed;
    } else {
      motion = localMotion; feed = localFeed;
    }
  });

  let envelope: { min: Vec3; max: Vec3 } | null = null;
  if (segments.length) {
    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const s of segments) { for (const p of [s.from, s.to]) { min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x); min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y); min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z); } }
    envelope = { min, max };
  }
  return { segments, diagnostics, units, assumptions: { units, offsetsUsed, toolsUsed, envelope } };
}
`;

files["lib/workcell.ts"] = `import { FixtureBox, Workcell } from "./types";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function parseWorkcell(json: string): Workcell {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error("Workcell JSON is invalid."); }
  const limits = raw?.limits;
  if (!limits || !isNum(limits?.min?.x) || !isNum(limits?.max?.x) || !isNum(limits?.min?.y) || !isNum(limits?.max?.y) || !isNum(limits?.min?.z) || !isNum(limits?.max?.z)) throw new Error("Workcell limits are missing or invalid.");
  const fixtures: FixtureBox[] = Array.isArray(raw?.fixtures) ? raw.fixtures.map((f: any) => {
    if (!f || typeof f.name !== "string" || !f.min || !f.max || !isNum(f.min.x) || !isNum(f.max.x)) throw new Error("Fixture '" + (f?.name ?? "?") + "' is malformed.");
    return { name: f.name, min: { x: f.min.x, y: f.min.y ?? 0, z: f.min.z ?? 0 }, max: { x: f.max.x, y: f.max.y ?? 0, z: f.max.z ?? 0 } };
  }) : [];
  return { machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine", limits, rapidFeed: isNum(raw?.rapidFeed) ? raw.rapidFeed : 5000, fixtures, feedLimit: isNum(raw?.feedLimit) ? raw.feedLimit : undefined };
}
`;

files["lib/analyze.ts"] = `import { AnalysisResult, Diagnostic, FixtureBox, MachineState, ParseResult, Vec3, Workcell } from "./types";

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
      if (tool.diameter !== undefined && tool.diameter / 2 > toolRadius) { toolRadius = tool.diameter / 2; toolLabel = t + " (\\u00d8 " + tool.diameter + " mm)"; }
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
`;

files["lib/fix.ts"] = `import { Segment, Workcell } from "./types";

export type FixAction = {
  type: "gcode-edit" | "physical-action";
  description: string;
  autoApplicable: boolean;
};
export type FixSuggestion = { gcode: string; workcell: Workcell; notes: string[]; actions: FixAction[] };

export function suggestFixes(gcode: string, workcell: Workcell, segments: Segment[]): FixSuggestion {
  const actions: FixAction[] = [];
  const cap = workcell.feedLimit ?? 1000;
  const fixedGcode = gcode.split(/\\r?\\n/).map((line) => {
    const clean = line.split(";")[0];
    if (!clean.trim()) return line;
    let changed = false;
    const words = (clean.match(/[A-Za-z][^A-Za-z]*/g) || []).map((w) => {
      const u = w.toUpperCase();
      if (u.startsWith("F") && Number(u.slice(1)) > cap) { changed = true; return "F" + cap; }
      return w;
    });
    return changed ? words.join(" ") : line;
  }).join("\\n");

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of segments) { for (const p of [s.from, s.to]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); } }
  const margin = 20;
  const fixedWorkcell: Workcell = {
    ...workcell,
    fixtures: workcell.fixtures.map((f) => {
      const overlaps = f.max.x >= minX && f.min.x <= maxX && f.max.y >= minY && f.min.y <= maxY && f.max.z >= minZ && f.min.z <= maxZ;
      if (!overlaps) return f;
      const h = f.max.y - f.min.y;
      const newY = maxY + margin;
      actions.push({ type: "physical-action", autoApplicable: false, description: "Move fixture '" + f.name + "' clear of the toolpath bounding box (suggested: min.y = " + newY + "), then update the workcell file to match. Do not edit the file without moving the clamp." });
      return { ...f, min: { x: f.min.x, y: newY, z: f.min.z }, max: { x: f.max.x, y: newY + h, z: f.max.z } };
    })
  };
  if (fixedGcode !== gcode) actions.push({ type: "gcode-edit", autoApplicable: true, description: "Cap programmed feeds at " + cap + " mm/min (the workcell feed limit)." });
  if (actions.length === 0) actions.push({ type: "physical-action", autoApplicable: false, description: "No structural suggestions; review diagnostics manually." });
  return { gcode: fixedGcode, workcell: fixedWorkcell, notes: actions.map((a) => "Suggested: " + a.description), actions };
}
`;

for (const [path, content] of Object.entries(files)) {
  fs.writeFileSync(path, content, 'utf8');
  console.log("Updated " + path);
}

console.log("\nDone! Now run: npm run test");