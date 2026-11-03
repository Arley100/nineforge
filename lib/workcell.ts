import { Box, Workcell } from "./types";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Validates a box and normalizes its corners, so swapped min/max can never hide a collision. */
function box(raw: any, what: string): Box {
  const ok = (p: any) => p && isNum(p.x) && isNum(p.y) && isNum(p.z);
  if (!ok(raw?.min) || !ok(raw?.max)) throw new Error(what + " is malformed: it needs numeric min/max x, y, z.");
  const [a, b] = [raw.min, raw.max];
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) } };
}

export function parseWorkcell(json: string): Workcell {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error("Workcell JSON is invalid."); }
  if (!raw || typeof raw !== "object") throw new Error("Workcell JSON must be an object.");
  if (raw.fixtures !== undefined && !Array.isArray(raw.fixtures)) throw new Error("Workcell 'fixtures' must be an array.");
  const fixtures = (raw.fixtures ?? []).map((f: any) => {
    if (typeof f?.name !== "string") throw new Error("Every fixture needs a string 'name'.");
    return { name: f.name, ...box(f, "Fixture '" + f.name + "'") };
  });
  return {
    machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine",
    limits: box(raw.limits, "Workcell limits"),
    rapidFeed: isNum(raw.rapidFeed) ? raw.rapidFeed : 5000,
    feedLimit: isNum(raw.feedLimit) ? raw.feedLimit : undefined,
    fixtures,
    ...(raw.stock ? { stock: box(raw.stock, "Stock box") } : {}),
  };
}
