import { CODES } from "./codes";
import { AnalysisResult } from "./types";
import pkg from "../package.json";

type Level = "error" | "warning" | "note";
export type SarifResult = { ruleId: string; level: Level; message: { text: string }; locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[] };
export type SarifLog = {
  $schema: string;
  version: "2.1.0";
  runs: { tool: { driver: { name: string; version: string; informationUri: string; rules: { id: string; shortDescription: { text: string }; defaultConfiguration: { level: Level } }[] } }; results: SarifResult[] }[];
};

const levelOf = (s: string): Level => (s === "info" ? "note" : (s as Level));

export function toSarif(result: AnalysisResult, fileUri = "program.nc"): SarifLog {
  const rules = new Map<string, SarifLog["runs"][0]["tool"]["driver"]["rules"][0]>();
  const results = result.diagnostics.map((d): SarifResult => {
    if (!rules.has(d.code)) rules.set(d.code, { id: d.code, shortDescription: { text: CODES[d.code] ?? d.code }, defaultConfiguration: { level: levelOf(d.severity) } });
    // GitHub code scanning rejects results without a location: file-level findings anchor to line 1.
    return { ruleId: d.code, level: levelOf(d.severity), message: { text: d.message }, locations: [{ physicalLocation: { artifactLocation: { uri: fileUri }, region: { startLine: d.line ?? 1 } } }] };
  });
  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "NineForge", version: pkg.version, informationUri: "https://github.com/Arley100/nineforge", rules: [...rules.values()] } }, results }],
  };
}
