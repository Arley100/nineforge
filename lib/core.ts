/**
 * Public API surface for @nineforge/core (PAI-101).
 * Everything an external plugin/CI tool needs; nothing from the web app.
 */
export { check } from "./check";
export type { Report } from "./check";
export { parseGCode } from "./parse";
export { analyze, activeShift } from "./analyze";
export { parseWorkcell } from "./workcell";
export { parseState } from "./state";
export { evaluateRules, loadRules, RuleSchema } from "./rules";
export type { RuleFile } from "./rules";
export { suggestFixes } from "./fix";
export { summarize } from "./summarize";
export type {
  Vec3, Segment, Diagnostic, FixtureBox, Workcell, MachineState,
  ProgramAssumptions, ParseResult, AnalysisResult
} from "./types";
