import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { check } from "../lib/check";
import { suggestFixes } from "../lib/fix";
import { stress } from "../lib/perturb";
import { parseRules } from "../lib/rules";
import { parseState } from "../lib/state";
import { parseWorkcell } from "../lib/workcell";
import pkg from "../package.json";

const input = {
  gcode: z.string().min(1).max(2_000_000).describe("G-code program text"),
  workcellJson: z.string().min(1).max(500_000).describe("Workcell JSON (limits, fixtures, stock, feedLimit)"),
  stateJson: z.string().max(500_000).optional().describe("Machine state JSON (work offsets, tool table)"),
  rules: z.string().max(100_000).optional().describe("Custom rule file contents (YAML or JSON)"),
};
const reply = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const rulesOf = (text?: string) => (text ? parseRules(text) : undefined);

const server = new McpServer({ name: "nineforge", version: pkg.version });

server.registerTool("nineforge_check", {
  description: "Validate a G-code program against a workcell and machine state. Returns a versioned report; verdict 'block' means do not run.",
  inputSchema: input,
}, ({ gcode, workcellJson, stateJson, rules }) => reply(check(gcode, workcellJson, stateJson, rulesOf(rules))));

server.registerTool("nineforge_fix", {
  description: "Suggest typed fixes. 'gcode-edit' actions are safe to auto-apply; 'physical-action' actions need a human (moving a clamp).",
  inputSchema: input,
}, ({ gcode, workcellJson, stateJson }) => reply(suggestFixes(gcode, parseWorkcell(workcellJson), stateJson ? parseState(stateJson) : null)));

server.registerTool("nineforge_stress", {
  description: "Re-run the checks under setup perturbations (fixture shifts, work-zero errors, feed overrides).",
  inputSchema: input,
}, ({ gcode, workcellJson, stateJson, rules }) => reply(stress(gcode, workcellJson, stateJson, rulesOf(rules))));

server.connect(new StdioServerTransport()).then(() => console.error("NineForge MCP server running on stdio"));
