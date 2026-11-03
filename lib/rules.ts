import { z } from "zod";
import { load as yamlLoad } from "js-yaml";
import { Diagnostic, MachineState, ParseResult, Workcell } from "./types";

const rule = <T extends string, P extends z.ZodRawShape>(type: T, params: P) => z.object({
  id: z.string().regex(/^[A-Z0-9_]+$/, "Rule ID must be uppercase alphanumeric/underscore"),
  severity: z.enum(["error", "warning", "info"]),
  type: z.literal(type),
  params: z.object(params),
});

/** Custom shop rules. Params are typed per rule so a typo fails validation instead of silently disabling the rule. */
export const RuleSchema = z.object({
  version: z.literal("1.0"),
  rules: z.array(z.discriminatedUnion("type", [
    rule("max_feed", { max: z.number().positive() }),
    rule("min_z", { min: z.number() }),
    rule("max_tool_length", { max: z.number().positive() }),
    rule("min_rapid_z", { min: z.number() }),
  ])).min(1, "At least one rule is required"),
});

export type RuleFile = z.infer<typeof RuleSchema>;

/** Accepts a YAML/JSON string or an already-parsed object; throws a readable error when invalid. */
export function parseRules(input: unknown): RuleFile {
  let raw = input;
  if (typeof input === "string") {
    try { raw = yamlLoad(input); } catch (e) { throw new Error("Failed to parse rules file: " + (e instanceof Error ? e.message : String(e))); }
  }
  const parsed = RuleSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Rules file failed schema validation:\n" + z.prettifyError(parsed.error));
  return parsed.data;
}

/** Rules are evaluated in program coordinates (what the programmer wrote). */
export function evaluateRules(parse: ParseResult, _workcell: Workcell, state: MachineState | null, rules: RuleFile): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of rules.rules) {
    const hit = (message: string, line?: number) => out.push({ code: r.id, severity: r.severity, message, ...(line ? { line } : {}) });
    if (r.type === "max_feed") {
      let last = NaN;
      for (const s of parse.segments) {
        if (s.motion === "rapid") continue;
        if (s.feed > r.params.max && s.feed !== last) hit("Feed " + Math.round(s.feed) + " mm/min exceeds custom limit " + r.params.max + " mm/min.", s.line);
        last = s.feed;
      }
    } else if (r.type === "min_z") {
      // Every point after the (unknown) start is some segment's endpoint.
      for (const s of parse.segments) if (s.to.z < r.params.min) hit("Z " + +s.to.z.toFixed(3) + " violates minimum limit " + r.params.min + " mm.", s.line);
    } else if (r.type === "min_rapid_z") {
      for (const s of parse.segments) {
        const from = s.anchor ? s.to : s.from; // never judge an unknown start position
        const horizontal = from.x !== s.to.x || from.y !== s.to.y;
        if (s.motion === "rapid" && horizontal && s.anchor !== "none" && Math.min(from.z, s.to.z) < r.params.min) hit("Rapid traverse below the clearance plane Z" + r.params.min + ".", s.line);
      }
    } else if (state) {
      for (const t of parse.assumptions.toolsUsed) {
        const length = state.tools[t]?.length;
        if (length !== undefined && length > r.params.max) hit("Tool " + t + " length " + length + " mm exceeds limit " + r.params.max + " mm.");
      }
    }
  }
  return out;
}
