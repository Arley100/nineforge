#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const args = process.argv.slice(2);
const result = spawnSync('npx', ['tsx', path.join(__dirname, '../cli/sarif.ts'), ...args], { stdio: 'inherit' });
process.exit(result.status ?? 0);
