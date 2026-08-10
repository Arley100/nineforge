import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../lib/check.js";
import { suggestFixes } from "../lib/fix.js";
import { parseGCode } from "../lib/parse.js";
import { parseWorkcell } from "../lib/workcell.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const server = new Server(
  { name: "nineforge-mcp", version: pkg.version },
  { capabilities: { tools: {} } }
);

const checkSchema = z.object({
  gcode: z.string().min(1).max(2000000),
  workcellJson: z.string().min(1).max(500000),
  stateJson: z.string().max(500000).nullable().optional()
});

const fixSchema = z.object({
  gcode: z.string().min(1),
  workcellJson: z.string().min(1),
  stateJson: z.string().nullable().optional()
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "nineforge_check",
      description: "Validates G-code against a workcell and machine state.",
      inputSchema: {
        type: "object",
        properties: {
          gcode: { type: "string" },
          workcellJson: { type: "string" },
          stateJson: { type: "string" }
        },
        required: ["gcode", "workcellJson"]
      }
    },
    {
      name: "nineforge_fix",
      description: "Suggests fixes for a blocked G-code program.",
      inputSchema: {
        type: "object",
        properties: {
          gcode: { type: "string" },
          workcellJson: { type: "string" },
          stateJson: { type: "string" }
        },
        required: ["gcode", "workcellJson"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "nineforge_check") {
      const parsed = checkSchema.parse(args || {});
      const report = check(parsed.gcode, parsed.workcellJson, parsed.stateJson || null);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
    
    if (name === "nineforge_fix") {
      const parsed = fixSchema.parse(args || {});
      const workcell = parseWorkcell(parsed.workcellJson);
      const parsedGcode = parseGCode(parsed.gcode);
      const fix = suggestFixes(parsed.gcode, workcell, parsedGcode.segments);
      return { content: [{ type: "text", text: JSON.stringify(fix, null, 2) }] };
    }
  } catch (e) {
    return {
      content: [{ type: "text", text: "Error: " + (e instanceof Error ? e.message : String(e)) }],
      isError: true
    };
  }
  
  throw new Error("Unknown tool: " + name);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NineForge MCP server running on stdio");
}

main().catch(console.error);
