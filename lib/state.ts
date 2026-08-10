import { MachineState, Vec3 } from "./types";
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isVec(v: any): v is Vec3 { return v && isNum(v.x) && isNum(v.y) && isNum(v.z); }
export function parseState(json: string): MachineState {
  let raw: any; try { raw = JSON.parse(json); } catch { throw new Error("Machine state file is not valid JSON."); }
  const offsets: Record<string, Vec3> = {};
  if (raw?.offsets && typeof raw.offsets === "object") { for (const [k, v] of Object.entries(raw.offsets)) { if (!/^G5[4-9]$/.test(k)) throw new Error("Offset '" + k + "' is not a supported work offset (G54-G59)."); if (!isVec(v)) throw new Error("Offset " + k + " must be numeric x/y/z."); offsets[k] = v; } }
  const tools: Record<string, { diameter?: number; length?: number }> = {};
  if (raw?.tools && typeof raw.tools === "object") { for (const [k, v] of Object.entries(raw.tools)) { if (!/^T\d{2}$/.test(k)) throw new Error("Tool '" + k + "' must be named Tnn (e.g. T01)."); const t: any = v ?? {}; const normalizedKey = "T" + k.slice(1).padStart(2, "0");
      tools[normalizedKey] = { diameter: isNum(t.diameter) ? t.diameter : undefined, length: isNum(t.length) ? t.length : undefined }; } }
  return { control: typeof raw?.control === "string" ? raw.control : "unspecified", offsets, tools };
}