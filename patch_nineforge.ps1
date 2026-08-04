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
    Write-Host "Patched $RelativePath"
}

# 1) package.json: persist the dev command that works on your machine
$p = Join-Path $root "package.json"
$c = [System.IO.File]::ReadAllText($p)
$c = $c.Replace('"dev": "next dev",', '"dev": "next dev --hostname 127.0.0.1 --port 5173",')
$c = $c.Replace('"dev": "next dev -p 3001",', '"dev": "next dev --hostname 127.0.0.1 --port 5173",')
$c = $c.Replace('"dev": "next dev -p 4000",', '"dev": "next dev --hostname 127.0.0.1 --port 5173",')
[System.IO.File]::WriteAllText($p, $c, $utf8NoBom)
Write-Host "Patched package.json"

# 2) app/page.tsx: replace the corrupted em-dash with a plain hyphen
$p = Join-Path $root "app\page.tsx"
$c = [System.IO.File]::ReadAllText($p)
$bad = "$([char]0x00E2)$([char]0x20AC)$([char]0x201D)"
$c = $c.Replace($bad, "-")
[System.IO.File]::WriteAllText($p, $c, $utf8NoBom)
Write-Host "Patched app/page.tsx (encoding fix)"

# 3) lib/types.ts: add feedSet flag
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

export type FixtureBox = {
  name: string;
  min: Vec3;
  max: Vec3;
};

export type MachineProfile = {
  name: string;
  rapidFeed: number;
  limits: {
    min: Vec3;
    max: Vec3;
  };
  fixtures: FixtureBox[];
};

export type Issue = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  line?: number;
};

export type Scores = {
  safety: number;
  reliability: number;
  efficiency: number;
  launchReadiness: string;
};

export type SimulationResult = {
  segments: Segment[];
  distanceMm: number;
  rapidDistanceMm: number;
  cutDistanceMm: number;
  durationSec: number;
  issues: Issue[];
  scores: Scores;
};

export type CriticResult = {
  summary: string;
  avoidedImpact?: string | null;
  recommendations: string[];
};
'@
Write-File "lib/types.ts" $c

# 4) lib/gcode.ts: track which line actually sets the feed rate
$c = @'
import { Segment, Vec3 } from "./types";

export function parseGCode(code: string): Segment[] {
  const segments: Segment[] = [];

  let pos: Vec3 = { x: 0, y: 0, z: 0 };
  let feed = 500;
  let motion: "rapid" | "linear" = "rapid";

  const lines = code.split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = raw.split(";")[0].trim();
    if (!line) return;

    const words = line.split(/\s+/);
    const next = { ...pos };
    let localMotion = motion;
    let localFeed = feed;
    let localFeedSet = false;

    for (const w of words) {
      const cmd = w.toUpperCase();

      if (cmd.startsWith("G")) {
        const g = Number(cmd.slice(1));

        if (g === 0) {
          localMotion = "rapid";
        }

        if (g === 1) {
          localMotion = "linear";
        }
      } else if (cmd.startsWith("X")) {
        next.x = Number(cmd.slice(1));
      } else if (cmd.startsWith("Y")) {
        next.y = Number(cmd.slice(1));
      } else if (cmd.startsWith("Z")) {
        next.z = Number(cmd.slice(1));
      } else if (cmd.startsWith("F")) {
        localFeed = Number(cmd.slice(1));
        localFeedSet = true;
      }
    }

    const hasMotion =
      next.x !== pos.x || next.y !== pos.y || next.z !== pos.z;

    if (hasMotion) {
      segments.push({
        from: pos,
        to: next,
        motion: localMotion,
        feed: localMotion === "rapid" ? 5000 : localFeed,
        feedSet: localFeedSet,
        line: idx + 1,
      });

      pos = next;
      motion = localMotion;
      feed = localFeed;
    } else {
      motion = localMotion;
      feed = localFeed;
    }
  });

  return segments;
}
'@
Write-File "lib/gcode.ts" $c

# 5) lib/simulate.ts: smarter rules (no false positives, no repeated warnings)
$c = @'
import {
  FixtureBox,
  Issue,
  MachineProfile,
  Segment,
  SimulationResult,
  Vec3,
} from "./types";

function pointInBox(p: Vec3, box: FixtureBox): boolean {
  return (
    p.x >= box.min.x &&
    p.x <= box.max.x &&
    p.y >= box.min.y &&
    p.y <= box.max.y &&
    p.z >= box.min.z &&
    p.z <= box.max.z
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

    if (pointInBox(p, box)) {
      return true;
    }
  }

  return false;
}

function outOfLimits(p: Vec3, machine: MachineProfile): boolean {
  return (
    p.x < machine.limits.min.x ||
    p.x > machine.limits.max.x ||
    p.y < machine.limits.min.y ||
    p.y > machine.limits.max.y ||
    p.z < machine.limits.min.z ||
    p.z > machine.limits.max.z
  );
}

function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(
    (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2
  );
}

export function analyze(
  segments: Segment[],
  machine: MachineProfile
): SimulationResult {
  const issues: Issue[] = [];
  const issueSet = new Set<string>();

  const addIssue = (issue: Issue) => {
    const key = `${issue.title}|${issue.line ?? "global"}`;
    if (!issueSet.has(key)) {
      issueSet.add(key);
      issues.push(issue);
    }
  };

  let distanceMm = 0;
  let rapidDistanceMm = 0;
  let cutDistanceMm = 0;
  let durationSec = 0;

  for (const seg of segments) {
    const d = distance(seg.from, seg.to);
    distanceMm += d;

    if (seg.motion === "rapid") {
      rapidDistanceMm += d;
      durationSec += (d / Math.max(1, machine.rapidFeed)) * 60;
    } else {
      cutDistanceMm += d;
      durationSec += (d / Math.max(1, seg.feed)) * 60;
    }

    if (outOfLimits(seg.from, machine) || outOfLimits(seg.to, machine)) {
      addIssue({
        severity: "critical",
        title: "Machine limit violation",
        detail: `Motion exceeds machine limits near line ${seg.line}.`,
        line: seg.line,
      });
    }

    for (const fixture of machine.fixtures) {
      if (segmentIntersectsBox(seg.from, seg.to, fixture)) {
        addIssue({
          severity: "critical",
          title: `Collision with ${fixture.name}`,
          detail: `Toolpath intersects ${fixture.name} near line ${seg.line}.`,
          line: seg.line,
        });
      }
    }

    if (seg.motion === "linear" && seg.feedSet && seg.feed > 1000) {
      addIssue({
        severity: "warning",
        title: "Feed rate too aggressive",
        detail: `Feed ${seg.feed} mm/min may cause tool wear or poor surface finish near line ${seg.line}.`,
        line: seg.line,
      });
    }

    const horizontal =
      Math.abs(seg.from.x - seg.to.x) > 0.1 ||
      Math.abs(seg.from.y - seg.to.y) > 0.1;

    if (
      seg.motion === "rapid" &&
      horizontal &&
      Math.min(seg.from.z, seg.to.z) < 2 &&
      d > 0.1
    ) {
      addIssue({
        severity: "warning",
        title: "Rapid move too close to workpiece",
        detail: `Rapid move near Z=${Math.min(seg.from.z, seg.to.z).toFixed(
          2
        )} is dangerously low near line ${seg.line}.`,
        line: seg.line,
      });
    }
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  const warning = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;

  const safety = Math.max(
    0,
    Math.min(100, 100 - critical * 45 - warning * 12 - info * 3)
  );

  const reliability = Math.max(0, Math.min(100, safety - 8));

  const efficiency = Math.max(
    25,
    Math.round(100 - (rapidDistanceMm / Math.max(1, distanceMm)) * 80)
  );

  const launchReadiness =
    safety >= 90
      ? "Production-ready evidence"
      : safety >= 75
      ? "Supervised deployment"
      : safety >= 50
      ? "Engineering prototype"
      : "Do not deploy";

  return {
    segments,
    distanceMm: Math.round(distanceMm),
    rapidDistanceMm: Math.round(rapidDistanceMm),
    cutDistanceMm: Math.round(cutDistanceMm),
    durationSec: Math.round(durationSec),
    issues,
    scores: {
      safety,
      reliability,
      efficiency,
      launchReadiness,
    },
  };
}
'@
Write-File "lib/simulate.ts" $c

Write-Host ""
Write-Host "Patch complete. Refresh your browser (or restart npm run dev)."