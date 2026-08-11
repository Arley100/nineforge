import { analyze } from "./analyze";
import { parseGCode } from "./parse";
import { parseState } from "./state";
import { parseWorkcell } from "./workcell";
import { RuleFile } from "./rules";
import { AnalysisResult } from "./types";

/** Versioned report: the stable contract for CLI, web UI, and the future MCP server. */
export type Report = AnalysisResult & { reportVersion: 1 };

/**
 * The package boundary. Never throws on bad input: invalid workcell/state JSON
 * becomes a fail-closed block report (NF107) so agents and CI always get a report object.
 */
export function check(gcode: string, workcellJson: string, stateJson?: string | null, rules?: RuleFile): Report {
  try {
    const workcell = parseWorkcell(workcellJson);
    const state = stateJson && stateJson.trim() ? parseState(stateJson) : null;
    const result = analyze(parseGCode(gcode), workcell, state, rules);
    return { ...result, reportVersion: 1 };
  } catch (e) {
    return {
      reportVersion: 1,
      verdict: "block",
      diagnostics: [{ code: "NF107", severity: "error", message: e instanceof Error ? e.message : String(e) }],
      stats: { segments: 0, distanceMm: 0, rapidDistanceMm: 0, durationSec: 0 },
    };
  }
}
