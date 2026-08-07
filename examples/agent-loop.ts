import { readFileSync } from "node:fs";
import { check } from "../lib/check";
import { suggestFixes } from "../lib/fix";
import { parseGCode } from "../lib/parse";
import { parseWorkcell } from "../lib/workcell";

const gcode0 = readFileSync("public/examples/bracket.nc", "utf8");
const wcJson0 = readFileSync("public/examples/bracket.workcell.json", "utf8");

function codes(r: { diagnostics: { code: string }[] }): string {
  return r.diagnostics.map((d) => d.code).join(", ") || "none";
}

console.log("== NineForge agent loop demo (issue #2 acceptance) ==");

let report = check(gcode0, wcJson0, null);
console.log("attempt 1 verdict: " + report.verdict + " [" + codes(report) + "]");
if (report.verdict !== "block") { console.error("expected block"); process.exit(1); }

const fix = suggestFixes(gcode0, parseWorkcell(wcJson0), parseGCode(gcode0).segments);
const gcode1 = fix.gcode;
report = check(gcode1, wcJson0, null);
console.log("attempt 2 verdict: " + report.verdict + " [" + codes(report) + "] (feed cap auto-applied)");

for (const a of fix.actions) {
  if (a.type === "physical-action") console.log("WORK ORDER (human only): " + a.description);
}

const wcJson1 = JSON.stringify(fix.workcell, null, 2);
report = check(gcode1, wcJson1, null);
console.log("attempt 3 verdict: " + report.verdict + " [" + codes(report) + "]");

if (report.verdict !== "pass") { console.error("loop did not close"); process.exit(1); }
console.log("loop closed: block -> self-correct -> pass");
