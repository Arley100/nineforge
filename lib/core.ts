/**
 * Public API surface for @nineforge/core (Node.js).
 * Everything an external plugin/CI tool needs; nothing from the web app.
 */
import { readFileSync } from "node:fs";
import { parseRules } from "./rules";

export { check } from "./check";
export type { Report } from "./check";
export { parseGCode } from "./parse";
export { analyze, placeSegments, segmentIntersectsBox } from "./analyze";
export { parseWorkcell } from "./workcell";
export { parseState } from "./state";
export { evaluateRules, parseRules, RuleSchema } from "./rules";
export type { RuleFile } from "./rules";
export { suggestFixes } from "./fix";
export type { FixAction, FixSuggestion } from "./fix";
export { stress, PERTURBATIONS } from "./perturb";
export type { StressRow } from "./perturb";
export { summarize } from "./summarize";
export { toSarif } from "./sarif";
export { CODES } from "./codes";
export { runJob } from "./job";
export { runSuite } from "./suite";
export type { SuiteResult } from "./suite";
export { attest, verifyAttestation, generateKeys, sha256 } from "./attest";
export type { Attestation } from "./attest";
export type { Vec3, Box, Segment, Diagnostic, FixtureBox, Workcell, MachineState, ProgramAssumptions, ParseResult, AnalysisResult, Verdict } from "./types";

/** Reads and validates a YAML/JSON rule file from disk. */
export const loadRules = (path: string) => parseRules(readFileSync(path, "utf8"));
