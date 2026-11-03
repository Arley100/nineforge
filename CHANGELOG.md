# Changelog

## 0.10.0

### Fixed
- **Production build and Docker image were broken:** the rule engine imported `node:fs`
  into the browser bundle, so `npm run build` failed. Rules now parse from text everywhere.
- Fail-open parser cases now block (`NF106`): rotary/secondary axes (A B C U V W), G52, G10,
  G16, G51, G65/G66, G38.x, G44, G54.1 P, G90.1, G93, M97/M98. Their axis words no longer
  create bogus geometry.
- A bare letter (`X`) was read as zero; it is now an unparseable word (`NF105`).
- A `;` inside a `(comment)` leaked words such as `T1` into the program.
- G59.1-style offsets were ignored, so geometry was checked against the wrong offset.
- G95 feeds were only converted on the line that set F; modal lines were read as mm/min.
- Cutting after M5 was only flagged after an F word; `S0 M3` was not flagged.
- An over-limit feed set on a G0 line was never reported where the cut used it (`NF003`).
- The fabricated start position (0,0,0) caused false `NF006` blocks when the work zero sat on
  the stock; start positions are now tracked and disclosed (`NF110`).
- Fixtures or stock with swapped min/max corners never collided; boxes are normalized.
  A non-array `fixtures` value is rejected instead of being treated as no fixtures.
- State tool keys `T001` did not match program `T1`.
- Arcs in G18/G19 were silently computed as XY arcs; all three planes are now modeled.
- Suggested feed caps ignored inch units and G95, and mangled `(comments)`; fixes now scale
  the F word in effect and keep comments and line endings.
- Suggested fixture moves relocated any fixture inside the toolpath's bounding box, even when
  it was never hit, and used program coordinates instead of the workcell frame.
- The stress screen rewrote G-code text, which broke space-less words, comments and G91
  programs; perturbations now act on the parsed program and workcell. Rules apply under stress.
- Rule parameters were not validated, so a typo silently disabled a rule.
- SARIF results without a line had no location, which GitHub code scanning rejects.
- `/api/analyze` ignored `rules`; `/api/batch` failed entirely on a `null` job and had no
  size limits; the OpenAPI version was hard-coded and stale.
- The CLI crashed with a stack trace on invalid workcell JSON instead of reporting `NF107`.
- `bin` wrappers spawned `npx` without a shell (fails on Windows) and exited 0 on failure.
- `NINEFORGE_REPO` was documented for the Python binding but never read.
- The 3D view mirrored the Y axis.
- Independent review hardening: switching work offsets now checks the real traverse (and
  incremental moves after a switch); unknown G-codes and M198/M99 block instead of passing
  with an info note; G43 with another tool's H blocks; G50.1 axis words are no longer moves;
  M6 stops the spindle and forgets Z; `/` block-delete paths are checked both ways; arc
  expansion is capped (a 90 KB input used to allocate 5.7 GB); an implicit G54 missing from
  the state blocks; `verify` exits 1 for an authentic BLOCK report; fixture relocation
  accounts for the tool radius; spaced feeds (`F1 500`) are rewritten correctly.

### Added
- Per-move work offsets and tools: multi-fixture, multi-tool programs are checked exactly
  (retires `NF204`).
- Signed attestations (`check --attest --sign`, `verify`, `keygen`; Ed25519 over canonical
  JSON with input hashes), per-workcell regression suites (`suite`), run history (`--history`).
- `check --sarif` replaces the separate SARIF script; colored terminal output.
- `NF111` (cutting from an unknown position, warning). `min_rapid_z` rule type; rules accepted as YAML/JSON text or objects everywhere.
- Work-zero Z (touch-off) stress perturbation; stress rows list the failing codes.
- `nineforge_stress` MCP tool; rules on all MCP tools.
- UI: rules editor, verdict banner, clickable diagnostics that select the line and highlight
  the move, stock and travel limits in 3D, auto-framing camera, JSON export.
- Examples: two-vise/two-tool CAM-style program, custom rules, `suite.json`.
- `nineforge` and `nineforge-mcp` executables built by `npm run build:lib`.
- Python binding tests; CLI and MCP end-to-end tests; a test that keeps the README code
  table in sync with the engine.

### Changed
- Next.js 16, React 19, React Three Fiber 9, MCP SDK 1.32; `npm audit` reports 0
  vulnerabilities. Web-only packages moved to devDependencies so library installs stay small.
- Node.js 20.9+ is required. The Docker image uses Next.js standalone output on Node 22.
- `suggestFixes(gcode, workcell, state?)` and `stress(gcode, workcellJson, stateJson?, rules?)`
  take raw inputs; `activeShift` is replaced by `placeSegments`.
- `npm run build:core` and `build:python` are replaced by `npm run build:lib`.
