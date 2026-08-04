import { Diagnostic, ParseResult, Segment, Vec3 } from "./types";
const IN_TO_MM = 25.4;
const KNOWN_G = new Set([0, 1, 2, 3, 20, 21, 90, 91]);
export function parseGCode(code: string): ParseResult {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const noted = new Set<string>();
  const offsetsUsed: string[] = [];
  const toolsUsed: string[] = [];
  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let feed = 500;
  let motion: "rapid" | "linear" = "rapid";
  let units: "mm" | "in" = "mm";
  const note = (key: string, d: Diagnostic) => { if (!noted.has(key)) { noted.add(key); diagnostics.push(d); } };
  code.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.split(";")[0].replace(/\([^)]*\)/g, " ").trim();
    if (!line) return;
    const words = line.split(/\s+/);
    const next = { ...pos };
    let localMotion = motion;
    let localFeed = feed;
    let localFeedSet = false;
    for (const w of words) {
      const cmd = w.toUpperCase();
      const letter = cmd[0];
      const value = Number(cmd.slice(1));
      if (letter === "G") {
        if (value === 0) localMotion = "rapid";
        else if (value === 1) localMotion = "linear";
        else if (value === 20) units = "in";
        else if (value === 21) units = "mm";
        else if (value >= 54 && value <= 59) { const name = "G" + value; if (!offsetsUsed.includes(name)) offsetsUsed.push(name); }
        else if (value === 2 || value === 3) note("arc", { code: "NF100", severity: "info", message: "Arc moves (G2/G3) are not modeled; geometry results are incomplete.", line: lineNo });
        else if (value === 91) note("g91", { code: "NF101", severity: "warning", message: "Incremental positioning (G91) is not supported; coordinates are treated as absolute.", line: lineNo });
        else if (!KNOWN_G.has(value)) note("g" + value, { code: "NF102", severity: "info", message: "G" + value + " is not modeled and was ignored.", line: lineNo });
      } else if (letter === "X") next.x = value;
      else if (letter === "Y") next.y = value;
      else if (letter === "Z") next.z = value;
      else if (letter === "F") { localFeed = value; localFeedSet = true; }
      else if (letter === "T") { const name = "T" + String(value).padStart(2, "0"); if (!toolsUsed.includes(name)) toolsUsed.push(name); }
      else if (letter === "M" || letter === "N" || letter === "S") {}
      else note("word" + letter, { code: "NF102", severity: "info", message: "Word '" + letter + "' is not modeled and was ignored.", line: lineNo });
    }
    const hasMotion = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z;
    if (hasMotion) {
      const s = units === "in" ? IN_TO_MM : 1;
      segments.push({ from: { x: pos.x * s, y: pos.y * s, z: pos.z * s }, to: { x: next.x * s, y: next.y * s, z: next.z * s }, motion: localMotion, feed: localFeed * s, feedSet: localFeedSet, line: lineNo });
      pos = next; motion = localMotion; feed = localFeed;
    } else { motion = localMotion; feed = localFeed; }
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