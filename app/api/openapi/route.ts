import { NextResponse } from "next/server";
import pkg from "../../../package.json";

const json = (schema: object) => ({ content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const error = { description: "Invalid request", ...json(ref("Error")) };

const spec = {
  openapi: "3.1.0",
  info: { title: "NineForge API", version: pkg.version, description: "Deterministic validation layer for AI-generated CNC G-code." },
  paths: {
    "/api/analyze": {
      post: {
        summary: "Analyze a single G-code program",
        requestBody: { required: true, ...json(ref("AnalyzeRequest")) },
        responses: { "200": { description: "Analysis report", ...json(ref("AnalyzeResponse")) }, "400": error, "413": { ...error, description: "Input too large" } },
      },
    },
    "/api/batch": {
      post: {
        summary: "Analyze up to 10 programs; a malformed job gets its own error",
        requestBody: { required: true, ...json({ type: "array", items: ref("BatchJob"), minItems: 1, maxItems: 10 }) },
        responses: { "200": { description: "Per-job results", ...json({ type: "object", properties: { results: { type: "array", items: { allOf: [ref("AnalyzeResponse"), { properties: { id: { type: "string" }, error: { type: "string" } } }] } } } }) }, "400": error },
      },
    },
  },
  components: {
    schemas: {
      AnalyzeRequest: {
        type: "object",
        required: ["gcode", "workcell"],
        properties: {
          gcode: { type: "string", maxLength: 2000000 },
          workcell: { description: "Workcell as a JSON string or object" },
          state: { description: "Machine state as a JSON string or object (optional)" },
          rules: { description: "Custom rules as a YAML/JSON string or object (optional)" },
        },
      },
      BatchJob: { allOf: [ref("AnalyzeRequest"), { type: "object", properties: { id: { type: "string" } } }] },
      Diagnostic: { type: "object", required: ["code", "severity", "message"], properties: { code: { type: "string" }, severity: { enum: ["info", "warning", "error"] }, message: { type: "string" }, line: { type: "integer" } } },
      Report: {
        type: "object",
        properties: {
          reportVersion: { const: 1 },
          verdict: { enum: ["pass", "caution", "block"] },
          diagnostics: { type: "array", items: ref("Diagnostic") },
          stats: { type: "object", properties: { segments: { type: "integer" }, distanceMm: { type: "number" }, rapidDistanceMm: { type: "number" }, durationSec: { type: "number" } } },
        },
      },
      AnalyzeResponse: { type: "object", properties: { result: ref("Report"), reportVersion: { const: 1 }, summary: { type: "string" } } },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
};

export function GET() {
  return NextResponse.json(spec);
}
