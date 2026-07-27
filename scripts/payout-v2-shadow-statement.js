#!/usr/bin/env node

/**
 * Payout v2 Slice 3 read-only shadow statement.
 *
 * Required:
 *   PAYOUT_V2_SCHOOL_ID
 *   PAYOUT_V2_ROUTE=instructor_direct|school
 *   PAYOUT_V2_PERIOD_START=YYYY-MM-DD
 *   PAYOUT_V2_PERIOD_END=YYYY-MM-DD
 *   PAYOUT_V2_INSTRUCTOR_ID (for instructor_direct)
 *
 * This command performs SELECTs only. It does not materialise a plan, claim
 * earnings, update the activation switch, or call Stripe.
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { buildPayoutV2ShadowStatement } = require('../api/_payout-v2-shadow');

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function positiveInteger(name, { optional = false } = {}) {
  const raw = process.env[name];
  if (optional && !raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be an explicit positive integer`);
  }
  return value;
}

async function main() {
  loadEnvLocal();
  const schoolId = positiveInteger('PAYOUT_V2_SCHOOL_ID');
  const payoutRoute = process.env.PAYOUT_V2_ROUTE;
  if (!['instructor_direct', 'school'].includes(payoutRoute)) {
    throw new Error('PAYOUT_V2_ROUTE must be instructor_direct or school');
  }
  const instructorId = positiveInteger('PAYOUT_V2_INSTRUCTOR_ID', {
    optional: payoutRoute === 'school',
  });
  const periodStart = process.env.PAYOUT_V2_PERIOD_START;
  const periodEnd = process.env.PAYOUT_V2_PERIOD_END;
  if (!periodStart || !periodEnd) {
    throw new Error('PAYOUT_V2_PERIOD_START and PAYOUT_V2_PERIOD_END are required');
  }
  const databaseUrl = process.env.POSTGRES_URL_READONLY || process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL_READONLY or POSTGRES_URL is required');

  const sql = neon(databaseUrl);
  const statement = await buildPayoutV2ShadowStatement({
    sql,
    schoolId,
    payoutRoute,
    instructorId,
    periodStart,
    periodEnd,
    snapshotAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(statement, null, 2));
}

main().catch((err) => {
  console.error(`Payout v2 shadow statement failed: ${err.message}`);
  process.exitCode = 1;
});
