import { check } from "../lib/check";
import { RuleSchema } from "../lib/rules";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    const { gcode, workcell, state, rules } = payload;
    
    if (typeof gcode !== "string") throw new Error("gcode must be a string");
    
    const workcellJson = typeof workcell === "string" ? workcell : JSON.stringify(workcell);
    const stateJson = state ? (typeof state === "string" ? state : JSON.stringify(state)) : null;
    
    let parsedRules = undefined;
    if (rules !== undefined && rules !== null) {
      const rulesRes = RuleSchema.safeParse(rules);
      if (!rulesRes.success) {
        throw new Error("Rules validation failed: " + rulesRes.error.message);
      }
      parsedRules = rulesRes.data;
    }
    
    const report = check(gcode, workcellJson, stateJson, parsedRules);
    console.log(JSON.stringify({ result: report }));
    process.exit(0);
  } catch (err: any) {
    console.error(err.message || err);
    process.exit(1);
  }
});
