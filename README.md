# NineForge

NineForge is a hackathon MVP for proving physical AI before it moves.

It simulates, scores, and fixes AI-generated machine actions before they touch real hardware.

The current demo wedge is CNC validation.

## Quickstart

npm install
npm run dev

Open:

http://localhost:3000

## Demo story

An AI agent generates G-code.

NineForge simulates the toolpath, detects collisions and unsafe parameters, scores the process, and suggests a fix.

The result is an evidence-style safety report that can be reviewed before deploying to a real machine.

## One-line pitch

Unit testing for the physical world.