#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['api', 'public'];
const SKIP_DIRS = new Set(['node_modules', '.vercel', '.git']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
}

const files = [];
for (const t of TARGETS) {
  const abs = path.join(ROOT, t);
  if (fs.existsSync(abs)) walk(abs, files);
}

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    failed++;
    const rel = path.relative(ROOT, f);
    process.stderr.write(`FAIL ${rel}\n`);
    if (err.stderr) process.stderr.write(err.stderr.toString() + '\n');
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} of ${files.length} file(s) failed syntax check\n`);
  process.exit(1);
}
process.stdout.write(`OK ${files.length} files\n`);
