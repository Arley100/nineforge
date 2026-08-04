import { NextResponse } from "next/server";
import { parseGCode } from "@/lib/parse";
import { analyze } from "@/lib/analyze";
import { parseWorkcell } from "@/lib/workcell";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.gcode !== "string") return NextResponse.json({ error: "gcode (string) is required" }, { status: 400 });
    const workcell = parseWorkcell(typeof body.workcell === "string" ? body.workcell : JSON.stringify(body.workcell));
    const state = body.state ? parseState(typeof body.state === "string" ? body.state : JSON.stringify(body.state)) : null;
    const result = analyze(parseGCode(body.gcode), workcell, state);
    return NextResponse.json({ result, summary: summarize(result) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 }); }
}