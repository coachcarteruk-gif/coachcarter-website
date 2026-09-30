const { test, expect } = require('@playwright/test');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createPencilledOfferTransaction } = require('../api/_pencilled-offer-store');
const { loadInstructorOccupiedTime, busyBlocksWereReviewed } = require('../api/_instructor-schedule-warnings');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('busy review compares exact identities and times, including seconds', () => {
  const approved = [{ id: 1, start_time: '09:00:00', end_time: '11:00:00' }];
  expect(busyBlocksWereReviewed([{ id: 1, start_time: '09:00', end_time: '11:00' }], approved)).toBe(true);
  for (const change of [{ id: 2 }, { start_time: '09:00:30' }, { end_time: '11:30:00' }]) {
    expect(busyBlocksWereReviewed([{ ...approved[0], ...change }], approved)).toBe(false);
  }
});

test('pencilled busy overrides survive creation and fulfilment checks, while other conflicts stay blocked', async () => {
  test.setTimeout(60000);
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE lesson_offers (
        id SERIAL PRIMARY KEY, school_id INT, instructor_id INT, learner_id INT, learner_email TEXT,
        learner_name TEXT, token TEXT, scheduled_date DATE, start_time TIME, end_time TIME,
        status TEXT, expires_at TIMESTAMPTZ, kind TEXT DEFAULT 'manual', pencilled BOOLEAN DEFAULT FALSE,
        booking_id INT, lesson_type_id INT, discount_pct INT, offer_price_pence INT, max_repeat_weeks INT
      );
      CREATE TABLE lesson_bookings (id SERIAL PRIMARY KEY, school_id INT, instructor_id INT,
        scheduled_date DATE, start_time TIME, end_time TIME, status TEXT, slot_released_at TIMESTAMPTZ);
      CREATE TABLE lesson_requests (id SERIAL PRIMARY KEY, school_id INT, instructor_id INT,
        scheduled_date DATE, start_time TIME, end_time TIME, status TEXT, expires_at TIMESTAMPTZ);
      CREATE TABLE slot_reservations (id SERIAL PRIMARY KEY, school_id INT, instructor_id INT,
        scheduled_date DATE, start_time TIME, end_time TIME, expires_at TIMESTAMPTZ);
      CREATE TABLE recurring_slot_block_items (id SERIAL PRIMARY KEY, school_id INT, instructor_id INT,
        scheduled_date DATE, start_time TIME, end_time TIME, status TEXT);
      CREATE TABLE instructor_busy_blocks (id SERIAL PRIMARY KEY, school_id INT, instructor_id INT,
        block_date DATE, start_time TIME, end_time TIME);
      -- This single-connection test checks data and trigger semantics, not concurrency.
      CREATE FUNCTION lock_pencilled_slot_day(INT,INT,DATE) RETURNS VOID AS $$ BEGIN END $$ LANGUAGE plpgsql;
      INSERT INTO instructor_busy_blocks VALUES (1,7,6,'2030-09-23','18:00','20:00');
    `);
    const migration = read('db/migrations/075_instructor_busy_block_overrides.sql');
    await db.exec(migration);
    await db.exec(migration); // repeat-applicable, preserves empty/default historical snapshots
    await db.exec(`CREATE TRIGGER trg_offer_pencilled_guard BEFORE INSERT OR UPDATE ON lesson_offers
      FOR EACH ROW EXECUTE FUNCTION guard_calendar_row_against_pencilled_offer();`);
    const client = { query: async (text, values) => {
      const result = await db.query(text, values);
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
    } };
    const transactionRunner = async (_, callback) => {
      await db.exec('BEGIN');
      try { const result = await callback(client); await db.exec('COMMIT'); return result; }
      catch (error) { await db.exec('ROLLBACK'); throw error; }
    };
    const offer = { schoolId: 7, instructorId: 6, learnerId: 22, learnerEmail: 'test@example.invalid',
      learnerName: 'Test learner', token: 'test', scheduledDate: '2030-09-23',
      startTime: '18:30', endTime: '19:30', lessonTypeId: 1, offerPricePence: 5500,
      expiresAt: '2030-09-22T12:00:00Z',
      busyBlockOverrides: [{ id: 1, start_time: '18:00:00', end_time: '20:00:00' }] };
    await expect(createPencilledOfferTransaction({ offer: { ...offer, busyBlockOverrides: [] }, transactionRunner }))
      .rejects.toMatchObject({ code: 'PENCILLED_SLOT_UNAVAILABLE' });
    // Test the database trigger itself, independently of the application precheck.
    await expect(db.query(`INSERT INTO lesson_offers(school_id,instructor_id,scheduled_date,start_time,end_time,
      status,expires_at,pencilled) VALUES(7,6,'2030-09-23','18:30','19:30','pending','2030-09-22',TRUE)`))
      .rejects.toMatchObject({ code: '23P01' });
    const saved = await createPencilledOfferTransaction({ offer, transactionRunner });
    expect(saved.id).toBeTruthy();
    expect((await db.query('SELECT busy_block_overrides FROM lesson_offers WHERE id=$1', [saved.id])).rows[0]
      .busy_block_overrides).toEqual(offer.busyBlockOverrides);

    const source = read('api/webhook.js');
    const start = source.indexOf('async function findPencilledFulfilmentConflict(');
    const end = source.indexOf('async function fulfilPencilledOffer(', start);
    const context = vm.createContext({ BLOCKING_STATUSES: ['scheduled', 'chargeable'] });
    vm.runInContext(source.slice(start, end), context);
    const proposal = { schoolId: 7, instructorId: 6, scheduledDate: offer.scheduledDate,
      startTime: offer.startTime, endTime: offer.endTime, offerId: saved.id };
    const conflict = changes => context.findPencilledFulfilmentConflict(client, { ...proposal, ...changes });
    expect(await conflict()).toBeNull();
    expect(await conflict({ offerId: saved.id + 1 })).toBe('offer');
    expect(await conflict({ startTime: '18:00' })).toBe('busy_block');
    await db.exec("UPDATE instructor_busy_blocks SET end_time='20:30' WHERE id=1");
    expect(await conflict()).toBe('busy_block');
    await db.exec("UPDATE instructor_busy_blocks SET end_time='20:00' WHERE id=1");
    await db.exec("INSERT INTO instructor_busy_blocks VALUES (2,7,6,'2030-09-23','19:00','20:00')");
    expect(await conflict()).toBe('busy_block');
    await db.exec('DELETE FROM instructor_busy_blocks WHERE id=2');
    // Another school's block must not affect this agreement.
    await db.exec("INSERT INTO instructor_busy_blocks VALUES (3,8,6,'2030-09-23','19:00','20:00')");
    expect(await conflict()).toBeNull();
    await db.exec("INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(7,6,'2030-09-23','19:00','20:30','scheduled')");
    expect(await conflict()).toBe('booking');

    const sql = (strings, ...values) => {
      const text = strings.reduce((query, part, index) => query + (index ? '$' + index : '') + part, '');
      return db.query(text, values).then(result => result.rows);
    };
    expect(await loadInstructorOccupiedTime(sql, proposal)).toMatchObject({ source: 'an existing lesson' });
    expect(await loadInstructorOccupiedTime(sql, { ...proposal, schoolId: 8 })).toBeUndefined();
    await db.exec('DELETE FROM lesson_bookings; DELETE FROM lesson_offers');
    for (const [table, source, extra] of [
      ['lesson_requests', 'a pending lesson request', ",status,expires_at"],
      ['slot_reservations', 'a checkout reservation', ",expires_at"],
      ['recurring_slot_block_items', 'a recurring slot hold', ",status"],
    ]) {
      const values = table === 'lesson_requests' ? ",'pending','2030-09-24'"
        : table === 'slot_reservations' ? ",'2030-09-24'" : ",'held'";
      await db.exec(`INSERT INTO ${table}(school_id,instructor_id,scheduled_date,start_time,end_time${extra})
        VALUES(7,6,'2030-09-23','19:00','20:30'${values})`);
      expect(await loadInstructorOccupiedTime(sql, proposal)).toMatchObject({ source });
      await expect(createPencilledOfferTransaction({ offer, transactionRunner }))
        .rejects.toMatchObject({ code: 'PENCILLED_SLOT_UNAVAILABLE' });
      await db.exec('DELETE FROM ' + table);
    }
  } finally { await db.close(); }
});
