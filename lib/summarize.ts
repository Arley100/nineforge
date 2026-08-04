import { AnalysisResult } from "./types";
export function summarize(r: AnalysisResult): string {
  const errors = r.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = r.diagnostics.filter((d) => d.severity === "warning").length;
  const infos = r.diagnostics.filter((d) => d.severity === "info").length;
  if (r.verdict === "block") return "BLOCK: " + errors + " error(s), " + warnings + " warning(s). Do not run this program until errors are resolved.";
  if (r.verdict === "caution") return "CAUTION: no errors, " + warnings + " warning(s), " + infos + " note(s). Review before running.";
  return "PASS within modeled checks (" + infos + " note(s)). Not a substitute for CAM verification or a physical prove-out.";
}