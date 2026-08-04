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

# Targeted doc/README/changelog updates (single-quoted here-strings)
Patch-File "docs/SCOPE.md" '- NF102: words and G-codes outside the modeled set.' @'
- NF102: words and G-codes outside the modeled set.
- NF201: work offset referenced by the program but absent from the state.
- NF202: tool referenced by the program but absent from the tool table.
- NF203: work envelope under a work offset exceeds machine travel.
- NF204: multiple work offsets referenced (partial modeling, disclosed).

When a machine state snapshot is provided (docs/STATE.md), program
coordinates are interpreted in work coordinates and translated by the
active offset. Without a state, coordinates are assumed to be machine
coordinates (identity offset).
'@

Patch-File "docs/WORKCELL.md" '- Invalid structure is a hard error, never a silent default.' @'
- Invalid structure is a hard error, never a silent default.

## Machine state

The workcell is static; the setup is dynamic. Keep the machine state
snapshot (offsets, tool table) in a separate file next to the workcell;
see docs/STATE.md. Verify programs against (workcell, state) pairs and
version both with the program.
'@

Patch-File "README.md" 'It is a lint step. It never replaces CAM verification or a prove-out.' @'
It is a pre-flight step: it verifies that a program's assumptions - units,
work offsets, tools, envelope - match the workcell and the machine state it
is about to run in. It never replaces CAM verification or a prove-out.
'@

Patch-File "README.md" '  - NF100/NF101/NF102 features that are present but not modeled (info/warning)' @'
  - NF100/NF101/NF102 features that are present but not modeled (info/warning)
  - NF201-NF204 pre-flight mismatches between program assumptions and the
    machine state snapshot (docs/STATE.md)
'@

Patch-File "CHANGELOG.md" '# Changelog' @'
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
  model-proof capability.
'@

Patch-File "package.json" '"version": "0.2.0",' '"version": "0.3.0",'

Write-Host ""
Write-Host "0.3.0 doc/version tail complete."