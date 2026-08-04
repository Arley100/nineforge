import { FixtureBox, Workcell } from "./types";
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
export function parseWorkcell(json: string): Workcell {
  let raw: any; try { raw = JSON.parse(json); } catch { throw new Error("Workcell file is not valid JSON."); }
  const limits = raw?.limits; if (!limits?.min || !limits?.max) throw new Error("Workcell must define limits.min and limits.max.");
  for (const p of [limits.min, limits.max]) { if (!isNum(p.x) || !isNum(p.y) || !isNum(p.z)) throw new Error("Workcell limits must be numeric x/y/z."); }
  const fixtures: FixtureBox[] = Array.isArray(raw.fixtures) ? raw.fixtures.map((f: any, i: number) => { if (!f?.min || !f?.max || !isNum(f.min.x) || !isNum(f.max.x)) throw new Error("Fixture " + i + " must define numeric min and max."); return { name: typeof f.name === "string" ? f.name : "fixture-" + (i + 1), min: f.min, max: f.max }; }) : [];
  return { machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine", units: "mm", limits, rapidFeed: isNum(raw?.rapidFeed) ? raw.rapidFeed : 5000, fixtures, feedLimit: isNum(raw?.feedLimit) ? raw.feedLimit : undefined };
}