import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
import { summarize } from "../lib/summarize";
import { PERTURBATIONS } from "../lib/perturb";
function usage(): never { console.log("Usage: npx tsx cli/main.ts check <job.nc> --workcell <cell.json> [--state <state.json>] [--json] [--stress] [--strict]"); process.exit(2); }
const args = process.argv.slice(2);
if (args[0] !== "check" || !args[1]) usage();
const file = args[1];



const asJson = args.includes("--json");
const stress = args.includes("--stress");
const strict = args.includes("--strict");
function flagValue(name: string): string | null { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith("--")) { console.error("NineForge: " + name + " requires a file path."); process.exit(2); } return v; }
function readText(p: string, what: string): string { try { return readFileSync(p, "utf8"); } catch (e) { console.error("NineForge: cannot read " + what + " file: " + p + " (" + (e instanceof Error ? e.message : String(e)) + ")"); process.exit(2); } }
const wcPath = flagValue("--workcell"); if (!wcPath) usage();
const stPath = flagValue("--state");
const gcode = readText(file, "program");
const workcell = parseWorkcell(readText(wcPath, "workcell"));
const state = stPath ? parseState(readText(stPath, "state")) : null;
const result = analyze(parseGCode(gcode), workcell, state);
const stressRows = stress ? PERTURBATIONS.map((p) => { const v = p.apply(gcode, workcell); const r = analyze(parseGCode(v.gcode), v.workcell, state); return { name: p.name, verdict: r.verdict }; }) : [];
if (asJson) { console.log(JSON.stringify({ file, result, stress: stressRows }, null, 2)); } else {
  console.log("NineForge check: " + file);
  console.log("Workcell: " + workcell.machine + (state ? " | state: " + state.control : " | state: none"));
  for (const d of result.diagnostics) console.log("  [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
  console.log("  " + summarize(result));
  if (stress) { const ok = stressRows.filter((s) => s.verdict !== "block").length; console.log("  Stress: survives " + ok + "/" + stressRows.length + " perturbed workcells."); for (const s of stressRows) console.log("    " + (s.verdict === "block" ? "FAIL" : "ok") + "  " + s.name); }
}
const fail = result.verdict === "block" || (strict && result.verdict === "caution") || stressRows.some((s) => s.verdict === "block");
process.exit(fail ? 1 : 0);