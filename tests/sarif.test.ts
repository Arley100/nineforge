import { describe, expect, it } from "vitest";
import { toSarif } from "../lib/sarif";
import { AnalysisResult } from "../lib/types";

describe("SARIF output", () => {
  it("maps diagnostics to SARIF results with line numbers", () => {
    const result: AnalysisResult = {
      verdict: "block",
      stats: { segments: 1, distanceMm: 10, rapidDistanceMm: 5, durationSec: 1 },
      diagnostics: [
        { code: "NF001", severity: "error", message: "Toolpath intersects fixture", line: 5 },
        { code: "NF003", severity: "warning", message: "Feed exceeds limit", line: 8 }
      ]
    };
    
    const sarif = toSarif(result, "file:///part.nc");
    
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.name).toBe("NineForge");
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(2);
    
    const res = sarif.runs[0].results;
    expect(res).toHaveLength(2);
    expect(res[0].ruleId).toBe("NF001");
    expect(res[0].level).toBe("error");
    expect(res[0].locations?.[0].physicalLocation.region.startLine).toBe(5);
    expect(res[0].locations?.[0].physicalLocation.artifactLocation.uri).toBe("file:///part.nc");
    
    expect(res[1].level).toBe("warning");
  });
  
  it("maps info severity to note and omits locations if no line", () => {
    const result: AnalysisResult = {
      verdict: "caution",
      stats: { segments: 0, distanceMm: 0, rapidDistanceMm: 0, durationSec: 0 },
      diagnostics: [{ code: "NF005", severity: "info", message: "Assuming feed limit" }]
    };
    const sarif = toSarif(result);
    expect(sarif.runs[0].results[0].level).toBe("note");
    expect(sarif.runs[0].results[0].locations).toBeUndefined();
  });
});
