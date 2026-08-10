import { NextResponse } from "next/server";
import { check } from "../../../lib/check";
import { summarize } from "../../../lib/summarize";

const MAX_GCODE_CHARS = 2000000;
const MAX_JSON_CHARS = 500000;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.gcode !== "string") {
      return NextResponse.json({ error: "gcode (string) is required" }, { status: 400 });
    }

    if (body.gcode.length > MAX_GCODE_CHARS) {
      return NextResponse.json({ error: "gcode too large (max 2,000,000 chars)" }, { status: 413 });
    }

    const wcStr = typeof body.workcell === "string" ? body.workcell : JSON.stringify(body.workcell);
    const stStr = body.state ? (typeof body.state === "string" ? body.state : JSON.stringify(body.state)) : null;

    if (wcStr.length > MAX_JSON_CHARS) {
      return NextResponse.json({ error: "workcell too large" }, { status: 413 });
    }
    if (stStr && stStr.length > MAX_JSON_CHARS) {
      return NextResponse.json({ error: "state too large" }, { status: 413 });
    }

    // Route through check() to get a fail-closed Report with reportVersion
    const report = check(body.gcode, wcStr, stStr);

    return NextResponse.json({
      result: report,
      reportVersion: report.reportVersion,
      summary: summarize(report)
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 });
  }
}
