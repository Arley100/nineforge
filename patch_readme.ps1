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

New-Item -ItemType Directory -Path (Join-Path $root "docs\screenshots") -Force | Out-Null
Write-Host "created docs/screenshots (drop your PNGs here)"

Write-File "README.md" @'
# NineForge

Catch the crash before the crash.

NineForge is a deterministic pre-flight checker for CNC G-code. It reads a
program and checks it against the world it is about to run in: machine
travel limits, fixtures, the tool table, and the work offsets that are
actually set. If the program assumes something that is not true on the
machine, NineForge says BLOCK and points at the line.

It runs in milliseconds, has no learned components, and reports what it
does not model instead of silently ignoring it.

## UI tour

### 1. Blocking a colliding toolpath
![BLOCK: toolpath intersects the clamp](docs/screenshots/01-block-collision.png)

The amber toolpath passes through the red clamp box. Diagnostics list NF001
(collision, lines 5-6) and NF003 (feed above the declared limit).
Verdict: BLOCK.

### 2. Pre-flight: setup mismatch
![NF201 and NF202: offset and tool missing from state](docs/screenshots/02-preflight-mismatch.png)

The program calls G55 and T07. The loaded machine state defines G54 and
T01. NineForge blocks before the machine gets the chance to prove it.

### 3. A clean pass
![PASS on a clean job](docs/screenshots/03-pass-clean.png)

No modeled rule violated. PASS means "nothing we check is wrong", never
"safe to run". CAM verification and prove-out remain yours.

### 4. Stress screen
![Stress matrix over perturbed workcells](docs/screenshots/04-stress-screen.png)

The same plan re-checked across ten perturbed workcells: fixture shifts,
zero shifts, tool margin, feed overrides. "Survives 4/10" tells you how
fragile the plan is to setup error.

### 5. Suggested fixes
![Suggested fixes re-analyzed](docs/screenshots/05-suggested-fixes.png)

Concrete suggestions (cap feeds, move a fixture clear of the toolpath),
applied to a copy of your inputs and re-analyzed. Suggestions are always
labeled as suggestions.

### 6. The CLI as a CI gate
![CLI blocking a mismatched setup](docs/screenshots/06-cli-mismatch.png)

npx tsx cli/main.ts check job.nc --workcell cell.json --state state.json
exits 1 on BLOCK, 0 otherwise. --json for automation, --stress for the
perturbation screen, --strict to fail on warnings.

## Motivation and the problem this solves

Most first-article crashes are not bad toolpath math. They are context
mismatch:

- the program assumes G55, the machine is on G54;
- T07 is not in the carousel;
- the vise sits 20 mm from where the program thinks it is;
- with the offset where it is, the part hangs off the table.

CAM software verifies the toolpath at generation time. A prove-out
verifies at execution time. In between, there is no cheap, deterministic
check that the program's assumptions match the machine's actual setup.
Operators perform that check by eye, per shift, per machine, from memory.

NineForge makes that check explicit, repeatable, and versionable:

- for a machinist: a second pair of eyes before cycle start;
- for a shop: the same check on every machine, every shift;
- for developers of CAM or agent pipelines: a CI gate for machine code.

A note on the future: even if frontier models one day generate perfect
G-code, a perfect program still crashes on a machine whose offsets, tools,
or fixtures do not match its assumptions. Verifying context is independent
of verifying generation. That is the niche NineForge owns.

## What it catches

| Code  | Check                                   | The moment it saves you                              |
|-------|-----------------------------------------|------------------------------------------------------|
| NF001 | Toolpath vs fixtures                    | "The toolpath goes through the vise."                |
| NF002 | Motion vs travel limits                 | "The program runs past the edge of the table."       |
| NF201 | Offset referenced but not in state      | "The program assumes G55; the machine is on G54."    |
| NF202 | Tool referenced but not in tool table   | "T07 is not in the carousel."                        |
| NF203 | Work envelope under offset vs travel    | "With G54 where it is, this part hangs off the table." |
| NF003 | Feed above declared limit (warning)     | "1200 mm/min on a setup rated for 1000."             |
| NF004 | Rapid traverse too low (warning)        | "Rapid at Z2 over the part."                         |
| NF1xx | Present but not modeled (info/warning)  | Honesty: arcs, G91, unknown words are reported, never ignored. |

## How it works

Three inputs, one deterministic pipeline, one verdict.

### The three files

1. The program: your G-code (.nc, .gcode, .tap).
2. The workcell (static; written once per machine and fixture kit):
   travel limits, rapid feed, feed limit, fixtures as boxes.
3. The state (dynamic; written per setup): which work offsets are set and
   which tools are in the table right now.

The verified unit of reproducibility is the triple
(program, workcell, state). Version all three with the job.

### Engine state machine

program.nc  workcell.json  [state.json]
     \         |          /
      v        v         v
  +---------------------------+
  |          parse            |-- invalid structure --> HARD ERROR
  +---------------------------+   (no verdict; fix the file)
               |
               | segments, assumptions, NF1xx notes
               v
  +---------------------------+
  |          analyze          |  geometry + limits + state cross-checks
  +---------------------------+
               |
               v
      BLOCK / CAUTION / PASS

Verdict semantics (enforced by tests):

- BLOCK: at least one error (NF001, NF002, NF201, NF202, NF203). Do not run.
- CAUTION: warnings only (NF003, NF004, NF101). Review before running.
- PASS: no errors and no warnings. Info notes may be present.

### Session state machine (UI and CLI)

| From            | Event                 | Guard            | To                              |
|-----------------|-----------------------|------------------|---------------------------------|
| empty           | load inputs           | all inputs parse | analyzed                        |
| any             | load inputs           | any input invalid| invalid-input (hard error)      |
| invalid-input   | reload                | all parse        | analyzed                        |
| analyzed        | edit + analyze        | all parse        | analyzed                        |
| analyzed        | stress screen         | verdict exists   | screened                        |
| analyzed        | suggest fixes         | workcell loaded  | analyzed (suggestions applied)  |
| analyzed/screened | export report       | verdict exists   | reported                        |

Invariants the UI and CLI obey:

- no verdict is ever shown without a successful parse;
- invalid input is a hard error, never a silent default;
- suggestions never mutate your files; they produce new text you accept or reject;
- export is always available once a verdict exists.

## UX: how a session is meant to flow

1. Load or paste the program. Load the workcell (once per machine) and the
   state (per setup).
2. Analyze. Read the verdict first, then the diagnostics; every line carries
   a code and a line number.
3. On BLOCK: fix the program or the setup and re-analyze. Optionally ask for
   suggestions.
4. On CAUTION or PASS for a critical job: run the stress screen to see how
   sensitive the plan is to setup error.
5. Export the report and keep it with the job.

Layout: left column holds the three inputs and the diagnostics list; right
column holds the 3D viewer (blue rapids, amber cuts, translucent red
fixtures) and the stats. The toolbar holds Analyze, Suggest fixes, Stress
screen, Export report, the file loaders, and the example picker.

## What NineForge is not

- not CAM verification or a backplotter;
- not a cutter-engagement physics simulator;
- not a certification or a safety sign-off;
- not a model of arcs (G2/G3), incremental mode (G91), or cutter
  compensation. It reports them (NF1xx) instead of ignoring them.

## Roadmap: what we want to achieve, gradually

Every phase has an evidence gate. If the evidence does not appear, we stay
narrow: a narrow useful tool beats a broad mediocre one.

- v0.3 (current): deterministic pre-flight core, CLI, test suite, examples,
  honest scope documentation.
- v0.4: state ingestion adapters (LinuxCNC INI, tool-table CSV) and the
  first real-world corpus from false-positive reports.
  Gate: at least 10 real programs with user-reported outcomes.
- v0.5: verified-triple registry (hashes plus outcomes) and semantic diff
  between program revisions, so re-verification is scoped to what changed.
  Gate: the corpus shows repeated re-verification pain.
- v0.6: arc support behind an explicit flag (chord linearization with
  disclosed tolerance) and control-dialect notes.
  Gate: arcs are the top false-negative source in the corpus.
- v1.0: STL fixtures, or a robot-trajectory sibling package. Only if the
  evidence demands it; otherwise we remain a CNC pre-flight tool.

## Origins

NineForge began in August 2026 as a hackathon experiment: its author watched
six founder talks from YC Startup School 2026 and asked whether one small
project could embody their engineering lessons at once - build the eval
before the product, count your nines, make hardware iterate like software,
keep agents controllable, ground everything in a concrete user problem.
The talks are inspiration, not endorsement; none of the speakers or
organizations are affiliated with this project.

## Contributing

False positives are the most valuable reports: open an issue with minimal
G-code plus workcell/state and the verdict you expected. Every behavior
change ships with a test (see tests/). To refresh the screenshots in this
README, follow docs/SCREENSHOTS.md.

## License

MIT.
'@

Write-File "docs/SCREENSHOTS.md" @'
# Screenshot guide

How to reproduce every image referenced by the README, so the docs never
drift from the product.

## Preparation

- npm run dev and open the local URL.
- Ctrl+Shift+B to hide the bookmarks bar; zoom 100%; maximize the window.
- The dark theme is the default; do not change it.
- Use the example picker so every shot is reproducible from a clean state.
- Save PNGs into docs/screenshots/ with exactly the names below.

## 01-block-collision.png

1. Example: "Bracket with fixture collision".
2. Wait for the automatic analysis (verdict BLOCK).
3. Frame the page so the viewer, the diagnostics list, and the verdict chip
   are visible.
Caption: BLOCK, NF001 on lines 5-6, NF003 on line 4.

## 02-preflight-mismatch.png

1. Example: "Setup mismatch (pre-flight)".
2. Frame so the state textarea (amber) and the diagnostics (NF201, NF202)
   are visible together.
Caption: program assumes G55 and T07; state defines G54 and T01.

## 03-pass-clean.png

1. Example: "Clean pocket job".
2. Frame the diagnostics panel showing "No diagnostics." and the PASS chip.

## 04-stress-screen.png

1. Example: "Bracket with fixture collision".
2. Click "Stress screen".
3. Frame the matrix and the "survives x/10" chip.

## 05-suggested-fixes.png

1. Example: "Bracket with fixture collision".
2. Click "Suggest fixes".
3. Frame the notes list and the new verdict (PASS).

## 06-cli-mismatch.png

Terminal (dark background), run:

npx tsx cli/main.ts check public/examples/mismatch.nc --workcell public/examples/mismatch.workcell.json --state public/examples/mismatch.state.json

Capture the full output including the two ERROR lines and the BLOCK line.

## Rules

- Never hand-edit a screenshot to change a number; if the product changed,
  retake the shot.
- If a shot cannot be reproduced, the README text is wrong too; fix both in
  the same pull request.
'@

Write-Host ""
Write-Host "README and screenshot guide written."
Write-Host "Next: take the six shots per docs/SCREENSHOTS.md into docs\screenshots\"