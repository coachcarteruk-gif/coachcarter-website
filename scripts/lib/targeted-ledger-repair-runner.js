'use strict';

const { Client } = require('pg');

const PRODUCTION_BRANCH_ID = 'br-summer-silence-abcpp6vw';
const PRODUCTION_DATABASE = 'neondb';

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

function validateDirectUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Database URL is invalid');
  }
  if (parsed.hostname.includes('-pooler')) throw new Error('A direct non-pooler database URL is required');
  if (parsed.pathname !== `/${PRODUCTION_DATABASE}`) throw new Error(`Database must be ${PRODUCTION_DATABASE}`);
}

async function validateDatabaseTarget(client, { readOnly }) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_setting('neon.branch_id', true) AS branch_id,
           current_setting('transaction_read_only') AS transaction_read_only
  `);
  const row = result.rows[0] || {};
  if (row.database_name !== PRODUCTION_DATABASE || row.branch_id !== PRODUCTION_BRANCH_ID) {
    throw Object.assign(new Error('Database target identity mismatch'), { code: 'REPAIR_TARGET_MISMATCH' });
  }
  if (readOnly && row.transaction_read_only !== 'on') {
    throw Object.assign(new Error('Dry-run transaction is not read-only'), { code: 'REPAIR_READ_ONLY_MISMATCH' });
  }
}

async function runTargetedRepair({
  argv = process.argv.slice(2),
  applicationName,
  mutationEnvName,
  mutationEnvValue,
  applyConfirmation,
  buildPreview,
  applyRepair,
}) {
  const args = parseArgs(argv);
  const mode = String(args.mode || 'dry-run');
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('--mode must be dry-run or apply');
  const databaseUrl = process.env.POSTGRES_URL_UNPOOLED;
  if (!databaseUrl) throw new Error('POSTGRES_URL_UNPOOLED is required');
  validateDirectUrl(databaseUrl);

  if (mode === 'apply') {
    if (process.env[mutationEnvName] !== mutationEnvValue) {
      throw new Error(`Set ${mutationEnvName}=${mutationEnvValue} for apply mode`);
    }
    if (args.confirm !== applyConfirmation) {
      throw new Error(`--confirm=${applyConfirmation} is required for apply mode`);
    }
  }

  const client = new Client({ connectionString: databaseUrl, application_name: applicationName });
  let began = false;
  try {
    await client.connect();
    await client.query(mode === 'dry-run' ? 'BEGIN READ ONLY' : 'BEGIN');
    began = true;
    if (mode === 'apply') await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await validateDatabaseTarget(client, { readOnly: mode === 'dry-run' });

    if (mode === 'dry-run') {
      const result = await buildPreview(client);
      await client.query('ROLLBACK');
      began = false;
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result;
    }

    const reviewedFingerprint = requiredText(args, 'reviewed-fingerprint');
    const operatorIdentity = requiredText(args, 'operator-identity');
    const evidenceReference = requiredText(args, 'evidence-reference');
    const adminId = Number(args['admin-id']);
    if (!Number.isSafeInteger(adminId) || adminId <= 0) throw new Error('--admin-id must be a positive integer');
    const result = await applyRepair(client, { reviewedFingerprint, adminId, operatorIdentity, evidenceReference });
    await client.query('COMMIT');
    began = false;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    if (error.preview) process.stderr.write(`${JSON.stringify(error.preview, null, 2)}\n`);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  PRODUCTION_BRANCH_ID,
  PRODUCTION_DATABASE,
  parseArgs,
  runTargetedRepair,
  validateDatabaseTarget,
  validateDirectUrl,
};
