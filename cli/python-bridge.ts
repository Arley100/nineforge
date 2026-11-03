import { runJob } from "../lib/job";

// stdin: {"gcode", "workcell", "state"?, "rules"?} -> stdout: {"result": Report}. Used by python/nineforge.py.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    console.log(JSON.stringify({ result: runJob(JSON.parse(input)).result }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
});
