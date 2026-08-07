import { readFileSync, writeFileSync } from "node:fs";
import { check } from "../lib/check";
import { toSarif } from "../lib/sarif";

// usage: nineforge-sarif <program.nc> <workcell.json> [state.json] [output.sarif]
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("usage: nineforge-sarif <program.nc> <workcell.json> [state.json] [output.sarif]");
  process.exit(2);
}
const ncPath = args[0];
const wcPath = args[1];
const stPath = args[2];
const outPath = args[3];

const gcode = readFileSync(ncPath, "utf8");
const wcJson = readFileSync(wcPath, "utf8");
const stJson = stPath ? readFileSync(stPath, "utf8") : null;

const report = check(gcode, wcJson, stJson);
// Relative POSIX-style paths so GitHub can map SARIF locations onto repo files.
const uri = ncPath.split("\\").join("/");
const sarif = toSarif(report, uri);
const text = JSON.stringify(sarif, null, 2);

if (outPath) writeFileSync(outPath, text);
else console.log(text);

process.exit(report.verdict === "block" ? 1 : 0);
