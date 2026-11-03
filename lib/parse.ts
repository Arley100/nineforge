import { Diagnostic, ParseResult, Segment, Vec3 } from "./types";

type Axis = "x" | "y" | "z";
type Frame = NonNullable<Segment["frames"]>[Axis] & {}; // offset (and for Z, tool-length context) a value was programmed in
type Plane = [Axis, Axis, Axis]; // [first, second, normal]: right-handed, so CCW matches the controller

const AXES = ["x", "y", "z"] as const;
const IN_TO_MM = 25.4;
const CHORD_TOL_MM = 0.05;
const MAX_ARC_STEPS = 2048;
export const MAX_SEGMENTS = 500_000;
const EPS = 1e-9;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const PLANES: Record<number, Plane> = { 17: ["x", "y", "z"], 18: ["z", "x", "y"], 19: ["y", "z", "x"] };
const OFFSET_AXIS: Record<string, Axis> = { I: "x", J: "y", K: "z" };
/** Allowlist: modeled, or modal codes that never change the toolpath. Any other G-code blocks (NF106). */
const KNOWN_G = new Set([0, 1, 2, 3, 4, 8, 9, 15, 17, 18, 19, 20, 21, 40, 43, 49, 50, 50.1, 61, 61.1, 62, 63, 64, 67, 69, 80, 90, 91, 91.1, 94, 95, 97, 98, 99, 103, 187]);
/** Known codes whose axis words are parameters, not a destination (dwell time, scaling/mirror cancel). */
const AXES_ARE_PARAMS = new Set([4, 50, 50.1]);
const SUBPROGRAM_M = new Set([97, 98, 99, 198]);

const planar = (a: Vec3, b: Vec3, u: Axis, v: Axis) => Math.hypot(b[u] - a[u], b[v] - a[v]);
const sweepOf = (a0: number, a1: number, ccw: boolean) => { const s = ccw ? a1 - a0 : a0 - a1; return ((s % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); };
const toolName = (n: number) => "T" + String(n).padStart(2, "0");

function tessellateArc(from: Vec3, to: Vec3, c: [number, number], ccw: boolean, [u, v, w]: Plane): Vec3[] {
  const r = Math.hypot(from[u] - c[0], from[v] - c[1]);
  if (r <= CHORD_TOL_MM) return [to];
  const a0 = Math.atan2(from[v] - c[1], from[u] - c[0]);
  let sweep = sweepOf(a0, Math.atan2(to[v] - c[1], to[u] - c[0]), ccw);
  if (sweep < EPS && planar(from, to, u, v) < EPS) sweep = 2 * Math.PI;
  if (sweep < EPS) return [to];
  const maxStep = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - CHORD_TOL_MM / r)));
  const n = Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(sweep / maxStep)));
  const points: Vec3[] = [];
  for (let i = 1; i < n; i++) {
    const ang = ccw ? a0 + (sweep * i) / n : a0 - (sweep * i) / n;
    const p = { ...from };
    p[u] = c[0] + r * Math.cos(ang); p[v] = c[1] + r * Math.sin(ang); p[w] = from[w] + ((to[w] - from[w]) * i) / n;
    points.push(p);
  }
  points.push(to);
  return points;
}

function centerFromR(from: Vec3, to: Vec3, r: number, ccw: boolean, u: Axis, v: Axis): [number, number] | null {
  const d = planar(from, to, u, v);
  if (d < EPS || d > 2 * Math.abs(r) + 1e-6) return null;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
  const mid = [(from[u] + to[u]) / 2, (from[v] + to[v]) / 2];
  const perp = [-(to[v] - from[v]) / d, (to[u] - from[u]) / d];
  const candidates: [number, number][] = [[mid[0] + perp[0] * h, mid[1] + perp[1] * h], [mid[0] - perp[0] * h, mid[1] - perp[1] * h]];
  // Positive R selects the minor arc (<= 180 deg), negative R the major arc.
  for (const c of candidates) {
    const sweep = sweepOf(Math.atan2(from[v] - c[1], from[u] - c[0]), Math.atan2(to[v] - c[1], to[u] - c[0]), ccw);
    if (r > 0 ? sweep <= Math.PI + 1e-6 : sweep >= Math.PI - 1e-6) return c;
  }
  return candidates[0];
}

/**
 * Parses G-code into program-coordinate segments. Lines starting with '/' (block delete) are
 * executed; when there are any, `blockDeleteVariant` holds the parse with them skipped.
 */
export function parseGCode(code: string, skipDeleted = false): ParseResult {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const noted = new Set<string>();
  const note = (key: string, d: Diagnostic) => { if (!noted.has(key)) { noted.add(key); diagnostics.push(d); } };
  const offsetsUsed: string[] = [];
  const toolsUsed: string[] = [];
  // known: the axis value has been programmed absolutely; frames: the context it was programmed in.
  const known = { x: false, y: false, z: false };
  const frames: Record<Axis, Frame> = { x: { wcs: "G54" }, y: { wcs: "G54" }, z: { wcs: "G54" } };
  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let motion: "rapid" | "linear" | "cw" | "ccw" = "rapid";
  let units: "mm" | "in" = "mm";
  let plane = PLANES[17];
  let feed = 500, feedEverSet = false, incremental = false, perRev = false, ended = false, sawDeleted = false;
  let spindle: "unknown" | "on" | "off" = "unknown";
  let speed: number | null = null;
  let wcs: string | undefined, tool: string | undefined, pendingTool: string | undefined, tlo: string | undefined;

  code.split(/\r?\n/).forEach((raw, idx) => {
    if (ended) return; // M2/M30 end the program; anything after never runs
    const line = idx + 1;
    const deleted = /^\s*\//.test(raw);
    sawDeleted ||= deleted;
    if (deleted && skipDeleted) return;
    // Strip (comments) first so a ';' inside parentheses cannot leak words, then ';' comments.
    const text = raw.replace(/\([^)]*\)?/g, " ").split(";")[0].trim();
    if (!text) return;
    if (/[^\s\/%]/.test(text.match(/^[^A-Za-z]*/)![0])) diagnostics.push({ code: "NF105", severity: "error", message: "Unparseable text before the first word on this line; the program cannot be validated.", line });
    // RS274 order of execution: G words (units, distance mode, plane, ...) apply before axis words.
    const isG = (w: string) => Number(w[0].toUpperCase() === "G");
    const words = (text.match(/[A-Za-z][^A-Za-z]*/g) || []).sort((a, b) => isG(b) - isG(a));
    const next = { ...pos };
    const off = { x: 0, y: 0, z: 0 };
    const sawOff = { x: false, y: false, z: false };
    const absolute: Axis[] = [];
    let r: number | null = null;
    let feedSet = false, skipAxes = false, axisWords = false, g43 = false, g49 = false, m6 = false, spindleOn = false, end = false;
    let hTool: string | undefined;

    for (const w of words) {
      const letter = w[0].toUpperCase();
      const num = w.slice(1).replace(/\s+/g, "");
      if (!NUMBER.test(num)) { diagnostics.push({ code: "NF105", severity: "error", message: "Unparseable word '" + w.trim() + "'; the program cannot be validated.", line }); continue; }
      const value = Number(num);
      const s = units === "in" ? IN_TO_MM : 1;
      if (letter === "G") {
        const offset = Number.isInteger(value) ? value >= 54 && value <= 59 : value > 59 && value < 60; // G54-G59, G59.x
        if (offset) { wcs = "G" + value; if (!offsetsUsed.includes(wcs)) offsetsUsed.push(wcs); }
        else if (!KNOWN_G.has(value)) { skipAxes = true; note("g" + value, { code: "NF106", severity: "error", message: "G" + value + " (motion, coordinate transform or unsupported code) is not modeled; the program cannot be validated.", line }); }
        else if (AXES_ARE_PARAMS.has(value)) skipAxes = true;
        else if (value <= 3 && Number.isInteger(value)) motion = (["rapid", "linear", "cw", "ccw"] as const)[value];
        else if (PLANES[value]) plane = PLANES[value];
        else if (value === 20 || value === 21) units = value === 20 ? "in" : "mm";
        else if (value === 43) g43 = true;
        else if (value === 49) g49 = true;
        else if (value === 90 || value === 91) incremental = value === 91;
        else if (value === 94 || value === 95) perRev = value === 95;
      } else if (letter === "X" || letter === "Y" || letter === "Z") {
        if (skipAxes) continue;
        const ax = letter.toLowerCase() as Axis;
        axisWords = true;
        next[ax] = incremental ? next[ax] + value * s : value * s;
        if (!incremental) absolute.push(ax);
      } else if (OFFSET_AXIS[letter]) { off[OFFSET_AXIS[letter]] = value * s; sawOff[OFFSET_AXIS[letter]] = true; }
      else if (letter === "R") r = value * s;
      else if (letter === "F") { feed = value * s; feedSet = feedEverSet = true; }
      else if (letter === "S") speed = value;
      else if (letter === "H") hTool = toolName(value);
      else if (letter === "T") { pendingTool = toolName(value); tool ??= pendingTool; if (!toolsUsed.includes(pendingTool)) toolsUsed.push(pendingTool); }
      else if (letter === "M") {
        if (value === 3 || value === 4) { spindle = "on"; spindleOn = true; }
        else if (value === 5) spindle = "off";
        else if (value === 6) m6 = true;
        else if (value === 2 || value === 30) end = true;
        else if (SUBPROGRAM_M.has(value)) note("m" + value, { code: "NF106", severity: "error", message: "M" + value + " changes program flow (subprogram call/return) in a way that is not modeled; the program cannot be validated.", line });
      } else if ("ABCUVW".includes(letter)) note("axis" + letter, { code: "NF106", severity: "error", message: "Axis word '" + letter + "' (rotary/secondary axis) is not modeled; the program cannot be validated.", line });
      else if (!"NOPQLD".includes(letter)) note("word" + letter, { code: "NF102", severity: "info", message: "Word '" + letter + "' is not modeled and was ignored.", line });
    }
    if (m6) {
      // A tool change retracts Z to the change position (X/Y assumed unchanged) and stops the spindle.
      if (pendingTool) tool = pendingTool;
      if (!spindleOn) spindle = "off";
      known.z = false;
    }
    if (g49) tlo = undefined;
    if (g43) tlo = hTool ?? tool ?? "";
    else if (hTool && tlo !== undefined) tlo = hTool;

    const knownBefore = known.x && known.y && known.z;
    const frameNow = (ax: Axis): Frame => (ax === "z" ? { wcs: wcs ?? "G54", ...(tool ? { tool } : {}), ...(tlo !== undefined ? { tlo } : {}) } : { wcs: wcs ?? "G54" });
    const same = (a: Frame, b: Frame) => a.wcs === b.wcs && a.tool === b.tool && a.tlo === b.tlo;
    const frameChanged = absolute.some((ax) => !same(frames[ax], frameNow(ax)));
    if (!skipAxes) for (const ax of absolute) { known[ax] = true; frames[ax] = frameNow(ax); }
    const knownAfter = known.x && known.y && known.z;
    const anchor = knownBefore ? undefined : knownAfter ? "end" : "none";
    const [u, v] = plane;
    const isArc = motion === "cw" || motion === "ccw";
    const fullCircle = isArc && (sawOff[u] || sawOff[v]) && planar(pos, next, u, v) < EPS && (Math.abs(off[u]) > EPS || Math.abs(off[v]) > EPS);
    const moved = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z || fullCircle;
    // A move to the same program coordinates still matters when it re-anchors or changes work offset.
    if (!skipAxes && (axisWords || fullCircle) && (moved || frameChanged || anchor === "end") && segments.length < MAX_SEGMENTS) {
      const cutting = motion !== "rapid";
      if (cutting && !feedEverSet) note("nofeed", { code: "NF104", severity: "warning", message: "Cutting move before any F word.", line });
      if (cutting && (spindle === "off" || speed === 0)) note("spindleOff", { code: "NF109", severity: "error", message: "Cutting move with spindle off (M5, S0, or no M3/M4 after a tool change); risk of broken tool or jammed part.", line });
      if (cutting && perRev && speed === null) note("g95nospeed", { code: "NF108", severity: "warning", message: "G95 active but no S word set; assuming 1 RPM for feed estimates.", line });
      if (anchor === "none") {
        if (cutting) note("unanchoredCut", { code: "NF111", severity: "warning", message: "Cutting move before X, Y and Z are all programmed; its start position is unknown, so it was not geometry-checked.", line });
        else note("unanchored", { code: "NF110", severity: "info", message: "Start position is unknown until X, Y and Z are all programmed (Z again after a tool change); those rapids are not geometry-checked.", line });
      }
      const stale = AXES.filter((ax) => !same(frames[ax], frameNow(ax)));
      const segFeed = perRev ? feed * Math.max(1, speed ?? 1) : feed;
      const push = (from: Vec3, to: Vec3, arc?: boolean) => segments.push({
        from: { ...from }, to: { ...to }, motion: cutting ? "linear" : "rapid", feed: segFeed, feedSet, line,
        ...(arc ? { arc } : {}), ...(anchor ? { anchor } : {}), ...(wcs ? { wcs } : {}), ...(tool ? { tool } : {}), ...(tlo !== undefined ? { tlo } : {}),
        ...(stale.length ? { frames: Object.fromEntries(stale.map((ax) => [ax, frames[ax]])) } : {}),
      } as Segment);
      if (isArc && moved) {
        const ccw = motion === "ccw";
        let c: [number, number] | null = null;
        if (r !== null) {
          c = centerFromR(pos, next, r, ccw, u, v);
          if (!c) diagnostics.push({ code: "NF103", severity: "error", message: "Arc radius cannot reach the endpoint (or an R-form full circle).", line });
        } else if (sawOff[u] || sawOff[v]) {
          c = [pos[u] + off[u], pos[v] + off[v]];
          const r0 = Math.hypot(pos[u] - c[0], pos[v] - c[1]);
          const r1 = Math.hypot(next[u] - c[0], next[v] - c[1]);
          if (Math.abs(r0 - r1) > Math.max(0.01, 0.0005 * r0)) diagnostics.push({ code: "NF103", severity: "error", message: "Arc radius mismatch.", line });
        } else diagnostics.push({ code: "NF103", severity: "error", message: "Arc move without center offsets (I/J/K) or R.", line });
        if (c) {
          note("arcModeled", { code: "NF100", severity: "info", message: "Arc moves modeled within " + CHORD_TOL_MM + " mm tolerance.", line });
          let prev = pos;
          for (const p of tessellateArc(pos, next, c, ccw, plane)) { push(prev, p, true); prev = p; }
        } else push(pos, next, true);
      } else push(pos, next);
    }
    if (!skipAxes) pos = next;
    if (segments.length >= MAX_SEGMENTS) {
      note("tooBig", { code: "NF105", severity: "error", message: "Program expands to more than " + MAX_SEGMENTS.toLocaleString("en-US") + " moves; it cannot be validated.", line });
      ended = true;
    }
    if (end) ended = true;
  });

  let envelope: ParseResult["assumptions"]["envelope"] = null;
  if (segments.length) {
    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const s of segments) for (const p of [s.from, s.to]) for (const ax of AXES) { min[ax] = Math.min(min[ax], p[ax]); max[ax] = Math.max(max[ax], p[ax]); }
    envelope = { min, max };
  }
  const result: ParseResult = { segments, diagnostics, units, assumptions: { units, offsetsUsed, toolsUsed, envelope } };
  if (sawDeleted && !skipDeleted) result.blockDeleteVariant = parseGCode(code, true);
  return result;
}
