#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const result = spawnSync('npx', ['tsx', path.join(__dirname, '../mcp/server.ts')], { stdio: 'inherit' });
process.exit(result.status ?? 0);
