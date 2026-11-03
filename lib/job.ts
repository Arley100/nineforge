import { check } from "./check";
import { parseRules } from "./rules";
import { summarize } from "./summarize";

export const MAX_GCODE_CHARS = 2_000_000;
export const MAX_JSON_CHARS = 500_000;

/** An input error with the HTTP status it maps to. */
export class JobError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const asText = (v: unknown) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));

/**
 * One validation request as used by the REST API, the batch endpoint and the Python bridge.
 * `workcell`/`state` may be JSON strings or objects; `rules` a YAML/JSON string or an object.
 */
export function runJob(job: any) {
  if (!job || typeof job.gcode !== "string") throw new JobError("gcode (string) is required");
  if (job.gcode.length > MAX_GCODE_CHARS) throw new JobError("gcode too large (max 2,000,000 chars)", 413);
  const workcell = asText(job.workcell), state = asText(job.state);
  if (workcell === null) throw new JobError("workcell is required");
  if (workcell.length > MAX_JSON_CHARS || (state?.length ?? 0) > MAX_JSON_CHARS) throw new JobError("workcell/state too large (max 500,000 chars)", 413);
  const rules = job.rules == null ? undefined : parseRules(job.rules);
  const result = check(job.gcode, workcell, state, rules); // never throws: bad JSON becomes an NF107 block
  return { result, reportVersion: result.reportVersion, summary: summarize(result) };
}
