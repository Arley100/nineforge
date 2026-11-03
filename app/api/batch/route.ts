import { NextResponse } from "next/server";
import { runJob } from "../../../lib/job";

const MAX_BATCH_SIZE = 10;

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!Array.isArray(body)) return NextResponse.json({ error: "body must be an array of jobs" }, { status: 400 });
  if (body.length === 0) return NextResponse.json({ error: "Batch cannot be empty" }, { status: 400 });
  if (body.length > MAX_BATCH_SIZE) return NextResponse.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` }, { status: 400 });
  // A malformed job gets its own error; it never sinks the rest of the batch.
  const results = body.map((job, i) => {
    const id = job?.id != null && job.id !== "" ? String(job.id) : `job_${i}`;
    try { return { id, ...runJob(job) }; } catch (e) { return { id, error: e instanceof Error ? e.message : String(e) }; }
  });
  return NextResponse.json({ results });
}
