import { FixtureBox, Workcell } from "./types";
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
  
  let stock = undefined;
  if (raw?.stock && isNum(raw.stock.min?.x) && isNum(raw.stock.max?.x)) {
    stock = {
      min: { x: raw.stock.min.x, y: raw.stock.min.y ?? 0, z: raw.stock.min.z ?? 0 },
      max: { x: raw.stock.max.x, y: raw.stock.max.y ?? 0, z: raw.stock.max.z ?? 0 }
    };
  }

  return { machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine", limits, rapidFeed: isNum(raw?.rapidFeed) ? raw.rapidFeed : 5000, fixtures, feedLimit: isNum(raw?.feedLimit) ? raw.feedLimit : undefined, stock };
}
