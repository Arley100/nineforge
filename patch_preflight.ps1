$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "nineforge"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-File {
    param([string]$RelativePath, [string]$Content)
    $fullPath = Join-Path $root $RelativePath
    $directory = Split-Path $fullPath -Parent
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($fullPath, $Content, $utf8NoBom)
    Write-Host "wrote $RelativePath"
}

function Patch-File {
    param([string]$RelativePath, [string]$Old, [string]$New)
    $p = Join-Path $root $RelativePath
    $c = [System.IO.File]::ReadAllText($p)
    if (-not $c.Contains($Old)) { Write-Host "WARN anchor not found in $RelativePath"; return }
    $c = $c.Replace($Old, $New)
    [System.IO.File]::WriteAllText($p, $c, $utf8NoBom)
    Write-Host "patched $RelativePath"
}

# lib/types.ts
$c = @'
export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type Segment = {
  from: Vec3;
  to: Vec3;
  motion: "rapid" | "linear";
  feed: number;
  feedSet: boolean;
  line: number;
};

export type Diagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
};

export type FixtureBox = {
  name: string;
  min: Vec3;
  max: Vec3;
};

export type Workcell = {
  machine: string;
  units: "mm";
  limits: { min: Vec3; max: Vec3 };
  rapidFeed: number;
  fixtures: FixtureBox[];
  feedLimit?: number;
};

export type MachineState = {
  control: string;
  offsets: Record<string, Vec3>;
  tools: Record<string, { diameter?: number; length?: number }>;
};

export type ProgramAssumptions = {
  units: "mm" | "in";
  offsetsUsed: string[];
  toolsUsed: string[];
  envelope: { min: Vec3; max: Vec3 } | null;
};

export type ParseResult = {
  segments: Segment[];
  diagnostics: Diagnostic[];
  units: "mm" | "in";
  assumptions: ProgramAssumptions;
};

export type Verdict = "block" | "caution" | "pass";

export type AnalysisResult = {
  diagnostics: Diagnostic[];
  verdict: Verdict;
  stats: {
    segments: number;
    distanceMm: number;
    rapidDistanceMm: number;
    durationSec: number;
  };
};
'@
Write-File "lib/types.ts" $c

# lib/parse.ts (now extracts program assumptions)
$c = @'
import { Diagnostic, ParseResult, Segment, Vec3 } from "./types";

const IN_TO_MM = 25.4;
const KNOWN_G = new Set([0, 1, 2, 3, 20, 21, 90, 91]);

export function parseGCode(code: string): ParseResult {
  const segments: Segment[] = [];
  const diagnostics: Diagnostic[] = [];
  const noted = new Set<string>();
  const offsetsUsed: string[] = [];
  const toolsUsed: string[] = [];

  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let feed = 500;
  let motion: "rapid" | "linear" = "rapid";
  let units: "mm" | "in" = "mm";

  const note = (key: string, d: Diagnostic) => {
    if (!noted.has(key)) {
      noted.add(key);
      diagnostics.push(d);
    }
  };

  code.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.split(";")[0].replace(/\([^)]*\)/g, " ").trim();
    if (!line) return;

    const words = line.split(/\s+/);
    const next = { ...pos };
    let localMotion = motion;
    let localFeed = feed;
    let localFeedSet = false;

    for (const w of words) {
      const cmd = w.toUpperCase();
      const letter = cmd[0];
      const value = Number(cmd.slice(1));

      if (letter === "G") {
        if (value === 0) localMotion = "rapid";
        else if (value === 1) localMotion = "linear";
        else if (value === 20) units = "in";
        else if (value === 21) units = "mm";
        else if (value >= 54 && value <= 59) {
          const name = "G" + value;
          if (!offsetsUsed.includes(name)) offsetsUsed.push(name);
        } else if (value === 2 || value === 3) {
          note("arc", {
            code: "NF100",
            severity: "info",
            message: "Arc moves (G2/G3) are not modeled; geometry results are incomplete.",
            line: lineNo,
          });
        } else if (value === 91) {
          note("g91", {
            code: "NF101",
            severity: "warning",
            message: "Incremental positioning (G91) is not supported; coordinates are treated as absolute.",
            line: lineNo,
          });
        } else if (!KNOWN_G.has(value)) {
          note("g" + value, {
            code: "NF102",
            severity: "info",
            message: "G" + value + " is not modeled and was ignored.",
            line: lineNo,
          });
        }
      } else if (letter === "X") next.x = value;
      else if (letter === "Y") next.y = value;
      else if (letter === "Z") next.z = value;
      else if (letter === "F") {
        localFeed = value;
        localFeedSet = true;
      } else if (letter === "T") {
        const name = "T" + String(value).padStart(2, "0");
        if (!toolsUsed.includes(name)) toolsUsed.push(name);
      } else if (letter === "M" || letter === "N" || letter === "S") {
        // program control words: intentionally ignored
      } else {
        note("word" + letter, {
          code: "NF102",
          severity: "info",
          message: "Word '" + letter + "' is not modeled and was ignored.",
          line: lineNo,
        });
      }
    }

    const hasMotion = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z;

    if (hasMotion) {
      const s = units === "in" ? IN_TO_MM : 1;
      segments.push({
        from: { x: pos.x * s, y: pos.y * s, z: pos.z * s },
        to: { x: next.x * s, y: next.y * s, z: next.z * s },
        motion: localMotion,
        feed: localFeed * s,
        feedSet: localFeedSet,
        line: lineNo,
      });
      pos = next;
      motion = localMotion;
      feed = localFeed;
    } else {
      motion = localMotion;
      feed = localFeed;
    }
  });

  let envelope: { min: Vec3; max: Vec3 } | null = null;
  if (segments.length) {
    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const s of segments) {
      for (const p of [s.from, s.to]) {
        min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
        min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
        min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
      }
    }
    envelope = { min, max };
  }

  return {
    segments,
    diagnostics,
    units,
    assumptions: { units, offsetsUsed, toolsUsed, envelope },
  };
}
'@
Write-File "lib/parse.ts" $c

# lib/state.ts
$c = @'
import { MachineState, Vec3 } from "./types";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec(v: any): v is Vec3 {
  return v && isNum(v.x) && isNum(v.y) && isNum(v.z);
}

export function parseState(json: string): MachineState {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Machine state file is not valid JSON.");
  }

  const offsets: Record<string, Vec3> = {};
  if (raw?.offsets && typeof raw.offsets === "object") {
    for (const [k, v] of Object.entries(raw.offsets)) {
      if (!/^G5[4-9]$/.test(k)) {
        throw new Error("Offset '" + k + "' is not a supported work offset (G54-G59).");
      }
      if (!isVec(v)) {
        throw new Error("Offset " + k + " must be numeric x/y/z.");
      }
      offsets[k] = v;
    }
  }

  const tools: Record<string, { diameter?: number; length?: number }> = {};
  if (raw?.tools && typeof raw.tools === "object") {
    for (const [k, v] of Object.entries(raw.tools)) {
      if (!/^T\d{2}$/.test(k)) {
        throw new Error("Tool '" + k + "' must be named Tnn (e.g. T01).");
      }
      const t: any = v ?? {};
      tools[k] = {
        diameter: isNum(t.diameter) ? t.diameter : undefined,
        length: isNum(t.length) ? t.length : undefined,
      };
    }
  }

  return {
    control: typeof raw?.control === "string" ? raw.control : "unspecified",
    offsets,
    tools,
  };
}
'@
Write-File "lib/state.ts" $c

# lib/analyze.ts (state-aware)
$c = @'
import {
  AnalysisResult,
  Diagnostic,
  FixtureBox,
  MachineState,
  ParseResult,
  Vec3,
  Workcell,
} from "./types";

function pointInBox(p: Vec3, b: FixtureBox): boolean {
  return (
    p.x >= b.min.x && p.x <= b.max.x &&
    p.y >= b.min.y && p.y <= b.max.y &&
    p.z >= b.min.z && p.z <= b.max.z
  );
}

function segmentIntersectsBox(a: Vec3, b: Vec3, box: FixtureBox): boolean {
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    if (pointInBox(p, box)) return true;
  }
  return false;
}

function outOfLimits(p: Vec3, w: Workcell): boolean {
  return (
    p.x < w.limits.min.x || p.x > w.limits.max.x ||
    p.y < w.limits.min.y || p.y > w.limits.max.y ||
    p.z < w.limits.min.z || p.z > w.limits.max.z
  );
}

function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
}

export function analyze(
  parse: ParseResult,
  workcell: Workcell,
  state?: MachineState | null
): AnalysisResult {
  const diagnostics: Diagnostic[] = [...parse.diagnostics];
  const feedLimit = workcell.feedLimit ?? 1000;
  const a = parse.assumptions;

  // Pre-flight: program assumptions vs machine state.
  let shift: Vec3 = { x: 0, y: 0, z: 0 };

  if (state) {
    for (const o of a.offsetsUsed) {
      if (!state.offsets[o]) {
        diagnostics.push({
          code: "NF201",
          severity: "error",
          message: "Program references " + o + " but it is not defined in the machine state.",
        });
      }
    }
    for (const t of a.toolsUsed) {
      if (!state.tools[t]) {
        diagnostics.push({
          code: "NF202",
          severity: "error",
          message: "Program references " + t + " but it is not present in the tool table.",
        });
      }
    }
    if (a.envelope) {
      for (const o of a.offsetsUsed) {
        const off = state.offsets[o];
        if (!off) continue;
        const e = a.envelope;
        const out =
          e.min.x + off.x < workcell.limits.min.x ||
          e.max.x + off.x > workcell.limits.max.x ||
          e.min.y + off.y < workcell.limits.min.y ||
          e.max.y + off.y > workcell.limits.max.y ||
          e.min.z + off.z < workcell.limits.min.z ||
          e.max.z + off.z > workcell.limits.max.z;
        if (out) {
          diagnostics.push({
            code: "NF203",
            severity: "error",
            message: "Work envelope under " + o + " exceeds machine travel.",
          });
        }
      }
    }
    if (a.offsetsUsed.length > 1) {
      diagnostics.push({
        code: "NF204",
        severity: "info",
        message: "Multiple work offsets referenced; geometry checks use the first defined offset.",
      });
    }
    const primaryName = a.offsetsUsed.find((o) => state.offsets[o]) ?? (state.offsets["G54"] ? "G54" : null);
    if (primaryName && state.offsets[primaryName]) shift = state.offsets[primaryName];
  }

  const add = (p: Vec3): Vec3 => ({ x: p.x + shift.x, y: p.y + shift.y, z: p.z + shift.z });

  let distanceMm = 0;
  let rapidDistanceMm = 0;
  let durationSec = 0;

  for (const seg of parse.segments) {
    const from = add(seg.from);
    const to = add(seg.to);
    const d = distance(from, to);
    distanceMm += d;

    if (seg.motion === "rapid") {
      rapidDistanceMm += d;
      durationSec += (d / Math.max(1, workcell.rapidFeed)) * 60;
    } else {
      durationSec += (d / Math.max(1, seg.feed)) * 60;
    }

    if (outOfLimits(from, workcell) || outOfLimits(to, workcell)) {
      diagnostics.push({
        code: "NF002",
        severity: "error",
        message: "Motion exceeds machine travel limits (line " + seg.line + ").",
        line: seg.line,
      });
    }

    for (const f of workcell.fixtures) {
      if (segmentIntersectsBox(from, to, f)) {
        diagnostics.push({
          code: "NF001",
          severity: "error",
          message: "Toolpath intersects fixture '" + f.name + "' (line " + seg.line + ").",
          line: seg.line,
        });
      }
    }

    if (seg.motion === "linear" && seg.feedSet && seg.feed > feedLimit) {
      diagnostics.push({
        code: "NF003",
        severity: "warning",
        message: "Feed " + Math.round(seg.feed) + " mm/min exceeds workcell feed limit " + feedLimit + " (line " + seg.line + ").",
        line: seg.line,
      });
    }

    const horizontal =
      Math.abs(from.x - to.x) > 0.1 || Math.abs(from.y - to.y) > 0.1;

    if (seg.motion === "rapid" && horizontal && Math.min(from.z, to.z) < 2 && d > 0.1) {
      diagnostics.push({
        code: "NF004",
        severity: "warning",
        message: "Rapid traverse at low Z (" + Math.min(from.z, to.z).toFixed(2) + ") near line " + seg.line + ".",
        line: seg.line,
      });
    }
  }

  const seen = new Set<string>();
  const deduped = diagnostics.filter((x) => {
    const k = x.code + "|" + (x.line ?? 0) + "|" + x.message;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const verdict = deduped.some((x) => x.severity === "error")
    ? "block"
    : deduped.some((x) => x.severity === "warning")
    ? "caution"
    : "pass";

  return {
    diagnostics: deduped,
    verdict,
    stats: {
      segments: parse.segments.length,
      distanceMm: Math.round(distanceMm),
      rapidDistanceMm: Math.round(rapidDistanceMm),
      durationSec: Math.round(durationSec),
    },
  };
}
'@
Write-File "lib/analyze.ts" $c

# State files for existing examples + new mismatch example
$stdState = @'
{
  "control": "sim",
  "offsets": { "G54": { "x": 0, "y": 0, "z": 0 } },
  "tools": { "T01": { "diameter": 6, "length": 50 } }
}
'@
foreach ($id in @("bracket", "clean", "overtravel", "messy")) {
  Write-File ("public/examples/" + $id + ".state.json") $stdState
}

$c = @'
G21 G90
G55
T07 M6
G0 Z5
G0 X0 Y0
G1 Z-2 F800
G1 X50 Y0
G1 X50 Y30
G0 Z10
M2
'@
Write-File "public/examples/mismatch.nc" $c

$c = @'
{
  "machine": "Desktop CNC Mill",
  "limits": {
    "min": { "x": -250, "y": -200, "z": -100 },
    "max": { "x": 250, "y": 200, "z": 100 }
  },
  "rapidFeed": 5000,
  "feedLimit": 1000,
  "fixtures": []
}
'@
Write-File "public/examples/mismatch.workcell.json" $c

$c = @'
{
  "control": "sim",
  "offsets": { "G54": { "x": 0, "y": 0, "z": 0 } },
  "tools": { "T01": { "diameter": 6, "length": 50 } }
}
'@
Write-File "public/examples/mismatch.state.json" $c

# lib/examples.ts
$c = @'
export type ExampleRef = {
  id: string;
  name: string;
  description: string;
  nc: string;
  workcell: string;
  state: string;
};

export const EXAMPLES: ExampleRef[] = [
  {
    id: "bracket",
    name: "Bracket with fixture collision",
    description: "Demonstrates NF001 (collision) and NF003 (feed limit).",
    nc: "/examples/bracket.nc",
    workcell: "/examples/bracket.workcell.json",
    state: "/examples/bracket.state.json",
  },
  {
    id: "clean",
    name: "Clean pocket job",
    description: "Expected verdict: pass.",
    nc: "/examples/clean.nc",
    workcell: "/examples/clean.workcell.json",
    state: "/examples/clean.state.json",
  },
  {
    id: "overtravel",
    name: "Over-travel job",
    description: "Demonstrates NF002 (travel limits).",
    nc: "/examples/overtravel.nc",
    workcell: "/examples/overtravel.workcell.json",
    state: "/examples/overtravel.state.json",
  },
  {
    id: "messy",
    name: "Messy real-world file",
    description: "Lowercase, comments, modal feeds. Expected verdict: pass.",
    nc: "/examples/messy.nc",
    workcell: "/examples/messy.workcell.json",
    state: "/examples/messy.state.json",
  },
  {
    id: "mismatch",
    name: "Setup mismatch (pre-flight)",
    description: "Program assumes G55 and T07; state defines G54 and T01. NF201 + NF202.",
    nc: "/examples/mismatch.nc",
    workcell: "/examples/mismatch.workcell.json",
    state: "/examples/mismatch.state.json",
  },
];
'@
Write-File "lib/examples.ts" $c

# CLI with --state
$c = @'
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
import { summarize } from "../lib/summarize";
import { PERTURBATIONS } from "../lib/perturb";

function usage(): never {
  console.log(
    "Usage: npx tsx cli/main.ts check <job.nc> --workcell <cell.json> [--state <state.json>] [--json] [--stress] [--strict]"
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] !== "check" || !args[1]) usage();

const file = args[1];
const wIdx = args.indexOf("--workcell");
if (wIdx < 0 || !args[wIdx + 1]) usage();

const sIdx = args.indexOf("--state");
const asJson = args.includes("--json");
const stress = args.includes("--stress");
const strict = args.includes("--strict");

const gcode = readFileSync(file, "utf8");
const workcell = parseWorkcell(readFileSync(args[wIdx + 1], "utf8"));
const state = sIdx >= 0 && args[sIdx + 1]
  ? parseState(readFileSync(args[sIdx + 1], "utf8"))
  : null;

const result = analyze(parseGCode(gcode), workcell, state);

const stressRows = stress
  ? PERTURBATIONS.map((p) => {
      const v = p.apply(gcode, workcell);
      const r = analyze(parseGCode(v.gcode), v.workcell, state);
      return { name: p.name, verdict: r.verdict };
    })
  : [];

if (asJson) {
  console.log(JSON.stringify({ file, result, stress: stressRows }, null, 2));
} else {
  console.log("NineForge check: " + file);
  console.log("Workcell: " + workcell.machine + (state ? " | state: " + state.control : " | state: none"));
  for (const d of result.diagnostics) {
    console.log("  [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
  }
  console.log("  " + summarize(result));
  if (stress) {
    const ok = stressRows.filter((s) => s.verdict !== "block").length;
    console.log("  Stress: survives " + ok + "/" + stressRows.length + " perturbed workcells.");
    for (const s of stressRows) {
      console.log("    " + (s.verdict === "block" ? "FAIL" : "ok") + "  " + s.name);
    }
  }
}

const fail =
  result.verdict === "block" ||
  (strict && result.verdict === "caution") ||
  stressRows.some((s) => s.verdict === "block");

process.exit(fail ? 1 : 0);
'@
Write-File "cli/main.ts" $c

# API route accepts state
$c = @'
import { NextResponse } from "next/server";
import { parseGCode } from "@/lib/parse";
import { analyze } from "@/lib/analyze";
import { parseWorkcell } from "@/lib/workcell";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.gcode !== "string") {
      return NextResponse.json({ error: "gcode (string) is required" }, { status: 400 });
    }
    const workcell = parseWorkcell(
      typeof body.workcell === "string" ? body.workcell : JSON.stringify(body.workcell)
    );
    const state = body.state
      ? parseState(typeof body.state === "string" ? body.state : JSON.stringify(body.state))
      : null;
    const result = analyze(parseGCode(body.gcode), workcell, state);
    return NextResponse.json({ result, summary: summarize(result) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      { status: 400 }
    );
  }
}
'@
Write-File "app/api/analyze/route.ts" $c

# State tests
$c = @'
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";

function load(id: string) {
  return {
    gcode: readFileSync("public/examples/" + id + ".nc", "utf8"),
    workcell: parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")),
    state: parseState(readFileSync("public/examples/" + id + ".state.json", "utf8")),
  };
}

describe("pre-flight state checks", () => {
  it("blocks a program whose offset and tool are not in the state", () => {
    const { gcode, workcell, state } = load("mismatch");
    const r = analyze(parseGCode(gcode), workcell, state);
    expect(r.verdict).toBe("block");
    expect(r.diagnostics.some((d) => d.code === "NF201")).toBe(true);
    expect(r.diagnostics.some((d) => d.code === "NF202")).toBe(true);
  });

  it("passes examples against their own state", () => {
    for (const id of ["bracket", "clean", "overtravel", "messy"]) {
      const { gcode, workcell, state } = load(id);
      const withState = analyze(parseGCode(gcode), workcell, state);
      const without = analyze(parseGCode(gcode), workcell);
      // identity offsets must not change existing verdicts
      expect(withState.verdict).toBe(without.verdict);
    }
  });

  it("flags a translated envelope that exceeds travel (NF203)", () => {
    const { gcode, workcell } = load("clean");
    const shifted = parseState(JSON.stringify({
      control: "sim",
      offsets: { G54: { x: 200, y: 0, z: 0 } },
      tools: {},
    }));
    const r = analyze(parseGCode(gcode), workcell, shifted);
    expect(r.diagnostics.some((d) => d.code === "NF203")).toBe(true);
  });

  it("translates geometry checks by the active offset", () => {
    const { gcode, workcell } = load("clean");
    const ok = parseState(JSON.stringify({
      control: "sim",
      offsets: { G54: { x: 10, y: 10, z: 0 } },
      tools: {},
    }));
    const r = analyze(parseGCode(gcode), workcell, ok);
    expect(r.diagnostics.filter((d) => d.code === "NF002")).toHaveLength(0);
  });

  it("rejects invalid state files hard", () => {
    expect(() => parseState("{ nope")).toThrow();
    expect(() => parseState(JSON.stringify({ offsets: { G50: { x: 0, y: 0, z: 0 } } }))).toThrow();
  });
});
'@
Write-File "tests/state.test.ts" $c

# docs/STATE.md
$c = @'
# Machine state snapshot

A state snapshot records the machine configuration a program is verified
against. It is the pre-flight half of NineForge: the workcell says what the
machine IS; the state says how the machine is SET UP right now.

{
  "control": "human-readable control name",
  "offsets": {
    "G54": { "x": 0, "y": 0, "z": 0 },
    "G55": { "x": 120, "y": 0, "z": 0 }
  },
  "tools": {
    "T01": { "diameter": 6, "length": 50 },
    "T02": { "diameter": 3, "length": 40 }
  }
}

Checks performed when a state is provided:

- NF201: program references a work offset not present in the state.
- NF202: program references a tool not present in the tool table.
- NF203: the program work envelope, translated by an offset, exceeds travel.
- NF204: multiple offsets referenced; geometry checks use the first defined
  offset (disclosed simplification).

Geometry and fixture checks are translated by the active offset
(first referenced offset that exists in the state, else G54, else identity).

States should be versioned next to programs. A verified (program, workcell,
state) triple is the unit of reproducibility.
'@
Write-File "docs/STATE.md" $c

# Targeted doc/README/changelog updates
Patch-File "docs/SCOPE.md" `
- NF102: words and G-codes outside the modeled set.` `
- NF102: words and G-codes outside the modeled set.
- NF201: work offset referenced by the program but absent from the state.
- NF202: tool referenced by the program but absent from the tool table.
- NF203: work envelope under a work offset exceeds machine travel.
- NF204: multiple work offsets referenced (partial modeling, disclosed).

When a machine state snapshot is provided (docs/STATE.md), program
coordinates are interpreted in work coordinates and translated by the
active offset. Without a state, coordinates are assumed to be machine
coordinates (identity offset).`

Patch-File "docs/WORKCELL.md" `
- Invalid structure is a hard error, never a silent default.` `
- Invalid structure is a hard error, never a silent default.

## Machine state

The workcell is static; the setup is dynamic. Keep the machine state
snapshot (offsets, tool table) in a separate file next to the workcell;
see docs/STATE.md. Verify programs against (workcell, state) pairs and
version both with the program.`

Patch-File "README.md" `
It is a lint step. It never replaces CAM verification or a prove-out.` `
It is a pre-flight step: it verifies that a program's assumptions - units,
work offsets, tools, envelope - match the workcell and the machine state it
is about to run in. It never replaces CAM verification or a prove-out.`

Patch-File "README.md" `
  - NF100/NF101/NF102 features that are present but not modeled (info/warning)` `
  - NF100/NF101/NF102 features that are present but not modeled (info/warning)
  - NF201-NF204 pre-flight mismatches between program assumptions and the
    machine state snapshot (docs/STATE.md)`

Patch-File "CHANGELOG.md" `
# Changelog` `
# Changelog

## 0.3.0 - 2026-08-04

Pre-flight verification.

- Added: machine state snapshots (docs/STATE.md), program assumption
  extraction (units, work offsets, tools, envelope), NF201-NF204
  diagnostics, offset-translated geometry checks, --state in the CLI,
  state support in the API and UI, mismatch example, state tests.
- Changed: analysis is now analyze(program, workcell, state?); without a
  state, behavior is unchanged (identity offset, documented).
- Why: real first-article crashes are dominated by context mismatch
  (offsets, tools, configuration), not toolpath math. Verifying program
  assumptions against machine state is the overlooked, deterministic,
  model-proof capability.`

Patch-File "package.json" `"version": "0.2.0",` `"version": "0.3.0",`

# UI: add state panel (full page rewrite with state wiring)
$c = @'
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { EXAMPLES } from "@/lib/examples";
import { parseGCode } from "@/lib/parse";
import { analyze } from "@/lib/analyze";
import { parseWorkcell } from "@/lib/workcell";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";
import { suggestFixes } from "@/lib/fix";
import { PERTURBATIONS } from "@/lib/perturb";
import { AnalysisResult, MachineState, Segment, Workcell } from "@/lib/types";

const Viewer = dynamic(() => import("@/components/Viewer"), { ssr: false });

const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/nineforge/nineforge";

type StressRow = { name: string; verdict: string };

export default function Home() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [gcode, setGcode] = useState("");
  const [workcellJson, setWorkcellJson] = useState("");
  const [stateJson, setStateJson] = useState("");
  const [workcell, setWorkcell] = useState<Workcell | null>(null);
  const [state, setState] = useState<MachineState | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stress, setStress] = useState<StressRow[] | null>(null);
  const [fixNotes, setFixNotes] = useState<string[] | null>(null);

  function run(nextGcode: string, nextWcJson: string, nextStJson: string) {
    setError(null);
    setStress(null);
    try {
      const wc = parseWorkcell(nextWcJson);
      const st = nextStJson.trim() ? parseState(nextStJson) : null;
      const pr = parseGCode(nextGcode);
      setWorkcell(wc);
      setState(st);
      setSegments(pr.segments);
      setResult(analyze(pr, wc, st));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkcell(null);
      setState(null);
      setResult(null);
      setSegments([]);
    }
  }

  async function loadExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    const [nc, wc, st] = await Promise.all([
      fetch(ex.nc).then((r) => r.text()),
      fetch(ex.workcell).then((r) => r.text()),
      fetch(ex.state).then((r) => r.text()),
    ]);
    setExampleId(id);
    setGcode(nc);
    setWorkcellJson(wc);
    setStateJson(st);
    setFixNotes(null);
    run(nc, wc, st);
  }

  useEffect(() => {
    void loadExample(EXAMPLES[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>, kind: "nc" | "wc" | "st") {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (kind === "nc") { setGcode(text); run(text, workcellJson, stateJson); }
      else if (kind === "wc") { setWorkcellJson(text); run(gcode, text, stateJson); }
      else { setStateJson(text); run(gcode, workcellJson, text); }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  function doFix() {
    if (!workcell) return;
    const fix = suggestFixes(gcode, workcell, segments);
    setGcode(fix.gcode);
    setWorkcellJson(JSON.stringify(fix.workcell, null, 2));
    setFixNotes(fix.notes);
    run(fix.gcode, JSON.stringify(fix.workcell), stateJson);
  }

  function doStress() {
    if (!workcell) return;
    setStress(
      PERTURBATIONS.map((p) => {
        const v = p.apply(gcode, workcell);
        return { name: p.name, verdict: analyze(parseGCode(v.gcode), v.workcell, state).verdict };
      })
    );
  }

  function exportReport() {
    if (!result || !workcell) return;
    const lines: string[] = [];
    lines.push("# NineForge analysis report");
    lines.push("");
    lines.push("Machine: " + workcell.machine);
    lines.push("State: " + (state ? state.control : "none (coordinates assumed machine-frame)"));
    lines.push("Date: " + new Date().toISOString());
    lines.push("Verdict: " + result.verdict.toUpperCase());
    lines.push("");
    lines.push("## Diagnostics");
    if (result.diagnostics.length === 0) lines.push("- none");
    for (const d of result.diagnostics) {
      lines.push("- [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
    }
    lines.push("");
    lines.push("## Stats");
    lines.push("- segments: " + result.stats.segments);
    lines.push("- distance: " + result.stats.distanceMm + " mm");
    lines.push("- estimated duration: " + result.stats.durationSec + " s");
    if (stress) {
      lines.push("");
      lines.push("## Stress screen");
      const ok = stress.filter((s) => s.verdict !== "block").length;
      lines.push("Survives " + ok + "/" + stress.length + " perturbed workcells.");
      for (const s of stress) {
        lines.push("- " + (s.verdict === "block" ? "FAIL" : "ok") + " " + s.name);
      }
    }
    lines.push("");
    lines.push("---");
    lines.push(
      "NineForge verifies program assumptions against the workcell and machine state. It does not replace CAM verification or a physical prove-out."
    );
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nineforge-report.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const verdictColor =
    result?.verdict === "block"
      ? "text-red-400"
      : result?.verdict === "caution"
      ? "text-yellow-400"
      : "text-lime-300";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">NineForge</h1>
          <p className="text-neutral-400">
            Pre-flight verification for CNC workcells: does this program's
            assumptions match the world it is about to run in?
          </p>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
            Scope: deterministic geometry, process rules, and state
            cross-checks. Reports what it does not model. Never replaces CAM
            verification or a prove-out.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-neutral-900 p-4">
          <select
            value={exampleId}
            onChange={(e) => loadExample(e.target.value)}
            className="rounded-xl border bg-neutral-950 px-3 py-2 text-sm"
          >
            {EXAMPLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
            Load .nc
            <input type="file" accept=".nc,.gcode,.tap,.txt" className="hidden"
              onChange={(e) => onFile(e, "nc")} />
          </label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
            Load workcell
            <input type="file" accept=".json" className="hidden"
              onChange={(e) => onFile(e, "wc")} />
          </label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
            Load state
            <input type="file" accept=".json" className="hidden"
              onChange={(e) => onFile(e, "st")} />
          </label>
          <button onClick={() => run(gcode, workcellJson, stateJson)}
            className="rounded-xl bg-lime-400 px-4 py-2 font-semibold text-black hover:bg-lime-300">
            Analyze
          </button>
          <button onClick={doFix} disabled={!workcell}
            className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">
            Suggest fixes
          </button>
          <button onClick={doStress} disabled={!workcell}
            className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">
            Stress screen
          </button>
          <button onClick={exportReport} disabled={!result}
            className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">
            Export report
          </button>
        </div>

        {error && (
          <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-2xl border bg-neutral-900 p-5">
            <textarea
              value={gcode}
              onChange={(e) => setGcode(e.target.value)}
              className="h-48 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-lime-300"
              spellCheck={false}
            />
            <textarea
              value={workcellJson}
              onChange={(e) => setWorkcellJson(e.target.value)}
              className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-sky-300"
              spellCheck={false}
            />
            <textarea
              value={stateJson}
              onChange={(e) => setStateJson(e.target.value)}
              className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-amber-300"
              spellCheck={false}
            />
            <div className="rounded-2xl border bg-neutral-950 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Diagnostics</h3>
                <span className={"font-semibold " + verdictColor}>
                  {result ? result.verdict.toUpperCase() : "--"}
                </span>
              </div>
              {result?.diagnostics.length ? (
                <ul className="space-y-2 text-sm text-neutral-300">
                  {result.diagnostics.map((d, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span>
                        <span className={
                          d.severity === "error"
                            ? "font-semibold text-red-400"
                            : d.severity === "warning"
                            ? "font-semibold text-yellow-400"
                            : "font-semibold text-sky-400"
                        }>
                          {d.code}
                        </span>{" "}
                        {d.message}
                      </span>
                      <a
                        className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
                        target="_blank"
                        rel="noreferrer"
                        href={
                          REPO_URL + "/issues/new?template=false_positive.md&title=" +
                          encodeURIComponent("[false positive] " + d.code)
                        }
                      >
                        report
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">
                  {result ? "No diagnostics." : "Run an analysis."}
                </p>
              )}
              {result && (
                <p className="mt-3 text-sm text-neutral-400">{summarize(result)}</p>
              )}
              {fixNotes && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-400">
                  {fixNotes.map((n, i) => (<li key={i}>{n}</li>))}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <Viewer segments={segments} fixtures={workcell?.fixtures ?? []} />
            {result && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border bg-neutral-900 p-4">
                  <div className="text-sm text-neutral-500">Segments</div>
                  <div className="mt-1 text-2xl font-semibold">{result.stats.segments}</div>
                </div>
                <div className="rounded-2xl border bg-neutral-900 p-4">
                  <div className="text-sm text-neutral-500">Distance</div>
                  <div className="mt-1 text-2xl font-semibold">{result.stats.distanceMm} mm</div>
                </div>
                <div className="rounded-2xl border bg-neutral-900 p-4">
                  <div className="text-sm text-neutral-500">Est. duration</div>
                  <div className="mt-1 text-2xl font-semibold">{result.stats.durationSec} s</div>
                </div>
              </div>
            )}
            {stress && (
              <div className="rounded-2xl border bg-neutral-900 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Stress screen</h3>
                  <span className="rounded-full border px-3 py-1 text-sm">
                    survives {stress.filter((s) => s.verdict !== "block").length}/{stress.length}
                  </span>
                </div>
                <ul className="grid gap-2 md:grid-cols-2">
                  {stress.map((s, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>{s.name}</span>
                      <span className={s.verdict === "block" ? "text-red-400" : "text-lime-300"}>
                        {s.verdict === "block" ? "FAIL" : "ok"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
'@
Write-File "app/page.tsx" $c

Write-Host ""
Write-Host "0.3.0 pre-flight patch complete."