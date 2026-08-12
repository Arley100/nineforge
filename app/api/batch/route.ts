import { NextResponse } from "next/server";
import { check } from "../../../lib/check";
import { summarize } from "../../../lib/summarize";
import { RuleSchema } from "../../../lib/rules";

const MAX_BATCH_SIZE = 10;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "body must be an array of jobs" }, { status: 400 });
    }
    if (body.length === 0) {
      return NextResponse.json({ error: "Batch cannot be empty" }, { status: 400 });
    }
    if (body.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` }, { status: 400 });
    }

    const results = body.map((job, index) => {
      const id = job.id || `job_${index}`;
      if (typeof job.gcode !== "string") {
        return { id, error: "gcode must be a string" };
      }

      const workcellJson = typeof job.workcell === "string" ? job.workcell : JSON.stringify(job.workcell);
      const stateJson = job.state ? (typeof job.state === "string" ? job.state : JSON.stringify(job.state)) : null;

      let parsedRules = undefined;
      if (job.rules !== undefined && job.rules !== null) {
        const rulesRes = RuleSchema.safeParse(job.rules);
        if (!rulesRes.success) {
          return { id, error: "Rules validation failed: " + rulesRes.error.message };
        }
        parsedRules = rulesRes.data;
      }

      // check() never throws; invalid inputs become NF107 block reports.
      const report = check(job.gcode, workcellJson, stateJson, parsedRules);
      return { id, result: report, summary: summarize(report) };
    });

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid batch request" }, { status: 400 });
  }
}
