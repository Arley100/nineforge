# NineForge

NineForge is a hackathon MVP for proving physical AI before it moves.

It simulates, scores, and fixes AI-generated machine actions before they touch real hardware.

The current demo wedge is CNC validation.

Scope: deterministic geometry, process rules, and state cross-checks. Reports what it does not model. Never replaces CAM verification or a physical prove-out.

## Quickstart

    npm install
    npm run dev

Open:

http://127.0.0.1:5173

## Demo story

An AI agent generates G-code.

NineForge simulates the toolpath, detects collisions and unsafe parameters, scores the process, and suggests a fix.

The result is an evidence-style safety report that can be reviewed before deploying to a real machine.

## UI tour

### 01 - Block: toolpath vs fixture

The bracket program drives the tool through the clamp volume. NineForge blocks the run and points at the offending lines.

![Block: toolpath intersects fixture](docs/screenshots/01-block-collision.png)

### 02 - Pre-flight: setup mismatch

The program calls for G55 and T07; the loaded machine state defines neither. BLOCK before anything moves.

![Pre-flight setup mismatch](docs/screenshots/02-preflight-mismatch.png)

### 03 - Pass: clean pocket job

A program whose assumptions match the workcell passes every modeled check.

![Clean pocket job passes](docs/screenshots/03-pass-clean.png)

### 04 - Stress screen

The stress screen perturbs the setup (fixture shifts, zero offsets, feed overrides) and re-runs the checks. "Survives 0/10" means the blocked baseline and every tested
perturbation still fail.

![Stress screen on the blocked bracket job](docs/screenshots/04-stress-screen.png)

### 05 - Suggested fixes

Deterministic, minimal suggestions: move the fixture clear of the toolpath bounding box, and cap programmed feeds at the workcell limit.

![Suggested fixes for the bracket job](docs/screenshots/05-suggested-fixes.png)

## CLI

Same engine, no browser:

    npx tsx cli/main.ts check public/examples/mismatch.nc --workcell public/examples/mismatch.workcell.json --state public/examples/mismatch.state.json

![CLI check on the mismatch example](docs/screenshots/06-cli-mismatch.png)

## One-line pitch

Unit testing for the physical world.