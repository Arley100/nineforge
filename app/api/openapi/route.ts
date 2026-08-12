import { NextResponse } from "next/server";

export async function GET(req: Request) {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "NineForge API",
      version: "0.8.0",
      description: "Deterministic validation layer for AI-generated CNC G-code."
    },
    paths: {
      "/api/analyze": {
        post: {
          summary: "Analyze a single G-code program",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { "$ref": "#/components/schemas/AnalyzeRequest" }
              }
            }
          },
          responses: { "200": { description: "Analysis report" } }
        }
      },
      "/api/batch": {
        post: {
          summary: "Analyze multiple G-code programs (max 10)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { "$ref": "#/components/schemas/BatchJob" },
                  maxItems: 10
                }
              }
            }
          },
          responses: { "200": { description: "Batch results" } }
        }
      }
    },
    components: {
      schemas: {
        AnalyzeRequest: {
          type: "object",
          properties: {
            gcode: { type: "string" },
            workcell: { description: "JSON string or Workcell object" },
            state: { description: "JSON string or MachineState object (optional)" },
            rules: { description: "RuleSchema object (optional, PAI-503)" }
          },
          required: ["gcode", "workcell"]
        },
        BatchJob: {
          allOf: [
            { "$ref": "#/components/schemas/AnalyzeRequest" },
            { type: "object", properties: { id: { type: "string", description: "Optional job identifier" } } }
          ]
        }
      }
    }
  });
}
