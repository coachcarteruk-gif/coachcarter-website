#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['api', 'public'];
const SKIP_DIRS = new Set(['node_modules', '.vercel', '.git']);
const EXTS = new Set(['.js', '.html', '.css']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(full))) out.push(full);
  }
}

const files = [];
for (const t of TARGETS) {
  const abs = path.join(ROOT, t);
  if (fs.existsSync(abs)) walk(abs, files);
}

let hits = 0;
for (const f of files) {
  const buf = fs.readFileSync(f);
  const text = buf.toString('utf8');
  const matches = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x0080 && code <= 0x009f) {
      const before = text.slice(Math.max(0, i - 1), i);
      const lineStart = text.lastIndexOf('\n', i) + 1;
      const lineNum = text.slice(0, i).split('\n').length;
      matches.push({ lineNum, code, before });
      if (matches.length >= 3) break;
    }
  }
  if (matches.length) {
    hits++;
    const rel = path.relative(ROOT, f);
    process.stderr.write(`HIT ${rel}\n`);
    for (const m of matches) {
      process.stderr.write(`  line ${m.lineNum}: U+${m.code.toString(16).padStart(4, '0').toUpperCase()}\n`);
    }
  }
}

if (hits > 0) {
  process.stderr.write(`\n${hits} file(s) contain C1 control characters (U+0080-U+009F)\n`);
  process.exit(1);
}
process.stdout.write(`OK no C1 controls in ${files.length} files\n`);
