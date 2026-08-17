// @ts-check
// Proves the production privilege shape against an isolated Neon test branch:
// a restricted runtime role can update balances, the owner-controlled trigger
// records the session role, and the runtime still cannot read or forge audit rows.

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

function quotedIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error('Unsafe generated role identifier');
  return `"${value}"`;
}

test('restricted balance writer remains audited without ledger privileges', async () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to an isolated Neon branch.');
  if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
    throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST matches POSTGRES_URL');
  }

  const owner = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
  const suffix = crypto.randomBytes(6).toString('hex');
  const role = `cc_test_balance_audit_${suffix}`;
  const password = crypto.randomBytes(24).toString('hex');
  const email = `balance-audit-${suffix}@example.test`;
  const roleIdentifier = quotedIdentifier(role);
  let runtime;
  let learnerId;

  await owner.connect();
  try {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '052_balance_audit_security_definer.sql'),
      'utf8'
    );
    await owner.query(migration);

    const instructor = await owner.query('SELECT id, school_id FROM instructors ORDER BY id LIMIT 1');
    if (instructor.rowCount !== 1) throw new Error('Test branch needs one instructor fixture');
    const instructorId = Number(instructor.rows[0].id);
    const schoolId = Number(instructor.rows[0].school_id);

    const learner = await owner.query(
      `INSERT INTO learner_users (name,email,balance_minutes,credit_balance,school_id)
       VALUES ('Balance audit role test',$1,0,0,$2) RETURNING id`,
      [email, schoolId]
    );
    learnerId = Number(learner.rows[0].id);
    await owner.query(
      `INSERT INTO learner_credit_balances (learner_id,instructor_id,school_id,balance_minutes)
       VALUES ($1,$2,$3,0)`,
      [learnerId, instructorId, schoolId]
    );
    await owner.query(`CREATE ROLE ${roleIdentifier} LOGIN PASSWORD '${password}'`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
    await owner.query(
      `GRANT SELECT, UPDATE ON public.learner_credit_balances, public.learner_users TO ${roleIdentifier}`
    );

    const runtimeUrl = new URL(process.env.POSTGRES_URL_TEST);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    runtime = new Client({ connectionString: runtimeUrl.toString() });
    await runtime.connect();
    await runtime.query("SET application_name='cc-balance-audit-runtime-test'");
    await runtime.query('BEGIN');
    await runtime.query(
      `UPDATE learner_credit_balances SET balance_minutes=balance_minutes+1
        WHERE learner_id=$1 AND instructor_id=$2 AND school_id=$3`,
      [learnerId, instructorId, schoolId]
    );
    await runtime.query(
      `UPDATE learner_credit_balances SET balance_minutes=balance_minutes-1
        WHERE learner_id=$1 AND instructor_id=$2 AND school_id=$3`,
      [learnerId, instructorId, schoolId]
    );
    await runtime.query('COMMIT');

    const audit = await owner.query(
      `SELECT delta_minutes,db_session_user,application_name
         FROM balance_audit WHERE learner_id=$1 ORDER BY id`,
      [learnerId]
    );
    expect(audit.rows).toEqual([
      { delta_minutes: 1, db_session_user: role, application_name: 'cc-balance-audit-runtime-test' },
      { delta_minutes: -1, db_session_user: role, application_name: 'cc-balance-audit-runtime-test' },
    ]);

    const privileges = await owner.query(
      `SELECT has_table_privilege($1,'public.balance_audit','INSERT') AS audit_insert,
              has_sequence_privilege($1,'public.balance_audit_id_seq','USAGE') AS sequence_usage,
              has_function_privilege($1,'public.trg_balance_audit()','EXECUTE') AS function_execute`,
      [role]
    );
    expect(privileges.rows[0]).toEqual({
      audit_insert: false,
      sequence_usage: false,
      function_execute: false,
    });

    let directReadError;
    try {
      await runtime.query('SELECT 1 FROM public.balance_audit LIMIT 1');
    } catch (error) {
      directReadError = error;
    }
    expect(directReadError?.code).toBe('42501');
  } finally {
    if (runtime) await runtime.end().catch(() => {});
    if (learnerId) {
      await owner.query('DELETE FROM balance_audit WHERE learner_id=$1', [learnerId]).catch(() => {});
      await owner.query('DELETE FROM learner_credit_balances WHERE learner_id=$1', [learnerId]).catch(() => {});
      await owner.query('DELETE FROM learner_users WHERE id=$1', [learnerId]).catch(() => {});
    }
    await owner.query(`DROP OWNED BY ${roleIdentifier}`).catch(() => {});
    await owner.query(`DROP ROLE IF EXISTS ${roleIdentifier}`).catch(() => {});
    await owner.end().catch(() => {});
  }
});
