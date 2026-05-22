// @ts-check
// Integration canary for api/_db-transaction.js against a real Neon test branch.
//
// This proves the request-scoped Client transaction shape needed by the future
// atomic BCS booking writer: commit/rollback, dynamic returned IDs, and
// SELECT ... FOR UPDATE serialization across two independent clients.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      if (key.startsWith('#') || process.env[key] !== undefined) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (err) {
    console.warn('[neon-transaction.integration] .env.local load failed:', err.message);
  }
})();

const { withNeonTransaction } = require('../api/_db-transaction');

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

let sql;
const SCHOOL_ID = 1;
const createdLearnerIds = [];

function freshEmail(label) {
  return `test+neon-tx-${label}-${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
}

async function insertLearner(client, label) {
  const email = freshEmail(label);
  const result = await client.query(
    `INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
     VALUES ($1, $2, $3, 0, 0)
     RETURNING id, email`,
    [`Neon Tx ${label}`, email, SCHOOL_ID],
  );
  createdLearnerIds.push(result.rows[0].id);
  return result.rows[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test.describe('withNeonTransaction - integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against a Neon test branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    sql = neon(process.env.POSTGRES_URL_TEST);

    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }
  });

  test.afterEach(async () => {
    if (!ENABLED || createdLearnerIds.length === 0) return;
    const ids = createdLearnerIds.splice(0);
    await sql`DELETE FROM credit_transactions WHERE learner_id = ANY(${ids})`;
    await sql`DELETE FROM learner_users WHERE id = ANY(${ids})`;
  });

  test('commit persists writes', async () => {
    const row = await withNeonTransaction(process.env.POSTGRES_URL_TEST, async client => {
      return insertLearner(client, 'commit');
    });

    const [persisted] = await sql`
      SELECT id, email FROM learner_users WHERE id = ${row.id}
    `;

    expect(persisted).toEqual(expect.objectContaining({
      id: row.id,
      email: row.email,
    }));
  });

  test('rollback removes writes', async () => {
    const email = freshEmail('rollback');

    await expect(withNeonTransaction(process.env.POSTGRES_URL_TEST, async client => {
      const result = await client.query(
        `INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
         VALUES ($1, $2, $3, 0, 0)
         RETURNING id`,
        ['Neon Tx Rollback', email, SCHOOL_ID],
      );
      createdLearnerIds.push(result.rows[0].id);
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');

    const rows = await sql`
      SELECT id FROM learner_users WHERE email = ${email}
    `;

    expect(rows).toHaveLength(0);
  });

  test('returned IDs can drive later queries in the same transaction', async () => {
    const result = await withNeonTransaction(process.env.POSTGRES_URL_TEST, async client => {
      const learner = await insertLearner(client, 'returned-id');

      await client.query(
        'UPDATE learner_users SET balance_minutes = balance_minutes + $1 WHERE id = $2',
        [90, learner.id],
      );

      const reloaded = await client.query(
        'SELECT id, balance_minutes FROM learner_users WHERE id = $1',
        [learner.id],
      );

      return reloaded.rows[0];
    });

    expect(result.balance_minutes).toBe(90);

    const [persisted] = await sql`
      SELECT balance_minutes FROM learner_users WHERE id = ${result.id}
    `;
    expect(persisted.balance_minutes).toBe(90);
  });

  test('SELECT FOR UPDATE serializes two concurrent clients for the same row', async () => {
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Neon Tx Lock', ${freshEmail('lock')}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    createdLearnerIds.push(learner.id);

    const firstLocked = deferred();
    const releaseFirst = deferred();
    let secondAcquired = false;

    const first = withNeonTransaction(process.env.POSTGRES_URL_TEST, async client => {
      await client.query('SELECT id FROM learner_users WHERE id = $1 FOR UPDATE', [learner.id]);
      firstLocked.resolve();
      await releaseFirst.promise;
      await client.query('UPDATE learner_users SET balance_minutes = balance_minutes + 1 WHERE id = $1', [learner.id]);
      return 'first';
    });

    await firstLocked.promise;

    const second = withNeonTransaction(process.env.POSTGRES_URL_TEST, async client => {
      await client.query('SELECT id FROM learner_users WHERE id = $1 FOR UPDATE', [learner.id]);
      secondAcquired = true;
      await client.query('UPDATE learner_users SET balance_minutes = balance_minutes + 10 WHERE id = $1', [learner.id]);
      return 'second';
    });

    await sleep(250);
    expect(secondAcquired).toBe(false);

    releaseFirst.resolve();

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(secondAcquired).toBe(true);

    const [persisted] = await sql`
      SELECT balance_minutes FROM learner_users WHERE id = ${learner.id}
    `;
    expect(persisted.balance_minutes).toBe(11);
  });
});
