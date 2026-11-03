export type Vec3 = { x: number; y: number; z: number };
/**
 * One straight move in program coordinates (arcs arrive tessellated, flagged `arc`).
 * `anchor`: "end" = start position not fully programmed yet (only the endpoint is checked);
 * "none" = endpoint not fully programmed either (not geometry-checked, disclosed as NF110).
 * `wcs`, `tool` and `tlo` carry the active work offset, tool and length-compensated tool.
 */
export type Segment = {
  from: Vec3; to: Vec3; motion: "rapid" | "linear"; feed: number; feedSet: boolean; line: number;
  arc?: boolean; anchor?: "end" | "none"; wcs?: string; tool?: string; tlo?: string;
  /** Axes still positioned in an earlier context (work offset; for Z also tool/G43) with no absolute move since. */
  frames?: Partial<Record<"x" | "y" | "z", { wcs: string; tool?: string; tlo?: string }>>;
};
export type Diagnostic = { code: string; severity: "info" | "warning" | "error"; message: string; line?: number };
export type Box = { min: Vec3; max: Vec3 };
export type FixtureBox = Box & { name: string };
export type Workcell = { machine: string; limits: Box; rapidFeed: number; feedLimit?: number; fixtures: FixtureBox[]; stock?: Box };
export type MachineState = { control: string; offsets: Record<string, Vec3>; tools: Record<string, { diameter?: number; length?: number }> };
export type ProgramAssumptions = { units: "mm" | "in"; offsetsUsed: string[]; toolsUsed: string[]; envelope: Box | null };
export type ParseResult = {
  segments: Segment[]; diagnostics: Diagnostic[]; units: "mm" | "in"; assumptions: ProgramAssumptions;
  /** The same program with '/' block-delete lines skipped; analyze() checks both. */
  blockDeleteVariant?: ParseResult;
};
export type Verdict = "pass" | "caution" | "block";
export type AnalysisResult = { diagnostics: Diagnostic[]; verdict: Verdict; stats: { segments: number; distanceMm: number; rapidDistanceMm: number; durationSec: number } };
