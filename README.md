# NineForge

**Unit testing for the physical world.**

NineForge is an open-source, deterministic validation layer for AI-generated machine
programs. It sits between the agent that writes motion code and the hardware that would
execute it: simulating, scoring, and stress-testing every program before anything moves.

The current wedge is **CNC validation**. The engine is designed to be machine-class
agnostic (see roadmap).

> **Scope honesty:** NineForge models deterministic geometry, process rules, and state
> cross-checks, and it reports what it does *not* model. It complements - never
> replaces - CAM verification and a physical prove-out.

## The problem

AI agents now author machine programs (G-code, motion plans) at a scale no human review
process can absorb. In software, a hallucination is a bad string. On hardware, a
hallucinated work offset or a toolpath through a clamp is a broken fixture, a scrapped
part, or an injured operator.

Existing safety nets don't fit the agent era:

- **CAM verification** is human-paced and GUI-bound - it wasn't built to be called in an
  agent loop.
- **Physical prove-outs** are slow, expensive, and don't scale with token throughput.
- **Nothing produces machine-checkable evidence** that a program was validated against
  the *actual* workcell state before deployment.

NineForge's answer: fast, deterministic, CI-friendly checks that turn "the agent says
it's safe" into a reviewable evidence trail - and that **block** by default when
evidence is missing.

## The validation state machine

Every run moves through a deterministic pipeline. Any `error`-severity diagnostic at any
stage forces the verdict to `block`; warnings downgrade to `caution`; `pass` requires a
clean trace end to end. Missing evidence is never guessed silently - it is disclosed
(NF005, NF100, NF204, NF206) or blocked (NF105, NF106, NF107, NF207).

```
  program.nc + workcell.json + state.json
                   |
                   v
           +----------------+  segments, units, assumptions
           | 1. PARSE       |  (offsetsUsed, toolsUsed, envelope,
           +----------------+   toolComp, arc tessellation <= 0.05 mm)
                   |
                   v
           +----------------+  assumptions vs machine state vs workcell;
           | 2. PREFLIGHT   |  program calls G55/T07, state defines
           +----------------+  neither -> hard BLOCK before motion
                   |
                   v
           +----------------+  toolpath vs fixtures/stock/limits,
           | 3. ANALYZE     |  tool radius + length, feed limits
           +----------------+
                   |
                   v
           +----------------+
           | 4. VERDICT     |  block | caution | pass
           +----------------+
                   |
                   v
           +----------------+  diagnostics + stats -> versioned report
           | 5. REPORT      |  (reportVersion: 1) for CLI, UI, MCP, SARIF
           +----------------+
                   |
                   v
   +---------------+---------------+
   |                               |
   v                               v
+----------------+          +----------------+
| 6. FIX         |          | 7. STRESS      |
| typed actions: |          | perturb setup, |
| gcode-edit vs  |          | survives k/N   |
| physical-action|          +----------------+
+----------------+
```

Stress never *upgrades* a verdict; it only adds evidence. `survives 0/10` means the
baseline and every tested perturbation (fixture shifts, zero offsets, feed overrides)
still fail.

## UI tour

### 01 - Block: toolpath vs fixture
![Block: toolpath vs fixture](docs/screenshots/01-block-collision.png)
The bracket program drives the tool through the clamp volume. NineForge blocks the run
and points at the offending lines.

### 02 - Pre-flight: setup mismatch
![Pre-flight: setup mismatch](docs/screenshots/02-preflight-mismatch.png)
The program calls for `G55` and `T07`; the loaded machine state defines neither.
**BLOCK** before anything moves.

### 03 - Pass: clean pocket job
![Pass: clean pocket job](docs/screenshots/03-pass-clean.png)
A program whose assumptions match the workcell passes every modeled check.

### 04 - Stress screen
![Stress screen](docs/screenshots/04-stress-screen.png)
The stress screen perturbs the setup (fixture shifts, zero offsets, feed overrides) and
re-runs the checks.

### 05 - Suggested fixes
![Suggested fixes](docs/screenshots/05-suggested-fixes.png)
Typed suggestions: `gcode-edit` actions an agent may auto-apply (cap feeds at the
workcell limit), and `physical-action` actions a human must perform (move the clamp -
editing the file does not move the clamp).

### 06 - CLI
![CLI mismatch run](docs/screenshots/06-cli-mismatch.png)
Same engine, no browser.

## Quickstart

```bash
npm install
npm run dev
```

Open the URL Next.js prints (default http://localhost:3000).

Headless (CI / agent integration):

```bash
npx tsx cli/main.ts check public/examples/mismatch.nc \
  --workcell public/examples/mismatch.workcell.json \
  --state public/examples/mismatch.state.json
```

SARIF output for inline PR annotations (exit code 1 on `block`):

```bash
npx tsx cli/sarif.ts program.nc workcell.json [state.json] [out.sarif]
```

`.github/workflows/validate-nc.yml` runs this on every PR and uploads the report, so
findings annotate `.nc` files in the "Files changed" tab.

Agent-loop demo (Gate 1 exit criterion):

```bash
npm run demo:agent-loop
```

More examples live in `public/examples/` (`bracket`, `mismatch`, `clean`, `messy`,
`overtravel`), each as a `program / workcell / state` triple.

## What we model - and what we don't

*(updated 2026-08-08; supersedes all earlier scope lists in this document)*

**Modeled exactly** (locked by the differential corpus and property tests):

- Linear/rapid motion (G0/G1), modal state, and space-less words (`G1X10Y10`)
- Arcs G2/G3 in the XY plane (G17): I/J and R forms, helical Z, full circles,
  tessellated to <= 0.05 mm chord tolerance (NF100 discloses this)
- G90/G91 absolute/incremental; G20/G21 units with mid-program switch integrity
- Work offsets G54-G59 applied to geometry checks (NF204 discloses the multi-offset
  simplification)
- Exact slab-method segment/fixture intersection (no tunneling through thin fixtures)
- Tool-radius sweep (NF205); tool-length compensation semantics: with G43/G44 the tip
  follows programmed Z; without it the tip is assumed `length` mm below programmed Z
  (NF206); unresolvable H references block (NF207)
- Stock volume checks: rapid-in-stock (NF006), air-cut (NF007), table crash (NF008)

**Fail closed (block, never guessed):**

- Unparseable words and non-finite geometry (NF105)
- Canned cycles/homing (G28/G30/G33, G73-G89), cutter comp (G41/G42), machine
  coordinates (G53), rotation (G68), offset shift (G92) - NF106
- Arcs with inconsistent or missing center data (NF103)
- Invalid workcell/state JSON via the SDK (NF107)

**Not modeled (reported or disclosed, never silently trusted):**

- Other planes (G18/G19), K word, spindle/program-flow M and S words (except the NF104
  cutting-without-feed warning)
- G95 feed-per-revolution: feeds are interpreted as mm/min (roadmap item)
- Cutting forces, tool deflection, machine dynamics, controller lookahead, material
  behavior

Note: **NF101 is retired** - G91 incremental is now fully modeled.

### Diagnostic codes

| Code | Severity | Meaning |
|------|----------|---------|
| NF001 | error | Toolpath intersects a fixture |
| NF002 | error | Motion exceeds machine travel limits |
| NF003 | warning | Feed exceeds the workcell `feedLimit` |
| NF004 | warning | Rapid traverse at low Z |
| NF005 | info | No `feedLimit` declared; assuming 1000 mm/min |
| NF006 | error | Rapid (G0) intersects the declared stock volume |
| NF007 | warning | Air cut: cutting moves never intersect the stock |
| NF008 | error | Cutting below the stock bottom (table/vise risk) |
| NF100 | info | Arcs modeled as chords within 0.05 mm tolerance |
| NF102 | info | Unmodeled word ignored (reported) |
| NF103 | error | Arc center data missing or inconsistent |
| NF104 | warning | Cutting move before any F word |
| NF105 | error | Unparseable word / non-finite geometry |
| NF106 | error | Unmodeled motion command (canned cycle, homing, comp, G53/G68/G92) |
| NF107 | error | Invalid workcell/state JSON (SDK fail-closed) |
| NF201 | error | Work offset referenced but not in machine state |
| NF202 | error | Tool referenced but not in tool table |
| NF203 | error | Work envelope exceeds machine travel |
| NF204 | info | Multiple offsets referenced; first defined offset used |
| NF205 | error | Tool radius sweeps a fixture |
| NF206 | warning | No G43 active; tip assumed `length` mm below programmed Z |
| NF207 | error | G43/G44 H reference not resolvable in tool table |

## Evidence, not vibes

- **56 tests**: unit, regression, property-based invariants (chain continuity, mm/inch
  round-trip stability, monotonic fixture growth, finite stats), and differential.
- **Differential corpus:** `tests/corpus/*.nc` with golden segment dumps. Regenerate
  consciously with `npx tsx scripts/dump-corpus.ts`; the `.expected.json` diff is a
  review surface, never a silent change.
- **CI:** `validate-nc` uploads SARIF on every PR; Code Scanning ingests it.

## Gated roadmap

We ship by evidence gates, not vibes. A gate closes only when its evidence (tests,
examples, screenshots, docs) is in the repo.

| Gate | Status | Goal | Exit criteria |
|------|--------|------|---------------|
| **0** | shipped (v0.3) | Deterministic 3-axis validation: parse -> preflight -> analyze -> verdict -> report, fixes, stress, CLI. | This repo: examples, tests, screenshots. |
| **1** | shipped | Agent-native: versioned report SDK (`check()`, `reportVersion: 1`), MCP server (`nineforge_check` / `nineforge_fix`), SARIF + CI annotations, agent-loop demo. | `npm run demo:agent-loop` closes block -> self-correct -> pass with no human in the loop. |
| **2** | in progress | Deeper physics. Shipped: tool diameter (NF205) and length/comp semantics (NF206/NF207). Remaining: 4/5-axis kinematics and rotary envelopes. | 5-axis example suite with evidence parity to Gate 0, plus an updated "not modeled" list. |
| **3** | open | Second machine class (e.g. FDM motion plans) with the same pipeline and a new workcell schema. | New example suite + screenshots; engine core untouched by machine-specific code. |
| **4** | in progress | Evidence over time. Shipped: regression + differential suites in-repo. Remaining: run history, per-workcell suites, signed reports. | A regression suite that catches a deliberately broken program change on a real workcell. |

## Contributing

Start with `docs/SCREENSHOTS.md` for the capture guide, and keep the honesty policy:
every new capability must document what it does **not** model.

PRs must keep `npm run test` and `npx tsc --noEmit` green. Corpus goldens are reviewed,
never silently regenerated. Fail closed by default; disclose every assumption.

## License

MIT - see [LICENSE](LICENSE).

## MCP server (AI agent integration)

NineForge ships an MCP server so coding agents can validate G-code while writing it.

Run it from the repo root:

```bash
npx tsx ./mcp/server.ts
```

Example client config (Claude Code / Cursor / any MCP client):

```json
{
  "mcpServers": {
    "nineforge": {
      "command": "npx",
      "args": ["tsx", "./mcp/server.ts"],
      "cwd": "/path/to/nineforge"
    }
  }
}
```

Tools: `nineforge_check` (versioned report) and `nineforge_fix` (typed actions;
`gcode-edit` actions are auto-applicable, `physical-action` never are).

Demo transcript (Gate 1 exit criterion):

```bash
npm run demo:agent-loop
```
## Python bindings (wedge)

`python/nineforge.py` exposes `check(gcode, workcell, state=None)` for Python-side
agent stacks (ROS 2 / LeRobot prototyping). It shells out to the CLI and returns the
versioned report. A compiled PyPI/WASM distribution is roadmap work (PAI-301); set
`NINEFORGE_REPO` to your checkout path if the module lives outside the repo.

## Docker

`docker build -t nineforge . && docker run -p 3000:3000 nineforge` serves the web UI
(non-root user, healthcheck included).


## Custom Rule Engine (PAI-503)

NineForge supports custom validation rules via YAML or JSON files. Rules are evaluated deterministically against the parsed G-code and machine state, adhering to the "fail closed" philosophy.

### Supported Rule Types (v1.0)

| Type | Description | Parameters |
|------|-------------|------------|
| `max_feed` | Ensures cutting feedrates do not exceed a limit. | `max` (number) |
| `min_z` | Ensures Z coordinates do not go below a limit. | `min` (number) |
| `max_tool_length` | Ensures tool lengths do not exceed a limit. | `max` (number) |

### Example `rules.yaml`


## Python Bindings (PAI-301)

NineForge provides a compiled JavaScript bridge for Python users, replacing the legacy subprocess wedge. It pipes JSON directly to the Node.js runtime via `stdin`, eliminating temporary files and the `tsx` dependency.

### Setup

1. Ensure Node.js (>= 18) is installed and available in your PATH.
2. Build the compiled bridge:
   ```bash
   npm install
   npm run build:python

   
## REST API (PAI-302/303)

NineForge exposes a stateless REST API for programmatic validation. Because `check()` is designed as a fail-closed package boundary, the API never throws 500 errors on bad inputs—invalid payloads result in HTTP 200 responses with a `block` verdict and `NF107` diagnostics.

### Endpoints

#### `POST /api/analyze`
Analyze a single G-code program.
**Request Body:**
```json
{
  "gcode": "G21\nG90\n...",
  "workcell": "{ ... } or { ... object ... }",
  "state": "{ ... } (optional)",
  "rules": { "version": "1.0", "rules": [...] }
}

