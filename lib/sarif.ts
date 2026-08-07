import { AnalysisResult } from "./types";

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: {
      driver: {
        name: string;
        informationUri: string;
        rules: { id: string; shortDescription: { text: string }; defaultConfiguration: { level: string } }[];
      };
    };
    results: {
      ruleId: string;
      level: "error" | "warning" | "note" | "none";
      message: { text: string };
      locations?: {
        physicalLocation: {
          artifactLocation: { uri: string };
          region: { startLine: number };
        };
      }[];
    }[];
  }[];
}

export function toSarif(result: AnalysisResult, fileUri: string = "program.nc"): SarifLog {
  const rulesMap = new Map<string, { id: string; shortDescription: { text: string }; defaultConfiguration: { level: string } }>();
  
  const results = result.diagnostics.map((d) => {
    if (!rulesMap.has(d.code)) {
      rulesMap.set(d.code, {
        id: d.code,
        shortDescription: { text: d.code },
        defaultConfiguration: { level: d.severity === "info" ? "note" : d.severity }
      });
    }
    
    const res: any = {
      ruleId: d.code,
      level: d.severity === "info" ? "note" : d.severity,
      message: { text: d.message }
    };
    
    if (d.line) {
      res.locations = [{
        physicalLocation: {
          artifactLocation: { uri: fileUri },
          region: { startLine: d.line }
        }
      }];
    }
    
    return res;
  });

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "NineForge",
          informationUri: "https://github.com/Arley100/nineforge",
          rules: Array.from(rulesMap.values())
        }
      },
      results
    }]
  };
}
