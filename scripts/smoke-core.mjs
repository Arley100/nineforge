import { check } from "../dist/core/core.mjs";
const wc = { machine: "t", limits: { min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } }, rapidFeed: 1000, fixtures: [] };
const r = check("G21\nG90\nG0 X0 Y0 Z5\nG1 X10 F100\nM30\n", JSON.stringify(wc));
console.log("esm verdict:", r.verdict, "| reportVersion:", r.reportVersion);
if (r.reportVersion !== 1) process.exit(1);
