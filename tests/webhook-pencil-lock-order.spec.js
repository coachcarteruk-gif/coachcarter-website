const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function migration066Mirror(aggregate) {
  const startMarker = '-- 066_pencilled_offers.sql\n';
  const endMarker = '\n-- 067_post_trial_discount.sql';
  const start = aggregate.indexOf(startMarker);
  const end = aggregate.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Aggregate migration is missing the 066 mirror markers');
  return aggregate.slice(start + startMarker.length, end).trim();
}

test.describe('pencilled fulfilment lock-order SQL contract', () => {
  test('numbered 066 and its aggregate mirror remain exact and repeat-applicable', () => {
    const numbered = read('db/migrations/066_pencilled_offers.sql').trim();
    const aggregate = read('db/migration.sql');

    expect(migration066Mirror(aggregate)).toBe(numbered);
    expect(numbered).toContain('ADD COLUMN IF NOT EXISTS pencilled');
    expect(numbered).toContain('CREATE INDEX IF NOT EXISTS idx_lesson_offers_pencilled_learner_pending');
    expect(numbered).toContain('CREATE OR REPLACE FUNCTION lock_pencilled_slot_day');
    expect(numbered).toContain('CREATE OR REPLACE FUNCTION guard_calendar_row_against_pencilled_offer');
    expect(numbered).toContain('DROP TRIGGER IF EXISTS trg_booking_pencilled_guard');
    expect(numbered).toContain('DROP TRIGGER IF EXISTS trg_busy_block_pencilled_guard');
  });

  test('a writer waking after fulfilment sees only accepted-pencil-owned booking overlaps', () => {
    const migration = read('db/migrations/066_pencilled_offers.sql');
    const lock = migration.indexOf('PERFORM lock_pencilled_slot_day(v_school_id, v_instructor_id, v_date);');
    const activePencil = migration.indexOf("AND offer.status = 'pending'", lock);
    const fulfilledPencil = migration.indexOf("AND offer.status = 'accepted'", activePencil);

    expect(lock).toBeGreaterThan(-1);
    expect(activePencil).toBeGreaterThan(lock);
    expect(fulfilledPencil).toBeGreaterThan(activePencil);

    const fulfilledGuard = migration.slice(
      migration.lastIndexOf('IF EXISTS (', fulfilledPencil),
      migration.indexOf('RETURN NEW;', fulfilledPencil)
    );
    expect(fulfilledGuard).toContain('FROM lesson_offers offer');
    expect(fulfilledGuard).toContain('JOIN lesson_bookings booking');
    expect(fulfilledGuard).toContain('ON booking.id = offer.booking_id');
    expect(fulfilledGuard).toContain('AND offer.pencilled = TRUE');
    expect(fulfilledGuard).toContain("AND offer.status = 'accepted'");
    expect(fulfilledGuard).toContain('AND booking.instructor_id = v_instructor_id');
    expect(fulfilledGuard).toContain("AND booking.status IN ('scheduled','chargeable')");
    expect(fulfilledGuard).toContain("AND (TG_TABLE_NAME <> 'lesson_bookings' OR booking.id <> NEW.id)");
    expect(fulfilledGuard).toContain('AND booking.start_time < v_end');
    expect(fulfilledGuard).toContain('AND booking.end_time > v_start');
    expect(fulfilledGuard).toContain("USING ERRCODE = '23P01'");

    // The added protection is anchored to offer.booking_id. It is not a
    // general lesson_bookings self-join and therefore does not change the
    // historical ordinary-vs-ordinary overlap contract.
    expect(fulfilledGuard).not.toContain('FROM lesson_bookings existing_booking');
    expect(fulfilledGuard).not.toContain('booking.instructor_id = offer.instructor_id');
    expect(fulfilledGuard).not.toContain('offer.instructor_id = v_instructor_id');
  });

  test('busy-block writers share the day lock and pencil creation rechecks their interval', () => {
    const migration = read('db/migrations/066_pencilled_offers.sql');
    const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION guard_calendar_row_against_pencilled_offer');
    const triggerStart = migration.indexOf('DROP TRIGGER IF EXISTS trg_busy_block_pencilled_guard');
    const guard = migration.slice(functionStart, triggerStart);
    const pencilCreationGuard = guard.slice(
      guard.indexOf("IF TG_TABLE_NAME = 'lesson_offers'"),
      guard.indexOf("RAISE EXCEPTION 'pencilled offer conflicts with active calendar row'")
    );

    expect(guard).toContain("IF TG_TABLE_NAME = 'instructor_busy_blocks' THEN");
    expect(guard).toContain('v_date := NEW.block_date;');
    expect(guard).toContain('v_old_date := OLD.block_date;');
    expect(guard).toContain("ELSIF TG_TABLE_NAME = 'instructor_busy_blocks' THEN\n    v_active := TRUE;");
    expect(guard).toContain('PERFORM lock_pencilled_slot_day(v_school_id, v_instructor_id, v_date);');
    expect(pencilCreationGuard).toContain('SELECT 1 FROM instructor_busy_blocks busy');
    expect(pencilCreationGuard).toContain('AND busy.block_date=v_date');
    expect(pencilCreationGuard).toContain('AND busy.start_time<v_end AND busy.end_time>v_start');
    expect(migration.slice(triggerStart)).toContain(
      'BEFORE INSERT OR UPDATE OF school_id, instructor_id, block_date, start_time, end_time'
    );

    // The mapping feeds the existing pencil-owned guards; it does not add a
    // generic busy-block-vs-booking exclusion or alter ordinary booking pairs.
    expect(guard).not.toContain('FROM instructor_busy_blocks existing_busy');
  });
});
