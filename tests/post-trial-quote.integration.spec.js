const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const crypto = require('crypto');
const { quotePostTrialPrice, bindPostTrialQuote, validatePostTrialQuote } = require('../api/_post-trial-discount');

const connectionString = process.env.PACKAGE_TEST_DATABASE_URL;
const loopback = connectionString && ['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname);

test('real quote ledger preserves tenant ownership, exact price and revoked-trial rejection', async () => {
  test.skip(!loopback, 'Requires the disposable loopback package database');
  const client = new Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');
  const sql = async (parts, ...values) => (await client.query(
    parts.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values
  )).rows;
  try {
    const suffix = crypto.randomUUID();
    await client.query("INSERT INTO migration_markers(key,notes) VALUES ('public_endpoints_tenant_resolved','local quote fixture') ON CONFLICT(key) DO NOTHING");
    // The historical aggregate has a global unique lesson-type slug. Reuse its
    // seeded trial school only inside this rolled-back, loopback transaction.
    const lessonType = (await sql`SELECT id,school_id FROM lesson_types WHERE slug='trial'`)[0];
    const school = { id: lessonType.school_id };
    await sql`UPDATE schools SET config='{"timezone":"UTC","pricing":{"post_trial_discount_pct":10,"post_trial_discount_hours":48}}' WHERE id=${school.id}`;
    const learner = (await sql`INSERT INTO learner_users(name,email,school_id) VALUES ('Quote fixture',${suffix + '@example.invalid'},${school.id}) RETURNING id`)[0];
    const instructor = (await sql`INSERT INTO instructors(name,email,school_id) VALUES ('Quote fixture',${suffix + '@example.invalid'},${school.id}) RETURNING id`)[0];
    const booking = (await sql`INSERT INTO lesson_bookings(learner_id,instructor_id,lesson_type_id,school_id,scheduled_date,start_time,end_time,status,payment_method,minutes_deducted,list_price_pence)
      VALUES (${learner.id},${instructor.id},${lessonType.id},${school.id},'2026-09-19','09:00','10:00','scheduled','free',0,0) RETURNING id`)[0];
    const quote = await quotePostTrialPrice(sql, { schoolId: school.id, learnerId: learner.id, amountPence: 5501, now: new Date('2026-09-19T11:00:00Z') });
    expect(quote.pricePence).toBe(4951);
    expect(quote.discountPence + quote.pricePence).toBe(5501);
    expect(await bindPostTrialQuote(sql, { quoteId: quote.quoteId, schoolId: school.id, learnerId: learner.id, paymentType: 'checkout_session', paymentIdentity: 'cs_local_' + suffix })).toMatchObject({ ok: true });
    const input = { quoteId: quote.quoteId, schoolId: school.id, learnerId: learner.id, amountPence: 4951, paymentType: 'checkout_session', paymentIdentity: 'cs_local_' + suffix, providerInitiatedAt: '2026-09-19T11:01:00Z' };
    expect(await validatePostTrialQuote(sql, { ...input, schoolId: school.id + 10000 })).toMatchObject({ ok: false });
    expect(await validatePostTrialQuote(sql, { ...input, learnerId: learner.id + 10000 })).toMatchObject({ ok: false });
    expect(await validatePostTrialQuote(sql, input)).toMatchObject({ ok: true });
    const uninitiated = await quotePostTrialPrice(sql, { schoolId: school.id, learnerId: learner.id, amountPence: 5501, now: new Date('2026-09-19T11:00:00Z') });
    const uninitiatedInput = { ...input, quoteId: uninitiated.quoteId, paymentIdentity: 'cs_uninitiated_' + suffix };
    await bindPostTrialQuote(sql, uninitiatedInput);
    await sql`UPDATE lesson_bookings SET status='refunded' WHERE id=${booking.id} AND school_id=${school.id}`;
    expect(await validatePostTrialQuote(sql, uninitiatedInput)).toMatchObject({ ok: false, code: 'POST_TRIAL_TRIAL_REVOKED' });
    expect(await validatePostTrialQuote(sql, input)).toMatchObject({ ok: true });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
