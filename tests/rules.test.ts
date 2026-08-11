import { describe, it, expect } from "vitest";
import { evaluateRules } from "../lib/rules";
import { parseGCode } from "../lib/parse";
import { RuleFile } from "../lib/rules";

describe("PAI-503 Rule Engine", () => {
  it("evaluates max_feed correctly", () => {
    const rules: RuleFile = {
      version: "1.0",
      rules: [
        { id: "CUSTOM_FEED", severity: "error", type: "max_feed", params: { max: 500 } }
      ]
    };
    const parse = parseGCode("G0 X10\nG1 X20 F1000\n");
    const diags = evaluateRules(parse, {} as any, null, rules);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe("CUSTOM_FEED");
  });
  
  it("evaluates min_z correctly", () => {
    const rules: RuleFile = {
      version: "1.0",
      rules: [
        { id: "CUSTOM_Z", severity: "error", type: "min_z", params: { min: 0 } }
      ]
    };
    const parse = parseGCode("G0 X10 Z-5\n");
    const diags = evaluateRules(parse, {} as any, null, rules);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe("CUSTOM_Z");
  });

  it("ignores max_feed for rapids", () => {
    const rules: RuleFile = {
      version: "1.0",
      rules: [
        { id: "CUSTOM_FEED", severity: "error", type: "max_feed", params: { max: 500 } }
      ]
    };
    const parse = parseGCode("G0 X20 F1000\n"); // Some controls use F with G0, but we treat G0 as rapid
    const diags = evaluateRules(parse, {} as any, null, rules);
    expect(diags.length).toBe(0);
  });
});
