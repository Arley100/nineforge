import { MachineState, Vec3 } from "./types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec = (v: any): v is Vec3 => v && isNum(v.x) && isNum(v.y) && isNum(v.z);

export function parseState(json: string): MachineState {
  let raw: any;
  try { raw = JSON.parse(json); } catch { throw new Error("Machine state file is not valid JSON."); }
  const offsets: Record<string, Vec3> = {};
  for (const [k, v] of Object.entries(raw?.offsets ?? {})) {
    if (!/^G5[4-9](\.\d+)?$/.test(k)) throw new Error("Offset '" + k + "' is not a supported work offset (G54-G59.x).");
    if (!isVec(v)) throw new Error("Offset " + k + " must be numeric x/y/z.");
    offsets[k] = { x: v.x, y: v.y, z: v.z };
  }
  const tools: MachineState["tools"] = {};
  for (const [k, v] of Object.entries(raw?.tools ?? {})) {
    if (!/^T\d+$/.test(k)) throw new Error("Tool '" + k + "' must be named T<n> (e.g. T1 or T01).");
    const t: any = v ?? {};
    // Same key the parser uses: T1, T01 and T001 all name tool 1.
    tools["T" + String(Number(k.slice(1))).padStart(2, "0")] = { diameter: isNum(t.diameter) ? t.diameter : undefined, length: isNum(t.length) ? t.length : undefined };
  }
  return { control: typeof raw?.control === "string" ? raw.control : "unspecified", offsets, tools };
}
