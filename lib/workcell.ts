import { FixtureBox, Workcell } from "./types";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function parseWorkcell(json: string): Workcell {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error("Workcell JSON is invalid."); }
  const limits = raw?.limits;
  if (!limits || !isNum(limits?.min?.x) || !isNum(limits?.max?.x) || !isNum(limits?.min?.y) || !isNum(limits?.max?.y) || !isNum(limits?.min?.z) || !isNum(limits?.max?.z)) throw new Error("Workcell limits are missing or invalid.");
  const fixtures: FixtureBox[] = Array.isArray(raw?.fixtures) ? raw.fixtures.map((f: any) => {
    if (!f || typeof f.name !== "string" || !isNum(f.min?.x) || !isNum(f.min?.y) || !isNum(f.min?.z) || !isNum(f.max?.x) || !isNum(f.max?.y) || !isNum(f.max?.z)) throw new Error("Fixture '" + (f?.name ?? "?") + "' is malformed: fixtures need numeric min/max x,y,z.");
    return { name: f.name, min: { x: f.min.x, y: f.min.y, z: f.min.z }, max: { x: f.max.x, y: f.max.y, z: f.max.z } };
  }) : [];
  
  let stock = undefined;
  if (raw?.stock) {
    if (!isNum(raw.stock.min?.x) || !isNum(raw.stock.min?.y) || !isNum(raw.stock.min?.z) || !isNum(raw.stock.max?.x) || !isNum(raw.stock.max?.y) || !isNum(raw.stock.max?.z)) {
      throw new Error("Stock box is malformed: stock needs numeric min/max x,y,z.");
    }
    stock = {
      min: { x: raw.stock.min.x, y: raw.stock.min.y, z: raw.stock.min.z },
      max: { x: raw.stock.max.x, y: raw.stock.max.y, z: raw.stock.max.z }
    };
  }

  return { machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine", limits, rapidFeed: isNum(raw?.rapidFeed) ? raw.rapidFeed : 5000, fixtures, feedLimit: isNum(raw?.feedLimit) ? raw.feedLimit : undefined, stock };
}
