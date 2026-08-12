import { z } from "zod";
import { readFileSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";
import { Diagnostic, ParseResult, Workcell, MachineState } from "./types";

export const RuleSchema = z.object({
  version: z.literal("1.0"),
  rules: z.array(z.object({
    id: z.string().regex(/^[A-Z0-9_]+$/, "Rule ID must be uppercase alphanumeric/underscore"),
    severity: z.enum(["error", "warning", "info"]),
    type: z.enum(["max_feed", "min_z", "max_tool_length"]),
    params: z.record(z.string(), z.union([z.number(), z.string()]))
  })).min(1, "At least one rule is required")
});

export type RuleFile = z.infer<typeof RuleSchema>;

export function loadRules(path: string): RuleFile {
  const content = readFileSync(path, "utf8");
  const ext = path.toLowerCase();
  let raw: unknown;
  try {
    if (ext.endsWith(".yaml") || ext.endsWith(".yml")) {
      raw = yamlLoad(content);
    } else if (ext.endsWith(".json")) {
      raw = JSON.parse(content);
    } else {
      throw new Error("Rules file must be .yaml, .yml, or .json");
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith("Rules file must be")) throw err;
    throw new Error("Failed to parse rules file: " + (err.message || err));
  }
  
  const parsed = RuleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Rules file failed schema validation: " + parsed.error.message);
  }
  return parsed.data;
}

export function evaluateRules(
  parse: ParseResult,
  workcell: Workcell,
  state: MachineState | null,
  rules: RuleFile
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules.rules) {
    if (rule.type === "max_feed") {
      const max = Number(rule.params.max);
      if (!Number.isFinite(max)) continue;
      for (const seg of parse.segments) {
        if (seg.motion !== "rapid" && seg.feedSet && seg.feed > max) {
          diagnostics.push({
            code: rule.id,
            severity: rule.severity,
            message: `Feed ${seg.feed} mm/min exceeds custom limit ${max} mm/min.`,
            line: seg.line
          });
        }
      }
    } else if (rule.type === "min_z") {
      const minZ = Number(rule.params.min);
      if (!Number.isFinite(minZ)) continue;
      for (const seg of parse.segments) {
        if (seg.from.z < minZ || seg.to.z < minZ) {
          diagnostics.push({
            code: rule.id,
            severity: rule.severity,
            message: `Z coordinate violates minimum limit ${minZ} mm.`,
            line: seg.line
          });
        }
      }
    } else if (rule.type === "max_tool_length") {
      if (!state) continue; 
      const maxLen = Number(rule.params.max);
      if (!Number.isFinite(maxLen)) continue;
      for (const tName of parse.assumptions.toolsUsed) {
        const tool = state.tools[tName];
        if (tool && tool.length !== undefined && tool.length > maxLen) {
          diagnostics.push({
            code: rule.id,
            severity: rule.severity,
            message: `Tool ${tName} length ${tool.length} mm exceeds limit ${maxLen} mm.`
          });
        }
      }
    }
  }
  return diagnostics;
}
