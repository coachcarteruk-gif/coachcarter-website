#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sha256 } = require('./lib/migration-governance');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'db', 'migrations');
const manifestPath = path.join(migrationsDir, 'manifest.json');
const existingManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { migrations: [] };
const existingByFilename = new Map(existingManifest.migrations.map(entry => [entry.filename, entry]));

function readMigration(filename) {
  try {
    return fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
    return execFileSync('git', ['show', `:db/migrations/${filename}`], {
      cwd: root,
      encoding: 'utf8',
    });
  }
}

const filenames = fs.readdirSync(migrationsDir)
  .filter(filename => /^\d{3}_[a-z0-9_]+\.sql$/.test(filename))
  .sort((left, right) => left.localeCompare(right));

const migrations = filenames.map((filename, index) => {
  const prefix = filename.slice(0, 3);
  let id = prefix;
  if (filename === '026_public_tenant_resolution.sql') id = '026a';
  if (filename === '026_weekly_availability_transmission.sql') id = '026b';
  const existing = existingByFilename.get(filename);
  const historicalExecution = filename === '041_connect_v2_onboarding_readiness.sql'
    ? 'deferred'
    : 'baseline';
  return {
    id: existing?.id || id,
    order: index + 1,
    prefix,
    filename,
    checksum: sha256(readMigration(filename)),
    execution: existing?.execution
      || (Number(prefix) <= 60 ? historicalExecution : 'numbered'),
  };
});

const manifest = {
  version: 1,
  checksumAlgorithm: 'sha256-lf-v1',
  legacyPrefixCollisions: {
    '026': ['026a', '026b'],
  },
  migrations,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Updated ${path.relative(root, manifestPath)} with ${migrations.length} migrations.\n`);
