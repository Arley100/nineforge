import { Diagnostic, ParseResult, Segment, Vec3 } from "./types";

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

  code.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.split(";")[0].replace(/\([^)]*\)/g, " ").trim();
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
