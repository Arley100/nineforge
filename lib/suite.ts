import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { check } from "./check";
import { parseRules } from "./rules";
import { Verdict } from "./types";

const verdict = z.enum(["pass", "caution", "block"]);
const SuiteSchema = z.object({
  workcell: z.string().optional(),
  state: z.string().optional(),
  rules: z.string().optional(),
  jobs: z.array(z.object({
    program: z.string(),
    expect: verdict,
    codes: z.array(z.string()).optional(),
    workcell: z.string().optional(),
    state: z.string().optional(),
    rules: z.string().optional(),
  })).min(1),
});

export type SuiteResult = { program: string; expect: Verdict; verdict: Verdict; missing: string[]; ok: boolean };

/**
 * Runs a per-workcell regression suite: each job names a program, its expected verdict and,
 * optionally, codes that must appear. Paths are relative to the manifest; job fields override defaults.
 */
export function runSuite(manifestPath: string): SuiteResult[] {
  const dir = dirname(manifestPath);
  const parsed = SuiteSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!parsed.success) throw new Error("Suite manifest is invalid:\n" + z.prettifyError(parsed.error));
  const m = parsed.data;
  const read = (p?: string) => (p ? readFileSync(resolve(dir, p), "utf8") : null);
  return m.jobs.map((job) => {
    const workcell = read(job.workcell ?? m.workcell);
    if (workcell === null) throw new Error("Job '" + job.program + "' has no workcell (set one on the job or the suite).");
    const rules = read(job.rules ?? m.rules);
    const r = check(read(job.program)!, workcell, read(job.state ?? m.state), rules ? parseRules(rules) : undefined);
    const got = new Set(r.diagnostics.map((d) => d.code));
    const missing = (job.codes ?? []).filter((c) => !got.has(c));
    return { program: job.program, expect: job.expect, verdict: r.verdict, missing, ok: r.verdict === job.expect && missing.length === 0 };
  });
}
