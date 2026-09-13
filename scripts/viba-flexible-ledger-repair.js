#!/usr/bin/env node

/**
 * Approval-gated repair for the Viba Balaji Flexible Hours ledger incident.
 *
 * Dry-run is the default and performs read-only SQL only. Apply requires all
 * three independent gates below and never calls Stripe.
 */

const fs = require('fs');
const path = require('path');
const { neon, Client, neonConfig } = require('@neondatabase/serverless');
const {
  REPAIR_VERSION,
  applyVibaRepair,
  buildVibaRepairPreview,
} = require('../api/_viba-flexible-ledger-repair');

const MUTATION_ENV_GATE = 'VIBA_FLEXIBLE_LEDGER_REPAIR_REVIEWED';
const APPLY_CONFIRMATION = 'APPLY_VIBA_FLEXIBLE_LEDGER_REPAIR';

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const result = {};
  for (const entry of argv) {
    if (!entry.startsWith('--')) throw new Error(`Unexpected argument: ${entry}`);
    const separator = entry.indexOf('=');
    const key = separator < 0 ? entry.slice(2) : entry.slice(2, separator);
    const value = separator < 0 ? true : entry.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`Duplicate argument: --${key}`);
    result[key] = value;
  }
  return result;
}

function requiredText(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`--${key}=... is required`);
  return value;
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'dry-run');
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('--mode must be dry-run or apply');

  const databaseUrl = mode === 'dry-run'
    ? (process.env.POSTGRES_URL_READONLY || process.env.POSTGRES_URL)
    : process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL_READONLY or POSTGRES_URL is required');

  if (mode === 'dry-run') {
    const preview = await buildVibaRepairPreview({
      query: async (text, params) => {
        const result = await neon(databaseUrl)(text, params);
        return { rows: result, rowCount: result.length };
      },
    });
    process.stdout.write(`${JSON.stringify({ ...preview, repair_version: REPAIR_VERSION }, null, 2)}\n`);
    return;
  }

  if (process.env.VIBA_FLEXIBLE_LEDGER_REPAIR_ENABLED !== MUTATION_ENV_GATE) {
    throw new Error(`Set VIBA_FLEXIBLE_LEDGER_REPAIR_ENABLED=${MUTATION_ENV_GATE} for apply mode`);
  }
  if (args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`--confirm=${APPLY_CONFIRMATION} is required for apply mode`);
  }
  const reviewedFingerprint = requiredText(args, 'reviewed-fingerprint');
  const operatorIdentity = requiredText(args, 'operator-identity');
  const evidenceReference = requiredText(args, 'evidence-reference');
  const adminId = Number(args['admin-id']);
  if (!Number.isSafeInteger(adminId) || adminId <= 0) throw new Error('--admin-id must be a positive integer');

  if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
  const client = new Client({ connectionString: databaseUrl });
  let began = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    began = true;
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const result = await applyVibaRepair(client, {
      reviewedFingerprint,
      adminId,
      operatorIdentity,
      evidenceReference,
    });
    await client.query('COMMIT');
    began = false;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    if (error.preview) process.stderr.write(`${JSON.stringify(error.preview, null, 2)}\n`);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { APPLY_CONFIRMATION, MUTATION_ENV_GATE, main, parseArgs };
