import { AnalysisResult, Box, Diagnostic, MachineState, ParseResult, Segment, Vec3, Workcell } from "./types";
import { RuleFile, evaluateRules } from "./rules";

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Exact slab-method test: does the segment a-b touch the box? */
export function segmentIntersectsBox(a: Vec3, b: Vec3, box: Box): boolean {
  let tmin = 0, tmax = 1;
  for (const ax of ["x", "y", "z"] as const) {
    const d = b[ax] - a[ax];
    if (Math.abs(d) < 1e-12) {
      if (a[ax] < box.min[ax] || a[ax] > box.max[ax]) return false;
    } else {
      let t1 = (box.min[ax] - a[ax]) / d;
      let t2 = (box.max[ax] - a[ax]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

const inside = (p: Vec3, b: Box) => p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
const distance = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** The tool radius active on a segment (0 when unknown). */
export const toolRadius = (seg: Segment, state?: MachineState | null) => (seg.tool ? state?.tools[seg.tool]?.diameter ?? 0 : 0) / 2;

/**
 * Box grown by the tool radius in X/Y. Z extends down to -infinity on purpose: the tool,
 * holder and spindle column rise above the tip, so a fixture overhead of the tip is still hit.
 */
export const sweptBox = (f: Box, radius: number): Box => ({ min: { x: f.min.x - radius, y: f.min.y - radius, z: -1e9 }, max: { x: f.max.x + radius, y: f.max.y + radius, z: f.max.z } });

/**
 * Segments in the workcell frame. Each axis is shifted by the work offset it was programmed in
 * and, without G43 length compensation, Z by the tool length (the tip hangs below the spindle
 * nose). Every move starts where the machine actually is: the previous move's end. A move from
 * an unknown position (program start, tool change) starts at its own endpoint.
 * A referenced-but-missing offset (NF201) is never re-anchored to another offset.
 */
export function placeSegments(parse: ParseResult, state?: MachineState | null): Segment[] {
  let prev: Vec3 | null = null;
  return parse.segments.map((s) => {
    const off = (ax: "x" | "y" | "z") => (state?.offsets[s.frames?.[ax]?.wcs ?? s.wcs ?? "G54"] ?? ZERO)[ax];
    const { tool, tlo } = s.frames?.z ?? s;
    const tip = tlo === undefined && tool ? state?.tools[tool]?.length ?? 0 : 0;
    const to = { x: s.to.x + off("x"), y: s.to.y + off("y"), z: s.to.z + off("z") - tip };
    const from = s.anchor || !prev ? to : prev;
    prev = s.anchor === "none" ? null : to;
    return { ...s, from, to };
  });
}

export function analyze(parse: ParseResult, workcell: Workcell, state?: MachineState | null, rules?: RuleFile): AnalysisResult {
  const diagnostics: Diagnostic[] = [...parse.diagnostics];
  const add = (code: string, severity: Diagnostic["severity"], message: string, line?: number) => diagnostics.push({ code, severity, message, ...(line ? { line } : {}) });
  const once = new Set<string>();
  if (workcell.feedLimit === undefined) add("NF005", "info", "Workcell declares no feedLimit; assuming 1000 mm/min for feed checks.");
  const feedLimit = workcell.feedLimit ?? 1000;
  const tools = state?.tools ?? {};
  if (state) {
    for (const o of parse.assumptions.offsetsUsed) if (!state.offsets[o]) add("NF201", "error", "Program references " + o + " but it is not defined in the machine state.");
    for (const t of parse.assumptions.toolsUsed) if (!tools[t]) add("NF202", "error", "Program references " + t + " but it is not present in the tool table.");
    if (Object.keys(state.offsets).length && !state.offsets.G54 && parse.segments.some((s) => !s.wcs)) add("NF201", "error", "Program runs in the default G54 but the machine state does not define it.");
  }
  const stock = workcell.stock;
  const lowZ = (stock?.max.z ?? 0) + 2;
  const overtravel = new Set<string>();
  let distanceMm = 0, rapidDistanceMm = 0, durationSec = 0, lastCutFeed = NaN;
  let rapidInStock = false, cuts = false, cutsStock = false, belowStock = false;

  for (const seg of placeSegments(parse, state)) {
    const cutting = seg.motion === "linear";
    // Feed is modal: warn where an over-limit feed takes effect, even if F was set on a rapid line.
    if (cutting && seg.feed > feedLimit && seg.feed !== lastCutFeed) add("NF003", "warning", "Feed " + Math.round(seg.feed) + " mm/min exceeds workcell feed limit " + feedLimit + " (line " + seg.line + ").", seg.line);
    if (cutting) lastCutFeed = seg.feed;
    // G43 must compensate the tool that is actually loaded ("T2 M6" without "G43 H2" is a classic crash).
    const tloProblem = !state || seg.tlo === undefined ? ""
      : !tools[seg.tlo] ? "references " + (seg.tlo || "no tool") + " which is not present in the tool table"
      : seg.tool && seg.tool !== seg.tlo ? "compensates " + seg.tlo + " but " + seg.tool + " is loaded" : "";
    if (tloProblem && !once.has(tloProblem)) {
      once.add(tloProblem);
      add("NF207", "error", "Tool length compensation (G43) " + tloProblem + "; Z cannot be validated (line " + seg.line + ").", seg.line);
    }
    const length = seg.tool ? tools[seg.tool]?.length : undefined;
    if (seg.tlo === undefined && length !== undefined && !once.has("206" + seg.tool)) {
      once.add("206" + seg.tool);
      add("NF206", "warning", "No tool length compensation (G43) active; assuming the tip of " + seg.tool + " is " + length + " mm below programmed Z.", seg.line);
    }
    if (seg.anchor === "none") continue;

    const { from, to } = seg, d = distance(from, to);
    distanceMm += d;
    if (cutting) durationSec += (d / Math.max(1, seg.feed)) * 60;
    else { rapidDistanceMm += d; durationSec += (d / Math.max(1, workcell.rapidFeed)) * 60; }
    if (!inside(from, workcell.limits) || !inside(to, workcell.limits)) {
      add("NF002", "error", "Motion exceeds machine travel limits (line " + seg.line + ").", seg.line);
      overtravel.add(seg.wcs ?? "G54");
    }
    const radius = toolRadius(seg, state);
    for (const f of workcell.fixtures) {
      if (segmentIntersectsBox(from, to, f)) add("NF001", "error", "Toolpath intersects fixture '" + f.name + "' (line " + seg.line + ").", seg.line);
      else if (radius > 0 && segmentIntersectsBox(from, to, sweptBox(f, radius))) add("NF205", "error", "Tool " + seg.tool + " (Ø " + radius * 2 + " mm) sweeps into fixture '" + f.name + "' (line " + seg.line + "); the centerline clears it by less than the tool radius.", seg.line);
    }
    const horizontal = Math.abs(from.x - to.x) > 0.1 || Math.abs(from.y - to.y) > 0.1;
    if (!cutting && horizontal && Math.min(from.z, to.z) < lowZ && d > 0.1) add("NF004", "warning", "Rapid traverse at low Z (" + Math.min(from.z, to.z).toFixed(2) + ") near line " + seg.line + ".", seg.line);
    if (stock) {
      if (!cutting && segmentIntersectsBox(from, to, stock)) rapidInStock = true;
      if (cutting) {
        cuts = true;
        if (segmentIntersectsBox(from, to, stock)) cutsStock = true;
        if (Math.min(from.z, to.z) < stock.min.z) belowStock = true;
      }
    }
  }

  if (state) for (const o of overtravel) add("NF203", "error", "Work envelope under " + o + " exceeds machine travel.");
  if (stock) {
    if (rapidInStock) add("NF006", "error", "Rapid traverse (G0) intersects the declared stock volume. This is the #1 cause of crashes in hand/agent-edited code.");
    if (belowStock) add("NF008", "error", "Cutting move goes below the bottom of the declared stock (Z < " + stock.min.z + "). Risk of cutting into the table or vise.");
    if (cuts && !cutsStock) add("NF007", "warning", "Air cut: the toolpath contains cutting moves (G1) but none intersect the declared stock volume. Check your work offset.");
  }
  if (rules) diagnostics.push(...evaluateRules(parse, workcell, state ?? null, rules));
  if (parse.blockDeleteVariant) {
    // The operator's block-delete switch decides which path runs: both must be safe.
    const keys = new Set(diagnostics.map((x) => x.code + "|" + x.line + "|" + x.message));
    for (const x of analyze(parse.blockDeleteVariant, workcell, state, rules).diagnostics) if (!keys.has(x.code + "|" + x.line + "|" + x.message)) diagnostics.push({ ...x, message: x.message + " [with block delete on]" });
  }
  if (!Number.isFinite(distanceMm) || !Number.isFinite(durationSec)) add("NF105", "error", "Program produced non-finite geometry; the program cannot be validated.");

  const seen = new Set<string>();
  const deduped = diagnostics.filter((x) => { const k = x.code + "|" + (x.line ?? 0) + "|" + x.message; return !seen.has(k) && !!seen.add(k); });
  const verdict = deduped.some((x) => x.severity === "error") ? "block" : deduped.some((x) => x.severity === "warning") ? "caution" : "pass";
  return { diagnostics: deduped, verdict, stats: { segments: parse.segments.length, distanceMm: Math.round(distanceMm), rapidDistanceMm: Math.round(rapidDistanceMm), durationSec: Math.round(durationSec) } };
}
