const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const crypto = require('crypto');
const { getPostTrialDiscount, quotePostTrialPrice, bindPostTrialQuote, validatePostTrialQuote } = require('../api/_post-trial-discount');

const connectionString = process.env.PACKAGE_TEST_DATABASE_URL;
const loopback = connectionString && ['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname);

for (const scenario of [
  { name: 'rescheduled trial', method: 'credit', minutes: 0, value: 0 },
  { name: 'trial with a paid extension', method: 'free', minutes: 120, value: 11000 },
]) {
  test(`real eligibility and settlement preserve a ${scenario.name}`, async () => {
    test.skip(!loopback, 'Requires the disposable loopback package database');
    const client = new Client({ connectionString });
    await client.connect();
    await client.query('BEGIN');
    const sql = async (parts, ...values) => (await client.query(
      parts.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values
    )).rows;
    try {
      const suffix = crypto.randomUUID();
      const [type] = await sql`SELECT id,school_id FROM lesson_types WHERE slug='trial'`;
      const schoolId = type.school_id;
      await sql`UPDATE schools SET config='{"timezone":"Europe/London","pricing":{}}' WHERE id=${schoolId}`;
      const [learner] = await sql`INSERT INTO learner_users(name,email,school_id) VALUES ('Trial fixture',${suffix + '@example.invalid'},${schoolId}) RETURNING id`;
      const [otherLearner] = await sql`INSERT INTO learner_users(name,email,school_id) VALUES ('Other fixture',${'other-' + suffix + '@example.invalid'},${schoolId}) RETURNING id`;
      const [instructor] = await sql`INSERT INTO instructors(name,email,school_id) VALUES ('Trial fixture',${suffix + '@example.invalid'},${schoolId}) RETURNING id`;
      const [booking] = await sql`INSERT INTO lesson_bookings(learner_id,instructor_id,lesson_type_id,school_id,scheduled_date,start_time,end_time,status,payment_method,minutes_deducted,list_price_pence)
        VALUES (${learner.id},${instructor.id},${type.id},${schoolId},'2026-09-21','07:00','10:00','scheduled',${scenario.method},${scenario.minutes},${scenario.value}) RETURNING id`;
      const eligibility = now => getPostTrialDiscount(sql, { schoolId, learnerId: learner.id, now: new Date(now) });
      // The trial type alone cannot turn an ordinary paid booking into eligibility.
      expect(await eligibility('2026-09-21T09:00:00Z')).toMatchObject({ eligible: false });
      const [source] = await sql`INSERT INTO credit_transactions(learner_id,type,credits,amount_pence,payment_method,minutes,school_id,instructor_id,source,absorbed_by)
        VALUES (${learner.id},'free_trial',0,0,'free',60,${schoolId},${instructor.id},'free_trial','platform') RETURNING id`;
      const [allocation] = await sql`INSERT INTO booking_credit_sources(booking_id,credit_transaction_id,school_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
        VALUES (${booking.id},${source.id},${schoolId},60,0,0,0,'platform') RETURNING id`;
      expect(await eligibility('2026-09-21T08:59:59.999Z')).toMatchObject({ eligible: false });
      expect(await eligibility('2026-09-21T09:00:00Z')).toMatchObject({ eligible: true, discountPct: 10, eligibleUntil: '2026-09-23T09:00:00.000Z' });
      expect(await eligibility('2026-09-23T08:59:59.999Z')).toMatchObject({ eligible: true });
      expect(await eligibility('2026-09-23T09:00:00Z')).toMatchObject({ eligible: false });

      const quoteArgs = { schoolId, learnerId: learner.id, amountPence: 8250, now: new Date('2026-09-21T09:10:00Z') };
      const quote = await quotePostTrialPrice(sql, quoteArgs);
      const second = await quotePostTrialPrice(sql, quoteArgs);
      expect(quote.pricePence).toBe(7425);
      expect(second.pricePence).toBe(7425);
      expect(second.quoteId).not.toBe(quote.quoteId);
      const payment = { quoteId: quote.quoteId, schoolId, learnerId: learner.id, amountPence: 7425,
        paymentType: 'checkout_session', paymentIdentity: 'cs_' + suffix, providerInitiatedAt: '2026-09-21T09:11:00Z' };
      expect(await bindPostTrialQuote(sql, payment)).toMatchObject({ ok: true });

      // Both quoting and payment validation must reject another learner's source.
      await sql`UPDATE credit_transactions SET learner_id=${otherLearner.id} WHERE id=${source.id} AND school_id=${schoolId}`;
      expect(await eligibility('2026-09-21T09:10:00Z')).toMatchObject({ eligible: false });
      expect(await validatePostTrialQuote(sql, payment)).toMatchObject({ ok: false, code: 'POST_TRIAL_TRIAL_REVOKED' });
      await sql`UPDATE credit_transactions SET learner_id=${learner.id} WHERE id=${source.id} AND school_id=${schoolId}`;
      await sql`UPDATE booking_credit_sources SET refunded_at=NOW() WHERE id=${allocation.id} AND school_id=${schoolId}`;
      expect(await eligibility('2026-09-21T09:10:00Z')).toMatchObject({ eligible: false });
      expect(await validatePostTrialQuote(sql, payment)).toMatchObject({ ok: false, code: 'POST_TRIAL_TRIAL_REVOKED' });
      await sql`UPDATE booking_credit_sources SET refunded_at=NULL WHERE id=${allocation.id} AND school_id=${schoolId}`;
      for (const condition of ["status='refunded'", 'credit_forfeited=TRUE', 'cancelled_at=NOW()']) {
        await client.query(`UPDATE lesson_bookings SET ${condition} WHERE id=$1 AND school_id=$2`, [booking.id, schoolId]);
        expect(await eligibility('2026-09-21T09:10:00Z')).toMatchObject({ eligible: false });
        expect(await validatePostTrialQuote(sql, payment)).toMatchObject({ ok: false, code: 'POST_TRIAL_TRIAL_REVOKED' });
        await sql`UPDATE lesson_bookings SET status='scheduled',credit_forfeited=FALSE,cancelled_at=NULL WHERE id=${booking.id} AND school_id=${schoolId}`;
      }
      expect(await validatePostTrialQuote(sql, payment)).toMatchObject({ ok: true });
      // Elapsed 48 hours stays exact across either UK clock change.
      for (const [date, end, expiry] of [
        ['2026-03-28', '2026-03-28T10:00:00Z', '2026-03-30T10:00:00Z'],
        ['2026-10-24', '2026-10-24T09:00:00Z', '2026-10-26T09:00:00Z'],
      ]) {
        await sql`UPDATE lesson_bookings SET scheduled_date=${date}::date WHERE id=${booking.id} AND school_id=${schoolId}`;
        expect(await eligibility(end)).toMatchObject({ eligible: true, eligibleUntil: new Date(expiry).toISOString() });
        expect(await eligibility(new Date(new Date(expiry).getTime() - 1))).toMatchObject({ eligible: true });
        expect(await eligibility(expiry)).toMatchObject({ eligible: false });
      }
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
}

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
