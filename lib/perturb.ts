import { analyze } from "./analyze";
import { parseGCode } from "./parse";
import { RuleFile } from "./rules";
import { parseState } from "./state";
import { Box, MachineState, ParseResult, Vec3, Verdict, Workcell } from "./types";
import { parseWorkcell } from "./workcell";

type Variant = { parse: ParseResult; workcell: Workcell };
export type Perturbation = { id: string; name: string; apply: (v: Variant) => Variant };
export type StressRow = { id: string; name: string; verdict: Verdict; codes: string[] };

const shift = <B extends Box>(b: B, d: Vec3, grow = 0): B => ({
  ...b,
  min: { x: b.min.x + d.x - grow, y: b.min.y + d.y - grow, z: b.min.z + d.z },
  max: { x: b.max.x + d.x + grow, y: b.max.y + d.y + grow, z: b.max.z + d.z },
});
const fixtures = (x: number, y: number, grow = 0) => ({ parse, workcell: w }: Variant): Variant => ({ parse, workcell: { ...w, fixtures: w.fixtures.map((f) => shift(f, { x, y, z: 0 }, grow)) } });
// A work-zero error moves the toolpath against everything else: shift the whole cell the other way.
const zero = (x: number, y: number, z: number) => ({ parse, workcell: w }: Variant): Variant => {
  const d = { x: -x, y: -y, z: -z };
  return { parse, workcell: { ...w, limits: shift(w.limits, d), fixtures: w.fixtures.map((f) => shift(f, d)), ...(w.stock ? { stock: shift(w.stock, d) } : {}) } };
};
const feed = (k: number) => ({ parse, workcell }: Variant): Variant => ({ workcell, parse: { ...parse, segments: parse.segments.map((s) => (s.motion === "linear" ? { ...s, feed: s.feed * k } : s)) } });

export const PERTURBATIONS: Perturbation[] = [
  { id: "base", name: "Nominal workcell", apply: (v) => v },
  { id: "fx+2", name: "Fixture +2mm X", apply: fixtures(2, 0) },
  { id: "fx-2", name: "Fixture -2mm X", apply: fixtures(-2, 0) },
  { id: "fy+2", name: "Fixture +2mm Y", apply: fixtures(0, 2) },
  { id: "fy-2", name: "Fixture -2mm Y", apply: fixtures(0, -2) },
  { id: "zero+1", name: "Work zero +1mm X", apply: zero(1, 0, 0) },
  { id: "zero-1", name: "Work zero -1mm Y", apply: zero(0, -1, 0) },
  { id: "zeroz", name: "Work zero -0.5mm Z (touch-off)", apply: zero(0, 0, -0.5) },
  { id: "wear", name: "Fixture margin +0.5mm", apply: fixtures(0, 0, 0.5) },
  { id: "feed110", name: "Feed override 110%", apply: feed(1.1) },
  { id: "feed125", name: "Feed override 125%", apply: feed(1.25) },
];

/** Re-runs the checks under every perturbation. Inputs that fail to parse yield no rows (check() reports NF107). */
export function stress(gcode: string, workcellJson: string, stateJson?: string | null, rules?: RuleFile): StressRow[] {
  let workcell: Workcell, state: MachineState | null;
  try { workcell = parseWorkcell(workcellJson); state = stateJson?.trim() ? parseState(stateJson) : null; } catch { return []; }
  const parse = parseGCode(gcode);
  return PERTURBATIONS.map((p) => {
    const v = p.apply({ parse, workcell });
    const r = analyze(v.parse, v.workcell, state, rules);
    return { id: p.id, name: p.name, verdict: r.verdict, codes: [...new Set(r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code))] };
  });
}
