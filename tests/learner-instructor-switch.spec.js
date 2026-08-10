const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

test.describe('learner instructor switching', () => {
  test('reschedule UI submits the selected slot instructor and explains the transfer', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(js).toContain('new_instructor_id: newSlot.instructor_id');
    expect(js).toContain('No extra charge. Your paid lesson will move to');
    expect(js).toContain('who will receive it in their payout after delivery.');
    expect(js).toContain('instructorFilter.disabled = !!isReservedMove');
    expect(html).toContain('Choose an instructor and an available slot below.');
  });

  test('confirmation rechecks the selected instructor server-side', () => {
    const slots = read('api/slots.js');
    const reschedule = section(
      slots,
      'async function handleReschedule(req, res) {',
      '// ── GET /api/slots?action=my-bookings'
    );

    expect(reschedule).toContain('const targetInstructorId = requestedInstructorId || Number(booking.instructor_id)');
    expect(reschedule).toContain('WHERE instructor_id = ${targetInstructorId}');
    expect(reschedule).toContain('instructorId: targetInstructorId, schoolId, fromDate: new_date, toDate: new_date');
    expect(reschedule).toContain('start_time < ${new_end_time}::time');
    expect(reschedule).toContain('end_time > ${new_start_time}::time');
    expect(reschedule).toContain('instructorId: targetInstructorId,');
    expect(reschedule).toContain('slotFitsActiveAvailability(sql, {');
    expect(reschedule).toContain('rejectIfPickupTravelConflict(res, sql, {');
    expect(reschedule).toContain("AND active = TRUE");
    expect(reschedule).toContain('!isLessonTypeOffered(replacementInstructor.offered_lesson_types, booking.lesson_type_slug)');
  });

  test('funding transfer writes balanced instructor-scoped ledger rows and replacement BCS', async () => {
    const { transferBookingFunding } = require('../api/_instructor-switch-transfer');
    const calls = [];
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes('FROM booking_credit_sources bcs')) {
          return {
            rowCount: 1,
            rows: [{
              booking_credit_source_id: 44,
              credit_transaction_id: 55,
              origin_credit_transaction_id: 55,
              minutes_drawn: 90,
              rate_pence_per_minute: 61,
              contribution_pence: 5490,
              stripe_fee_pence: 103,
              absorbed_by: null,
            }],
          };
        }
        if (text.includes("'instructor_transfer_in'")) return { rowCount: 1, rows: [{ id: 66 }] };
        return { rowCount: 1, rows: [] };
      },
    };

    const result = await transferBookingFunding(client, {
      oldBookingId: 10,
      newBookingId: 11,
      learnerId: 12,
      oldInstructorId: 4,
      newInstructorId: 6,
      schoolId: 1,
    });

    expect(result.transferredRows).toBe(1);
    expect(result.transferredMinutes).toBe(90);
    expect(result.transferGroupId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1].text).toContain("'instructor_transfer_out'");
    expect(calls[1].values[3]).toBe(-90);
    expect(calls[2].text).toContain("'instructor_transfer_in'");
    expect(calls[2].values[3]).toBe(90);
    expect(calls[4].text).toContain('INSERT INTO booking_credit_sources');
    expect(calls[4].values.slice(0, 4)).toEqual([1, 11, 66, 90]);
  });

  test('schema and payout preview preserve the immutable source but pay the delivering instructor', () => {
    const migration = read('db/migrations/042_instructor_switch_transfers.sql');
    const payoutShadow = read('api/_payout-v2-shadow.js');

    expect(migration).toContain("'instructor_transfer_out', 'instructor_transfer_in'");
    expect(migration).toContain('transferred_from_credit_transaction_id');
    expect(migration).toContain('instructor_transfer_group_id');
    expect(payoutShadow).toContain('COALESCE(transferred_from_ct.id, bcs.credit_transaction_id)');
    expect(payoutShadow).toContain("row.credit_transaction_type === 'instructor_transfer_in'");
    expect(payoutShadow).toContain('? Number(row.booking_instructor_id)');
  });
});
