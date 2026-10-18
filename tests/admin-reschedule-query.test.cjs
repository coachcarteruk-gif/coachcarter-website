const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

// Execute the real loader SQL in PostgreSQL, without importing API transports.
const source = fs.readFileSync(path.join(__dirname, '../api/admin.js'), 'utf8');
const start = source.indexOf('async function loadAdminRescheduleBooking(');
const end = source.indexOf('\nasync function handleAdminRescheduleOptions', start);
assert.ok(start >= 0 && end > start);
const loadBooking = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test('admin reschedule loader parses and distinguishes reserved and Flexible bookings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE schools (id int, config jsonb);
      CREATE TABLE learner_users (id int, school_id int, name text, email text, phone text, pickup_address text);
      CREATE TABLE instructors (id int, school_id int, name text, email text, phone text);
      CREATE TABLE lesson_types (id int, school_id int, name text, slug text, duration_minutes int);
      CREATE TABLE lesson_bookings (
        id int, status text, learner_id int, instructor_id int, school_id int,
        scheduled_date date, start_time time, end_time time, reschedule_count int,
        lesson_type_id int, minutes_deducted int, pickup_address text, dropoff_address text,
        created_by text, payment_method text, stripe_fee_pence int, stripe_fee_source text,
        list_price_pence int, list_price_source text, transmission_type text,
        social_video_consent boolean, social_video_age_confirmed boolean, social_video_discount_pct int
      );
      CREATE TABLE recurring_slot_blocks (id int, school_id int, instructor_id int, learner_id int, status text);
      CREATE TABLE recurring_slot_block_items (block_id int, lesson_booking_id int, school_id int, instructor_id int, status text);
      CREATE TABLE flexible_package_booking_allocations (id int, booking_id int, learner_id int, school_id int);
      CREATE TABLE flexible_package_allocation_returns (allocation_id int);
      INSERT INTO schools VALUES (1, '{}');
      INSERT INTO learner_users VALUES (2, 1, 'Learner', 'learner@example.test', NULL, 'Pickup');
      INSERT INTO instructors VALUES (3, 1, 'Instructor', 'instructor@example.test', NULL);
      INSERT INTO lesson_types VALUES (4, 1, 'Lesson', '90min', 90);
      INSERT INTO lesson_bookings (id, school_id, learner_id, instructor_id, lesson_type_id,
        status, scheduled_date, start_time, end_time, payment_method)
      SELECT id, 1, 2, 3, 4, 'scheduled', '2026-11-01', '09:00', '10:30',
        CASE WHEN id = 2 THEN 'flexible_package' ELSE 'credit' END
        FROM generate_series(1, 7) id;
      INSERT INTO recurring_slot_blocks VALUES (10, 1, 3, 2, 'confirmed'), (11, 2, 3, 2, 'confirmed');
      INSERT INTO recurring_slot_block_items VALUES (10, 5, 1, 3, 'booked'), (11, 6, 2, 3, 'booked');
      INSERT INTO flexible_package_booking_allocations VALUES (20, 3, 2, 1), (21, 4, 2, 1), (22, 7, 2, 2);
      INSERT INTO flexible_package_allocation_returns VALUES (21);
    `);
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
      return (await db.query(query, values)).rows;
    };
    for (const [id, reserved, flexible] of [
      [1, false, false], // ordinary credit
      [2, false, true], // Flexible payment method is not a reserved slot
      [3, false, true], // active Flexible allocation
      [4, false, false], // returned allocation
      [5, true, false], // confirmed reserved slot
      [6, false, false], // another school's reserved slot
      [7, false, false], // another school's allocation
    ]) {
      const row = await loadBooking(sql, { bookingId: id, schoolId: 1 });
      assert.equal(row.is_reserved_weekly_slot, reserved, `booking ${id}: reserved`);
      assert.equal(row.is_flexible_package_booking, flexible, `booking ${id}: Flexible`);
      assert.equal(row.duration_minutes, 90);
      assert.equal(row.pickup_address, 'Pickup');
    }
    assert.equal(await loadBooking(sql, { bookingId: 1, schoolId: 2 }), null);
    assert.equal(await loadBooking(sql, { bookingId: 999, schoolId: 1 }), null);
  } finally {
    await db.close();
  }
});
