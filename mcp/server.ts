import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { check } from "../lib/check.js";
import { suggestFixes } from "../lib/fix.js";
import { parseGCode } from "../lib/parse.js";
import { parseWorkcell } from "../lib/workcell.js";

const server = new Server(
  { name: "nineforge-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "nineforge_check",
      description: "Validates G-code against a workcell and machine state. Returns a verdict (pass/caution/block), diagnostics with codes/lines, and stats.",
      inputSchema: {
        type: "object",
        properties: {
          gcode: { type: "string", description: "The G-code program text." },
          workcellJson: { type: "string", description: "JSON string defining the workcell (limits, fixtures, stock, feedLimit)." },
          stateJson: { type: "string", description: "Optional JSON string defining the machine state (offsets, tools)." }
        },
        required: ["gcode", "workcellJson"]
      }
    },
    {
      name: "nineforge_fix",
      description: "Suggests fixes for a blocked G-code program. Returns typed actions: 'gcode-edit' (auto-applicable by agents) and 'physical-action' (requires human intervention).",
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
  
  if (name === "nineforge_check") {
    const report = check(
      args.gcode as string,
      args.workcellJson as string,
      (args.stateJson as string) || null
    );
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }]
    };
  }
  
  if (name === "nineforge_fix") {
    try {
      const workcell = parseWorkcell(args.workcellJson as string);
      const parsed = parseGCode(args.gcode as string);
      const fix = suggestFixes(args.gcode as string, workcell, parsed.segments);
      return {
        content: [{ type: "text", text: JSON.stringify(fix, null, 2) }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: "Error generating fixes: " + (e instanceof Error ? e.message : String(e)) }],
        isError: true
      };
    }
  }
  
  throw new Error("Unknown tool: " + name);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NineForge MCP server running on stdio");
}

main().catch(console.error);
