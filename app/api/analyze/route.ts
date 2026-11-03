import { NextResponse } from "next/server";
import { JobError, runJob } from "../../../lib/job";

export async function POST(req: Request) {
  try {
    return NextResponse.json(runJob(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: e instanceof JobError ? e.status : 400 });
  }
}
