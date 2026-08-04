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
const wIdx = args.indexOf("--workcell");
if (wIdx < 0 || !args[wIdx + 1]) usage();
const sIdx = args.indexOf("--state");
const asJson = args.includes("--json");
const stress = args.includes("--stress");
const strict = args.includes("--strict");
const gcode = readFileSync(file, "utf8");
const workcell = parseWorkcell(readFileSync(args[wIdx + 1], "utf8"));
const state = sIdx >= 0 && args[sIdx + 1] ? parseState(readFileSync(args[sIdx + 1], "utf8")) : null;
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