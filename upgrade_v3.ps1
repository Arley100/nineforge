$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "nineforge"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-File {
    param([string]$RelativePath, [string]$Content)
    $fullPath = Join-Path $root $RelativePath
    $directory = Split-Path $fullPath -Parent
    if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    [System.IO.File]::WriteAllText($fullPath, $Content, $utf8NoBom)
    Write-Host "wrote $RelativePath"
}

# 1. Clean up old v0.1 / Operator Mode files
$oldDirs = @("lib", "app", "cli", "tests", "docs", "public", "scripts")
foreach ($d in $oldDirs) {
    $p = Join-Path $root $d
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; Write-Host "Removed old folder: $d" }
}

# 2. Core Config
Write-File "package.json" @'
{
  "name": "nineforge",
  "version": "0.3.0",
  "private": false,
  "license": "MIT",
  "description": "A static analyzer and robustness screen for CNC G-code workcells.",
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 5173",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check:example": "tsx cli/main.ts check public/examples/bracket.nc --workcell public/examples/bracket.workcell.json --state public/examples/bracket.state.json --stress"
  },
  "dependencies": {
    "@react-three/drei": "^9.122.0",
    "@react-three/fiber": "^8.18.0",
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "three": "^0.166.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.166.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.7",
    "tsx": "^4.19.2",
    "typescript": "^5.5.3",
    "vitest": "^2.1.9"
  }
}
'@

Write-File "tsconfig.json" @'
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
'@

Write-File "next.config.mjs" @'
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
'@

Write-File "postcss.config.mjs" @'
/** @type {import('postcss-load-config').Config} */
const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
export default config;
'@

Write-File "tailwind.config.ts" @'
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
'@

Write-File "next-env.d.ts" @'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
'@

Write-File "vitest.config.ts" @'
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
'@

Write-File ".gitignore" @'
node_modules
.next
out
build
.DS_Store
*.pem
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.env
.env.local
*.tsbuildinfo
nineforge.zip
'@

# 3. Core Library (v0.3 Pre-flight)
Write-File "lib/types.ts" @'
export type Vec3 = { x: number; y: number; z: number; };
export type Segment = { from: Vec3; to: Vec3; motion: "rapid" | "linear"; feed: number; feedSet: boolean; line: number; };
export type Diagnostic = { code: string; severity: "error" | "warning" | "info"; message: string; line?: number; };
export type FixtureBox = { name: string; min: Vec3; max: Vec3; };
export type Workcell = { machine: string; units: "mm"; limits: { min: Vec3; max: Vec3 }; rapidFeed: number; fixtures: FixtureBox[]; feedLimit?: number; };
export type MachineState = { control: string; offsets: Record<string, Vec3>; tools: Record<string, { diameter?: number; length?: number }>; };
export type ProgramAssumptions = { units: "mm" | "in"; offsetsUsed: string[]; toolsUsed: string[]; envelope: { min: Vec3; max: Vec3 } | null; };
export type ParseResult = { segments: Segment[]; diagnostics: Diagnostic[]; units: "mm" | "in"; assumptions: ProgramAssumptions; };
export type Verdict = "block" | "caution" | "pass";
export type AnalysisResult = { diagnostics: Diagnostic[]; verdict: Verdict; stats: { segments: number; distanceMm: number; rapidDistanceMm: number; durationSec: number; }; };
'@

Write-File "lib/parse.ts" @'
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
  const note = (key: string, d: Diagnostic) => { if (!noted.has(key)) { noted.add(key); diagnostics.push(d); } };
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
        else if (value >= 54 && value <= 59) { const name = "G" + value; if (!offsetsUsed.includes(name)) offsetsUsed.push(name); }
        else if (value === 2 || value === 3) note("arc", { code: "NF100", severity: "info", message: "Arc moves (G2/G3) are not modeled; geometry results are incomplete.", line: lineNo });
        else if (value === 91) note("g91", { code: "NF101", severity: "warning", message: "Incremental positioning (G91) is not supported; coordinates are treated as absolute.", line: lineNo });
        else if (!KNOWN_G.has(value)) note("g" + value, { code: "NF102", severity: "info", message: "G" + value + " is not modeled and was ignored.", line: lineNo });
      } else if (letter === "X") next.x = value;
      else if (letter === "Y") next.y = value;
      else if (letter === "Z") next.z = value;
      else if (letter === "F") { localFeed = value; localFeedSet = true; }
      else if (letter === "T") { const name = "T" + String(value).padStart(2, "0"); if (!toolsUsed.includes(name)) toolsUsed.push(name); }
      else if (letter === "M" || letter === "N" || letter === "S") {}
      else note("word" + letter, { code: "NF102", severity: "info", message: "Word '" + letter + "' is not modeled and was ignored.", line: lineNo });
    }
    const hasMotion = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z;
    if (hasMotion) {
      const s = units === "in" ? IN_TO_MM : 1;
      segments.push({ from: { x: pos.x * s, y: pos.y * s, z: pos.z * s }, to: { x: next.x * s, y: next.y * s, z: next.z * s }, motion: localMotion, feed: localFeed * s, feedSet: localFeedSet, line: lineNo });
      pos = next; motion = localMotion; feed = localFeed;
    } else { motion = localMotion; feed = localFeed; }
  });
  let envelope: { min: Vec3; max: Vec3 } | null = null;
  if (segments.length) {
    const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
    const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const s of segments) { for (const p of [s.from, s.to]) { min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x); min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y); min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z); } }
    envelope = { min, max };
  }
  return { segments, diagnostics, units, assumptions: { units, offsetsUsed, toolsUsed, envelope } };
}
'@

Write-File "lib/analyze.ts" @'
import { AnalysisResult, Diagnostic, FixtureBox, MachineState, ParseResult, Vec3, Workcell } from "./types";
function pointInBox(p: Vec3, b: FixtureBox): boolean { return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z; }
function segmentIntersectsBox(a: Vec3, b: Vec3, box: FixtureBox): boolean { for (let i = 0; i <= 24; i++) { const t = i / 24; const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; if (pointInBox(p, box)) return true; } return false; }
function outOfLimits(p: Vec3, w: Workcell): boolean { return p.x < w.limits.min.x || p.x > w.limits.max.x || p.y < w.limits.min.y || p.y > w.limits.max.y || p.z < w.limits.min.z || p.z > w.limits.max.z; }
function distance(a: Vec3, b: Vec3): number { return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2); }
export function analyze(parse: ParseResult, workcell: Workcell, state?: MachineState | null): AnalysisResult {
  const diagnostics: Diagnostic[] = [...parse.diagnostics];
  const feedLimit = workcell.feedLimit ?? 1000;
  const a = parse.assumptions;
  let shift: Vec3 = { x: 0, y: 0, z: 0 };
  if (state) {
    for (const o of a.offsetsUsed) { if (!state.offsets[o]) diagnostics.push({ code: "NF201", severity: "error", message: "Program references " + o + " but it is not defined in the machine state." }); }
    for (const t of a.toolsUsed) { if (!state.tools[t]) diagnostics.push({ code: "NF202", severity: "error", message: "Program references " + t + " but it is not present in the tool table." }); }
    if (a.envelope) { for (const o of a.offsetsUsed) { const off = state.offsets[o]; if (!off) continue; const e = a.envelope; if (e.min.x + off.x < workcell.limits.min.x || e.max.x + off.x > workcell.limits.max.x || e.min.y + off.y < workcell.limits.min.y || e.max.y + off.y > workcell.limits.max.y || e.min.z + off.z < workcell.limits.min.z || e.max.z + off.z > workcell.limits.max.z) diagnostics.push({ code: "NF203", severity: "error", message: "Work envelope under " + o + " exceeds machine travel." }); } }
    if (a.offsetsUsed.length > 1) diagnostics.push({ code: "NF204", severity: "info", message: "Multiple work offsets referenced; geometry checks use the first defined offset." });
    const primaryName = a.offsetsUsed.find((o) => state.offsets[o]) ?? (state.offsets["G54"] ? "G54" : null);
    if (primaryName && state.offsets[primaryName]) shift = state.offsets[primaryName];
  }
  const add = (p: Vec3): Vec3 => ({ x: p.x + shift.x, y: p.y + shift.y, z: p.z + shift.z });
  let distanceMm = 0, rapidDistanceMm = 0, durationSec = 0;
  for (const seg of parse.segments) {
    const from = add(seg.from); const to = add(seg.to); const d = distance(from, to); distanceMm += d;
    if (seg.motion === "rapid") { rapidDistanceMm += d; durationSec += (d / Math.max(1, workcell.rapidFeed)) * 60; } else { durationSec += (d / Math.max(1, seg.feed)) * 60; }
    if (outOfLimits(from, workcell) || outOfLimits(to, workcell)) diagnostics.push({ code: "NF002", severity: "error", message: "Motion exceeds machine travel limits (line " + seg.line + ").", line: seg.line });
    for (const f of workcell.fixtures) { if (segmentIntersectsBox(from, to, f)) diagnostics.push({ code: "NF001", severity: "error", message: "Toolpath intersects fixture '" + f.name + "' (line " + seg.line + ").", line: seg.line }); }
    if (seg.motion === "linear" && seg.feedSet && seg.feed > feedLimit) diagnostics.push({ code: "NF003", severity: "warning", message: "Feed " + Math.round(seg.feed) + " mm/min exceeds workcell feed limit " + feedLimit + " (line " + seg.line + ").", line: seg.line });
    const horizontal = Math.abs(from.x - to.x) > 0.1 || Math.abs(from.y - to.y) > 0.1;
    if (seg.motion === "rapid" && horizontal && Math.min(from.z, to.z) < 2 && d > 0.1) diagnostics.push({ code: "NF004", severity: "warning", message: "Rapid traverse at low Z (" + Math.min(from.z, to.z).toFixed(2) + ") near line " + seg.line + ".", line: seg.line });
  }
  const seen = new Set<string>();
  const deduped = diagnostics.filter((x) => { const k = x.code + "|" + (x.line ?? 0) + "|" + x.message; if (seen.has(k)) return false; seen.add(k); return true; });
  const verdict = deduped.some((x) => x.severity === "error") ? "block" : deduped.some((x) => x.severity === "warning") ? "caution" : "pass";
  return { diagnostics: deduped, verdict, stats: { segments: parse.segments.length, distanceMm: Math.round(distanceMm), rapidDistanceMm: Math.round(rapidDistanceMm), durationSec: Math.round(durationSec) } };
}
'@

Write-File "lib/workcell.ts" @'
import { FixtureBox, Workcell } from "./types";
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
export function parseWorkcell(json: string): Workcell {
  let raw: any; try { raw = JSON.parse(json); } catch { throw new Error("Workcell file is not valid JSON."); }
  const limits = raw?.limits; if (!limits?.min || !limits?.max) throw new Error("Workcell must define limits.min and limits.max.");
  for (const p of [limits.min, limits.max]) { if (!isNum(p.x) || !isNum(p.y) || !isNum(p.z)) throw new Error("Workcell limits must be numeric x/y/z."); }
  const fixtures: FixtureBox[] = Array.isArray(raw.fixtures) ? raw.fixtures.map((f: any, i: number) => { if (!f?.min || !f?.max || !isNum(f.min.x) || !isNum(f.max.x)) throw new Error("Fixture " + i + " must define numeric min and max."); return { name: typeof f.name === "string" ? f.name : "fixture-" + (i + 1), min: f.min, max: f.max }; }) : [];
  return { machine: typeof raw.machine === "string" ? raw.machine : "unnamed machine", units: "mm", limits, rapidFeed: isNum(raw?.rapidFeed) ? raw.rapidFeed : 5000, fixtures, feedLimit: isNum(raw?.feedLimit) ? raw.feedLimit : undefined };
}
'@

Write-File "lib/state.ts" @'
import { MachineState, Vec3 } from "./types";
function isNum(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isVec(v: any): v is Vec3 { return v && isNum(v.x) && isNum(v.y) && isNum(v.z); }
export function parseState(json: string): MachineState {
  let raw: any; try { raw = JSON.parse(json); } catch { throw new Error("Machine state file is not valid JSON."); }
  const offsets: Record<string, Vec3> = {};
  if (raw?.offsets && typeof raw.offsets === "object") { for (const [k, v] of Object.entries(raw.offsets)) { if (!/^G5[4-9]$/.test(k)) throw new Error("Offset '" + k + "' is not a supported work offset (G54-G59)."); if (!isVec(v)) throw new Error("Offset " + k + " must be numeric x/y/z."); offsets[k] = v; } }
  const tools: Record<string, { diameter?: number; length?: number }> = {};
  if (raw?.tools && typeof raw.tools === "object") { for (const [k, v] of Object.entries(raw.tools)) { if (!/^T\d{2}$/.test(k)) throw new Error("Tool '" + k + "' must be named Tnn (e.g. T01)."); const t: any = v ?? {}; tools[k] = { diameter: isNum(t.diameter) ? t.diameter : undefined, length: isNum(t.length) ? t.length : undefined }; } }
  return { control: typeof raw?.control === "string" ? raw.control : "unspecified", offsets, tools };
}
'@

Write-File "lib/perturb.ts" @'
import { Workcell } from "./types";
export type Perturbation = { id: string; name: string; apply: (gcode: string, workcell: Workcell) => { gcode: string; workcell: Workcell }; };
function shiftFixture(w: Workcell, dx: number, dy: number): Workcell { return { ...w, fixtures: w.fixtures.map((f) => ({ ...f, min: { x: f.min.x + dx, y: f.min.y + dy, z: f.min.z }, max: { x: f.max.x + dx, y: f.max.y + dy, z: f.max.z } })) }; }
function growFixtures(w: Workcell, margin: number): Workcell { return { ...w, fixtures: w.fixtures.map((f) => ({ ...f, min: { x: f.min.x - margin, y: f.min.y - margin, z: f.min.z }, max: { x: f.max.x + margin, y: f.max.y + margin, z: f.max.z } })) }; }
function shiftCoords(gcode: string, dx: number, dy: number): string { return gcode.split(/\r?\n/).map((line) => { const clean = line.split(";")[0]; if (!clean.trim()) return line; return clean.split(/\s+/).map((w) => { const u = w.toUpperCase(); if (u.startsWith("X")) return "X" + (Number(u.slice(1)) + dx); if (u.startsWith("Y")) return "Y" + (Number(u.slice(1)) + dy); return w; }).join(" "); }).join("\n"); }
function scaleFeeds(gcode: string, factor: number): string { return gcode.split(/\r?\n/).map((line) => { const clean = line.split(";")[0]; if (!clean.trim()) return line; return clean.split(/\s+/).map((w) => { const u = w.toUpperCase(); if (u.startsWith("F")) return "F" + Math.round(Number(u.slice(1)) * factor); return w; }).join(" "); }).join("\n"); }
export const PERTURBATIONS: Perturbation[] = [
  { id: "base", name: "Nominal workcell", apply: (g, w) => ({ gcode: g, workcell: w }) },
  { id: "fx+2", name: "Fixture +2mm X", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 2, 0) }) },
  { id: "fx-2", name: "Fixture -2mm X", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, -2, 0) }) },
  { id: "fy+2", name: "Fixture +2mm Y", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 0, 2) }) },
  { id: "fy-2", name: "Fixture -2mm Y", apply: (g, w) => ({ gcode: g, workcell: shiftFixture(w, 0, -2) }) },
  { id: "zero+1", name: "Work zero +1mm X", apply: (g, w) => ({ gcode: shiftCoords(g, 1, 0), workcell: w }) },
  { id: "zero-1", name: "Work zero -1mm Y", apply: (g, w) => ({ gcode: shiftCoords(g, 0, -1), workcell: w }) },
  { id: "wear", name: "Fixture margin +0.5mm", apply: (g, w) => ({ gcode: g, workcell: growFixtures(w, 0.5) }) },
  { id: "feed110", name: "Feed override 110%", apply: (g, w) => ({ gcode: scaleFeeds(g, 1.1), workcell: w }) },
  { id: "feed125", name: "Feed override 125%", apply: (g, w) => ({ gcode: scaleFeeds(g, 1.25), workcell: w }) },
];
'@

Write-File "lib/fix.ts" @'
import { Segment, Workcell } from "./types";
export type FixSuggestion = { gcode: string; workcell: Workcell; notes: string[]; };
export function suggestFixes(gcode: string, workcell: Workcell, segments: Segment[]): FixSuggestion {
  const notes: string[] = [];
  const fixedGcode = gcode.split(/\r?\n/).map((line) => { const clean = line.split(";")[0]; if (!clean.trim()) return line; return clean.split(/\s+/).map((w) => { const u = w.toUpperCase(); if (u.startsWith("F") && Number(u.slice(1)) > 900) return "F900"; return w; }).join(" "); }).join("\n");
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segments) { for (const p of [s.from, s.to]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); } }
  const margin = 20;
  const fixedWorkcell: Workcell = { ...workcell, fixtures: workcell.fixtures.map((f) => { const overlaps = f.max.x >= minX && f.min.x <= maxX && f.max.y >= minY && f.min.y <= maxY; if (!overlaps) return f; const h = f.max.y - f.min.y; const newY = maxY + margin; notes.push("Suggested: move fixture '" + f.name + "' clear of the toolpath bounding box."); return { ...f, min: { x: f.min.x, y: newY, z: f.min.z }, max: { x: f.max.x, y: newY + h, z: f.max.z } }; }) };
  if (fixedGcode !== gcode) notes.push("Suggested: cap programmed feeds at 900 mm/min.");
  if (notes.length === 0) notes.push("No structural suggestions; review diagnostics manually.");
  return { gcode: fixedGcode, workcell: fixedWorkcell, notes };
}
'@

Write-File "lib/summarize.ts" @'
import { AnalysisResult } from "./types";
export function summarize(r: AnalysisResult): string {
  const errors = r.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = r.diagnostics.filter((d) => d.severity === "warning").length;
  const infos = r.diagnostics.filter((d) => d.severity === "info").length;
  if (r.verdict === "block") return "BLOCK: " + errors + " error(s), " + warnings + " warning(s). Do not run this program until errors are resolved.";
  if (r.verdict === "caution") return "CAUTION: no errors, " + warnings + " warning(s), " + infos + " note(s). Review before running.";
  return "PASS within modeled checks (" + infos + " note(s)). Not a substitute for CAM verification or a physical prove-out.";
}
'@

Write-File "lib/examples.ts" @'
export type ExampleRef = { id: string; name: string; description: string; nc: string; workcell: string; state: string; };
export const EXAMPLES: ExampleRef[] = [
  { id: "bracket", name: "Bracket with fixture collision", description: "Demonstrates NF001 (collision) and NF003 (feed limit).", nc: "/examples/bracket.nc", workcell: "/examples/bracket.workcell.json", state: "/examples/bracket.state.json" },
  { id: "clean", name: "Clean pocket job", description: "Expected verdict: pass.", nc: "/examples/clean.nc", workcell: "/examples/clean.workcell.json", state: "/examples/clean.state.json" },
  { id: "overtravel", name: "Over-travel job", description: "Demonstrates NF002 (travel limits).", nc: "/examples/overtravel.nc", workcell: "/examples/overtravel.workcell.json", state: "/examples/overtravel.state.json" },
  { id: "messy", name: "Messy real-world file", description: "Lowercase, comments, modal feeds. Expected verdict: pass.", nc: "/examples/messy.nc", workcell: "/examples/messy.workcell.json", state: "/examples/messy.state.json" },
  { id: "mismatch", name: "Setup mismatch (pre-flight)", description: "Program assumes G55 and T07; state defines G54 and T01. NF201 + NF202.", nc: "/examples/mismatch.nc", workcell: "/examples/mismatch.workcell.json", state: "/examples/mismatch.state.json" },
];
'@

# 4. CLI
Write-File "cli/main.ts" @'
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
import { summarize } from "../lib/summarize";
import { PERTURBATIONS } from "../lib/perturb";
function usage(): never { console.log("Usage: npx tsx cli/main.ts check <job.nc> --workcell <cell.json> [--state <state.json>] [--json] [--stress] [--strict]"); process.exit(2); }
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
const state = sIdx >= 0 && args[sIdx + 1] ? parseState(readFileSync(args[sIdx + 1], "utf8")) : null;
const result = analyze(parseGCode(gcode), workcell, state);
const stressRows = stress ? PERTURBATIONS.map((p) => { const v = p.apply(gcode, workcell); const r = analyze(parseGCode(v.gcode), v.workcell, state); return { name: p.name, verdict: r.verdict }; }) : [];
if (asJson) { console.log(JSON.stringify({ file, result, stress: stressRows }, null, 2)); } else {
  console.log("NineForge check: " + file);
  console.log("Workcell: " + workcell.machine + (state ? " | state: " + state.control : " | state: none"));
  for (const d of result.diagnostics) console.log("  [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
  console.log("  " + summarize(result));
  if (stress) { const ok = stressRows.filter((s) => s.verdict !== "block").length; console.log("  Stress: survives " + ok + "/" + stressRows.length + " perturbed workcells."); for (const s of stressRows) console.log("    " + (s.verdict === "block" ? "FAIL" : "ok") + "  " + s.name); }
}
const fail = result.verdict === "block" || (strict && result.verdict === "caution") || stressRows.some((s) => s.verdict === "block");
process.exit(fail ? 1 : 0);
'@

# 5. Web App
Write-File "app/globals.css" @'
@tailwind base;
@tailwind components;
@tailwind utilities;
:root { color-scheme: dark; }
html, body { height: 100%; }
body { @apply bg-neutral-950 text-neutral-100 antialiased; }
'@

Write-File "app/layout.tsx" @'
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = { title: "NineForge", description: "Prove physical AI before it moves." };
export default function RootLayout({ children }: { children: ReactNode }) { return (<html lang="en"><body>{children}</body></html>); }
'@

Write-File "app/api/analyze/route.ts" @'
import { NextResponse } from "next/server";
import { parseGCode } from "@/lib/parse";
import { analyze } from "@/lib/analyze";
import { parseWorkcell } from "@/lib/workcell";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body.gcode !== "string") return NextResponse.json({ error: "gcode (string) is required" }, { status: 400 });
    const workcell = parseWorkcell(typeof body.workcell === "string" ? body.workcell : JSON.stringify(body.workcell));
    const state = body.state ? parseState(typeof body.state === "string" ? body.state : JSON.stringify(body.state)) : null;
    const result = analyze(parseGCode(body.gcode), workcell, state);
    return NextResponse.json({ result, summary: summarize(result) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 }); }
}
'@

Write-File "components/Viewer.tsx" @'
"use client";
import { Canvas } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import { FixtureBox, Segment, Vec3 } from "@/lib/types";
function toThree(p: Vec3): [number, number, number] { return [p.x, p.z, p.y]; }
function Fixture({ box }: { box: FixtureBox }) {
  const sizeX = Math.max(0.01, box.max.x - box.min.x);
  const sizeY = Math.max(0.01, box.max.z - box.min.z);
  const sizeZ = Math.max(0.01, box.max.y - box.min.y);
  const centerX = box.min.x + sizeX / 2;
  const centerY = box.min.z + sizeY / 2;
  const centerZ = box.min.y + sizeZ / 2;
  return (<mesh position={[centerX, centerY, centerZ]}><boxGeometry args={[sizeX, sizeY, sizeZ]} /><meshStandardMaterial color="#ef4444" transparent opacity={0.28} /></mesh>);
}
export default function Viewer({ segments, fixtures }: { segments: Segment[]; fixtures: FixtureBox[] }) {
  return (
    <div className="h-[480px] w-full rounded-xl border bg-neutral-950">
      <Canvas camera={{ position: [180, 140, 180], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[120, 180, 120]} intensity={1.2} />
        <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={900} cellColor="#333" sectionColor="#555" />
        {fixtures.map((box, i) => (<Fixture key={i} box={box} />))}
        {segments.map((seg, i) => { const color = seg.motion === "rapid" ? "#3b82f6" : "#f59e0b"; const points: [number, number, number][] = [toThree(seg.from), toThree(seg.to)]; return <Line key={i} points={points} color={color} lineWidth={2} />; })}
        <OrbitControls />
      </Canvas>
    </div>
  );
}
'@

Write-File "app/page.tsx" @'
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
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/nineforge/nineforge";
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
    setError(null); setStress(null);
    try {
      const wc = parseWorkcell(nextWcJson);
      const st = nextStJson.trim() ? parseState(nextStJson) : null;
      const pr = parseGCode(nextGcode);
      setWorkcell(wc); setState(st); setSegments(pr.segments); setResult(analyze(pr, wc, st));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setWorkcell(null); setState(null); setResult(null); setSegments([]); }
  }
  async function loadExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id); if (!ex) return;
    const [nc, wc, st] = await Promise.all([fetch(ex.nc).then((r) => r.text()), fetch(ex.workcell).then((r) => r.text()), fetch(ex.state).then((r) => r.text())]);
    setExampleId(id); setGcode(nc); setWorkcellJson(wc); setStateJson(st); setFixNotes(null); run(nc, wc, st);
  }
  useEffect(() => { void loadExample(EXAMPLES[0].id); }, []);
  function onFile(e: React.ChangeEvent<HTMLInputElement>, kind: "nc" | "wc" | "st") {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { const text = String(reader.result ?? ""); if (kind === "nc") { setGcode(text); run(text, workcellJson, stateJson); } else if (kind === "wc") { setWorkcellJson(text); run(gcode, text, stateJson); } else { setStateJson(text); run(gcode, workcellJson, text); } };
    reader.readAsText(f); e.target.value = "";
  }
  function doFix() { if (!workcell) return; const fix = suggestFixes(gcode, workcell, segments); setGcode(fix.gcode); setWorkcellJson(JSON.stringify(fix.workcell, null, 2)); setFixNotes(fix.notes); run(fix.gcode, JSON.stringify(fix.workcell), stateJson); }
  function doStress() { if (!workcell) return; setStress(PERTURBATIONS.map((p) => { const v = p.apply(gcode, workcell); return { name: p.name, verdict: analyze(parseGCode(v.gcode), v.workcell, state).verdict }; })); }
  function exportReport() {
    if (!result || !workcell) return;
    const lines: string[] = ["# NineForge analysis report", "", "Machine: " + workcell.machine, "State: " + (state ? state.control : "none (coordinates assumed machine-frame)"), "Date: " + new Date().toISOString(), "Verdict: " + result.verdict.toUpperCase(), "", "## Diagnostics"];
    if (result.diagnostics.length === 0) lines.push("- none");
    for (const d of result.diagnostics) lines.push("- [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
    lines.push("", "## Stats", "- segments: " + result.stats.segments, "- distance: " + result.stats.distanceMm + " mm", "- estimated duration: " + result.stats.durationSec + " s");
    if (stress) { lines.push("", "## Stress screen"); const ok = stress.filter((s) => s.verdict !== "block").length; lines.push("Survives " + ok + "/" + stress.length + " perturbed workcells."); for (const s of stress) lines.push("- " + (s.verdict === "block" ? "FAIL" : "ok") + " " + s.name); }
    lines.push("", "---", "NineForge verifies program assumptions against the workcell and machine state. It does not replace CAM verification or a physical prove-out.");
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "nineforge-report.md"; a.click(); URL.revokeObjectURL(url);
  }
  const verdictColor = result?.verdict === "block" ? "text-red-400" : result?.verdict === "caution" ? "text-yellow-400" : "text-lime-300";
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">NineForge</h1>
          <p className="text-neutral-400">Pre-flight verification for CNC workcells: does this program's assumptions match the world it is about to run in?</p>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">Scope: deterministic geometry, process rules, and state cross-checks. Reports what it does not model. Never replaces CAM verification or a prove-out.</p>
        </header>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-neutral-900 p-4">
          <select value={exampleId} onChange={(e) => loadExample(e.target.value)} className="rounded-xl border bg-neutral-950 px-3 py-2 text-sm">{EXAMPLES.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load .nc<input type="file" accept=".nc,.gcode,.tap,.txt" className="hidden" onChange={(e) => onFile(e, "nc")} /></label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load workcell<input type="file" accept=".json" className="hidden" onChange={(e) => onFile(e, "wc")} /></label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load state<input type="file" accept=".json" className="hidden" onChange={(e) => onFile(e, "st")} /></label>
          <button onClick={() => run(gcode, workcellJson, stateJson)} className="rounded-xl bg-lime-400 px-4 py-2 font-semibold text-black hover:bg-lime-300">Analyze</button>
          <button onClick={doFix} disabled={!workcell} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Suggest fixes</button>
          <button onClick={doStress} disabled={!workcell} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Stress screen</button>
          <button onClick={exportReport} disabled={!result} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Export report</button>
        </div>
        {error && (<p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>)}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-2xl border bg-neutral-900 p-5">
            <textarea value={gcode} onChange={(e) => setGcode(e.target.value)} className="h-48 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-lime-300" spellCheck={false} />
            <textarea value={workcellJson} onChange={(e) => setWorkcellJson(e.target.value)} className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-sky-300" spellCheck={false} />
            <textarea value={stateJson} onChange={(e) => setStateJson(e.target.value)} className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-amber-300" spellCheck={false} />
            <div className="rounded-2xl border bg-neutral-950 p-4">
              <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Diagnostics</h3><span className={"font-semibold " + verdictColor}>{result ? result.verdict.toUpperCase() : "--"}</span></div>
              {result?.diagnostics.length ? (
                <ul className="space-y-2 text-sm text-neutral-300">
                  {result.diagnostics.map((d, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span><span className={d.severity === "error" ? "font-semibold text-red-400" : d.severity === "warning" ? "font-semibold text-yellow-400" : "font-semibold text-sky-400"}>{d.code}</span> {d.message}</span>
                      <a className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800" target="_blank" rel="noreferrer" href={REPO_URL + "/issues/new?template=false_positive.md&title=" + encodeURIComponent("[false positive] " + d.code)}>report</a>
                    </li>
                  ))}
                </ul>
              ) : (<p className="text-sm text-neutral-500">{result ? "No diagnostics." : "Run an analysis."}</p>)}
              {result && (<p className="mt-3 text-sm text-neutral-400">{summarize(result)}</p>)}
              {fixNotes && (<ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-400">{fixNotes.map((n, i) => (<li key={i}>{n}</li>))}</ul>)}
            </div>
          </section>
          <section className="space-y-4">
            <Viewer segments={segments} fixtures={workcell?.fixtures ?? []} />
            {result && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Segments</div><div className="mt-1 text-2xl font-semibold">{result.stats.segments}</div></div>
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Distance</div><div className="mt-1 text-2xl font-semibold">{result.stats.distanceMm} mm</div></div>
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Est. duration</div><div className="mt-1 text-2xl font-semibold">{result.stats.durationSec} s</div></div>
              </div>
            )}
            {stress && (
              <div className="rounded-2xl border bg-neutral-900 p-5">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Stress screen</h3><span className="rounded-full border px-3 py-1 text-sm">survives {stress.filter((s) => s.verdict !== "block").length}/{stress.length}</span></div>
                <ul className="grid gap-2 md:grid-cols-2">{stress.map((s, i) => (<li key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>{s.name}</span><span className={s.verdict === "block" ? "text-red-400" : "text-lime-300"}>{s.verdict === "block" ? "FAIL" : "ok"}</span></li>))}</ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
'@

# 6. Tests
Write-File "tests/parse.test.ts" @'
import { describe, expect, it } from "vitest";
import { parseGCode } from "../lib/parse";
describe("parse", () => {
  it("parses modal motion and feed", () => { const r = parseGCode("G21 G90\nG0 X0 Y0\nG1 X10 Y0 F500\nG1 X20 Y0"); expect(r.segments).toHaveLength(2); expect(r.segments[1].feed).toBe(500); expect(r.segments[1].feedSet).toBe(false); });
  it("converts inches to millimetres", () => { const r = parseGCode("G20 G90\nG0 X0 Y0\nG1 X1 Y0 F100"); expect(r.segments[0].to.x).toBeCloseTo(25.4, 3); expect(r.units).toBe("in"); });
  it("flags arcs as not modeled", () => { const r = parseGCode("G21 G90\nG2 X10 Y0 I5 J0"); expect(r.diagnostics.some((d) => d.code === "NF100")).toBe(true); });
  it("flags incremental mode as unsupported", () => { const r = parseGCode("G91\nG1 X1 Y0 F100"); expect(r.diagnostics.some((d) => d.code === "NF101")).toBe(true); });
  it("ignores comments and parentheses", () => { const r = parseGCode("; hello\nG0 X5 Y5 (rapid)\n"); expect(r.segments).toHaveLength(1); });
});
'@

Write-File "tests/analyze.test.ts" @'
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
function load(id: string) { const gcode = readFileSync("public/examples/" + id + ".nc", "utf8"); const workcell = parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")); return analyze(parseGCode(gcode), workcell); }
describe("analyze on examples", () => {
  it("blocks the bracket job with collision and feed diagnostics", () => { const r = load("bracket"); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF001")).toBe(true); expect(r.diagnostics.some((d) => d.code === "NF003")).toBe(true); });
  it("passes the clean job", () => { expect(load("clean").verdict).toBe("pass"); });
  it("blocks over-travel", () => { const r = load("overtravel"); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF002")).toBe(true); });
  it("passes the messy real-world file", () => { expect(load("messy").verdict).toBe("pass"); });
});
describe("analyze regressions", () => {
  const wc = parseWorkcell(JSON.stringify({ machine: "t", limits: { min: { x: -100, y: -100, z: -100 }, max: { x: 100, y: 100, z: 100 } }, rapidFeed: 5000, fixtures: [] }));
  it("does not flag vertical rapids as low-Z hazards", () => { const r = analyze(parseGCode("G21 G90\nG0 Z5\nG0 Z10"), wc); expect(r.diagnostics.filter((d) => d.code === "NF004")).toHaveLength(0); });
  it("flags feed warnings only where the feed is set", () => { const r = analyze(parseGCode("G21 G90\nG1 X10 Y0 F1500\nG1 X20 Y0"), wc); const feeds = r.diagnostics.filter((d) => d.code === "NF003"); expect(feeds).toHaveLength(1); expect(feeds[0].line).toBe(2); });
});
'@

Write-File "tests/perturb_fix.test.ts" @'
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { PERTURBATIONS } from "../lib/perturb";
import { suggestFixes } from "../lib/fix";
function load(id: string) { const gcode = readFileSync("public/examples/" + id + ".nc", "utf8"); const workcell = parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")); return { gcode, workcell }; }
describe("perturbations", () => {
  it("clean job survives all perturbed workcells", () => { const { gcode, workcell } = load("clean"); for (const p of PERTURBATIONS) { const v = p.apply(gcode, workcell); expect(analyze(parseGCode(v.gcode), v.workcell).verdict).not.toBe("block"); } });
  it("bracket job blocks at nominal", () => { const { gcode, workcell } = load("bracket"); expect(analyze(parseGCode(gcode), workcell).verdict).toBe("block"); });
});
describe("suggestFixes", () => {
  it("resolves the bracket job to pass", () => { const { gcode, workcell } = load("bracket"); const segments = parseGCode(gcode).segments; const fix = suggestFixes(gcode, workcell, segments); const r = analyze(parseGCode(fix.gcode), fix.workcell); expect(r.verdict).toBe("pass"); expect(fix.notes.length).toBeGreaterThan(0); });
});
'@

Write-File "tests/workcell.test.ts" @'
import { describe, expect, it } from "vitest";
import { parseWorkcell } from "../lib/workcell";
describe("workcell validation", () => {
  it("rejects invalid JSON", () => { expect(() => parseWorkcell("{ nope")).toThrow(); });
  it("rejects missing limits", () => { expect(() => parseWorkcell(JSON.stringify({ machine: "x" }))).toThrow(); });
  it("accepts a minimal workcell with defaults", () => { const w = parseWorkcell(JSON.stringify({ limits: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } })); expect(w.rapidFeed).toBe(5000); expect(w.fixtures).toEqual([]); });
});
'@

Write-File "tests/state.test.ts" @'
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGCode } from "../lib/parse";
import { analyze } from "../lib/analyze";
import { parseWorkcell } from "../lib/workcell";
import { parseState } from "../lib/state";
function load(id: string) { return { gcode: readFileSync("public/examples/" + id + ".nc", "utf8"), workcell: parseWorkcell(readFileSync("public/examples/" + id + ".workcell.json", "utf8")), state: parseState(readFileSync("public/examples/" + id + ".state.json", "utf8")) }; }
describe("pre-flight state checks", () => {
  it("blocks a program whose offset and tool are not in the state", () => { const { gcode, workcell, state } = load("mismatch"); const r = analyze(parseGCode(gcode), workcell, state); expect(r.verdict).toBe("block"); expect(r.diagnostics.some((d) => d.code === "NF201")).toBe(true); expect(r.diagnostics.some((d) => d.code === "NF202")).toBe(true); });
  it("passes examples against their own state", () => { for (const id of ["bracket", "clean", "overtravel", "messy"]) { const { gcode, workcell, state } = load(id); const withState = analyze(parseGCode(gcode), workcell, state); const without = analyze(parseGCode(gcode), workcell); expect(withState.verdict).toBe(without.verdict); } });
  it("flags a translated envelope that exceeds travel (NF203)", () => { const { gcode, workcell } = load("clean"); const shifted = parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 200, y: 0, z: 0 } }, tools: {} })); const r = analyze(parseGCode(gcode), workcell, shifted); expect(r.diagnostics.some((d) => d.code === "NF203")).toBe(true); });
  it("translates geometry checks by the active offset", () => { const { gcode, workcell } = load("clean"); const ok = parseState(JSON.stringify({ control: "sim", offsets: { G54: { x: 10, y: 10, z: 0 } }, tools: {} })); const r = analyze(parseGCode(gcode), workcell, ok); expect(r.diagnostics.filter((d) => d.code === "NF002")).toHaveLength(0); });
  it("rejects invalid state files hard", () => { expect(() => parseState("{ nope")).toThrow(); expect(() => parseState(JSON.stringify({ offsets: { G50: { x: 0, y: 0, z: 0 } } }))).toThrow(); });
});
'@

# 7. Examples
Write-File "public/examples/bracket.nc" @'
G21 G90
G0 Z5
G0 X0 Y0
G1 Z-2 F1200
G1 X100 Y0
G1 X100 Y40
G1 X0 Y40
G1 X0 Y0
G0 Z10
M2
'@

Write-File "public/examples/bracket.workcell.json" @'
{
  "machine": "Desktop CNC Mill",
  "limits": { "min": { "x": -250, "y": -200, "z": -100 }, "max": { "x": 250, "y": 200, "z": 100 } },
  "rapidFeed": 5000,
  "feedLimit": 1000,
  "fixtures": [ { "name": "clamp", "min": { "x": 80, "y": -10, "z": -5 }, "max": { "x": 120, "y": 10, "z": 20 } } ]
}
'@

Write-File "public/examples/clean.nc" @'
G21 G90
G0 Z5
G0 X10 Y10
G1 Z-1 F600
G1 X60 Y10
G1 X60 Y30
G1 X10 Y30
G1 X10 Y10
G0 Z10
M2
'@

Write-File "public/examples/clean.workcell.json" @'
{
  "machine": "Desktop CNC Mill",
  "limits": { "min": { "x": -250, "y": -200, "z": -100 }, "max": { "x": 250, "y": 200, "z": 100 } },
  "rapidFeed": 5000,
  "feedLimit": 1000,
  "fixtures": [ { "name": "clamp", "min": { "x": 180, "y": 140, "z": -5 }, "max": { "x": 220, "y": 160, "z": 20 } } ]
}
'@

Write-File "public/examples/overtravel.nc" @'
G21 G90
G0 Z5
G0 X0 Y0
G1 Z-2 F800
G1 X300 Y0
G1 X300 Y50
G0 Z10
M2
'@

Write-File "public/examples/overtravel.workcell.json" @'
{
  "machine": "Desktop CNC Mill",
  "limits": { "min": { "x": -250, "y": -200, "z": -100 }, "max": { "x": 250, "y": 200, "z": 100 } },
  "rapidFeed": 5000,
  "feedLimit": 1000,
  "fixtures": []
}
'@

Write-File "public/examples/messy.nc" @'
g21 g90
; rough pass
G0 Z5
G0 X5 Y5
g1 z-1.5 f900
G1 X80 Y5
G1 X80 Y60 ; side wall
g1 x5 y60
G1 X5 Y5
G0 Z12
M2
'@

Write-File "public/examples/messy.workcell.json" @'
{
  "machine": "CNC Router",
  "limits": { "min": { "x": -600, "y": -600, "z": -150 }, "max": { "x": 600, "y": 600, "z": 150 } },
  "rapidFeed": 8000,
  "feedLimit": 1500,
  "fixtures": [ { "name": "clamp", "min": { "x": -120, "y": -110, "z": -5 }, "max": { "x": -80, "y": -90, "z": 20 } } ]
}
'@

Write-File "public/examples/mismatch.nc" @'
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

Write-File "public/examples/mismatch.workcell.json" @'
{
  "machine": "Desktop CNC Mill",
  "limits": { "min": { "x": -250, "y": -200, "z": -100 }, "max": { "x": 250, "y": 200, "z": 100 } },
  "rapidFeed": 5000,
  "feedLimit": 1000,
  "fixtures": []
}
'@

$stdState = @'
{
  "control": "sim",
  "offsets": { "G54": { "x": 0, "y": 0, "z": 0 } },
  "tools": { "T01": { "diameter": 6, "length": 50 } }
}
'@
foreach ($id in @("bracket", "clean", "overtravel", "messy", "mismatch")) {
  Write-File ("public/examples/" + $id + ".state.json") $stdState
}

Write-Host ""
Write-Host "v0.3 Factory Reset complete."
Write-Host "Run: npm install"
Write-Host "Then: npm test"