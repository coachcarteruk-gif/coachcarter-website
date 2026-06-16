const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const asyncNeedle = `async function ${name}`;
  const syncNeedle = `function ${name}`;
  let start = source.indexOf(asyncNeedle);
  if (start < 0) start = source.indexOf(syncNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextSync = source.indexOf('\nfunction ', start + 1);
  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const candidates = [nextSync, nextAsync].filter(idx => idx > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test.describe('admin retrospective lesson entry', () => {
  test('admin API exposes a scoped past-lesson route with credit/cash choices', () => {
    const api = read('api/admin.js');
    const handler = functionBody(api, 'handleCreateRetrospectiveBooking');

    expect(api).toContain("if (action === 'create-retrospective-booking') return handleCreateRetrospectiveBooking(req, res);");
    expect(handler).toContain('verifyAdminJWT(req)');
    expect(handler).toContain('const schoolId = getAdminSchoolId(admin, req);');
    expect(handler).toContain("!['credit', 'cash'].includes(paymentMethod)");
    expect(handler).toContain("code: 'NOT_RETROSPECTIVE'");
    expect(handler).toContain('finishedAt.getTime() > Date.now()');
    expect(handler).toContain('lb.status = ANY(${BLOCKING_STATUSES}::text[])');
    expect(handler).toContain('${startTime}::time < lb.end_time');
    expect(handler).toContain('${endTime}::time > lb.start_time');
    expect(handler).toContain('status: CHARGEABLE');
    expect(handler).toContain("action: 'admin.create_retrospective_booking'");
  });

  test('credit retrospective lessons use LCB, FIFO BCS, and guarded decrement', () => {
    const api = read('api/admin.js');
    const tx = functionBody(api, 'createAdminRetrospectiveCreditBookingTransaction');

    expect(api).toContain("const { planFifoCreditDraw } = require('./_bcs-fifo');");
    expect(api).toContain("const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');");
    expect(tx).toContain('FROM learner_credit_balances');
    expect(tx).toContain('FOR UPDATE');
    expect(tx).toContain("code: 'INSUFFICIENT_BALANCE'");
    expect(tx).toContain('planFifoCreditDraw({');
    expect(tx).toContain('splitFifoPlanAcrossBookings({');
    expect(tx).toContain('INSERT INTO booking_credit_sources');
    expect(tx).toContain('ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING');
    expect(tx).toContain('SET list_price_pence = $1');
    expect(tx).toContain('SET balance_minutes = balance_minutes - $4');
    expect(tx).toContain('AND balance_minutes >= $4');
  });

  test('cash retrospective lessons do not deduct learner credit', () => {
    const api = read('api/admin.js');
    const handler = functionBody(api, 'handleCreateRetrospectiveBooking');
    const cashBranchStart = handler.indexOf("} else {\n      const inserted = await sql`");
    expect(cashBranchStart).toBeGreaterThanOrEqual(0);
    const cashBranch = handler.slice(cashBranchStart);

    expect(cashBranch).toContain("'admin', 'cash'");
    expect(cashBranch).toContain('${lessonTypeId}, ${transmissionType}, 0, ${schoolId}');
    expect(cashBranch).not.toContain('booking_credit_sources');
    expect(cashBranch).not.toContain('balance_minutes = balance_minutes -');
  });

  test('admin portal exposes and submits the past lesson modal', () => {
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(html).toContain('id="btn-open-retro-lesson"');
    expect(html).toContain('id="adminRetrospectiveLessonModal"');
    expect(html).toContain('id="adminRetroPayment"');
    expect(html).toContain('<option value="credit">Use learner credit</option>');
    expect(html).toContain('<option value="cash">Cash</option>');

    expect(js).toContain("bind('btn-open-retro-lesson', openAdminRetrospectiveLesson);");
    expect(js).toContain("fetchAdmin('/api/admin?action=create-retrospective-booking'");
    expect(js).toContain('payment_method: paymentMethod');
    expect(js).toContain("if (res.status === 402) msg += ' Choose cash if the lesson was paid outside learner credit.';");
    expect(js).toContain('populateAdminRetroLearnerAddress');
    expect(js).toContain('updateAdminRetroEnd');
  });

  test('admin can correct completed retrospective lesson details safely', () => {
    const api = read('api/admin.js');
    const handler = functionBody(api, 'handleEditBooking');
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(handler).toContain('if (![SCHEDULED, CHARGEABLE].includes(booking.status))');
    expect(handler).toContain("code: 'RETROSPECTIVE_EDIT_MUST_STAY_PAST'");
    expect(handler).not.toContain("code: 'COMPLETED_CREDIT_DURATION_LOCKED'");
    expect(handler).toContain("ledgerType: 'edit_adjustment'");
    expect(handler).toContain('const newListPricePence = oldMinutes > 0 && oldListPricePence != null');
    expect(handler).toContain('list_price_pence = ${newListPricePence}');
    expect(handler).toContain('booking.status === SCHEDULED && timeChanged');
    expect(handler).toContain('AND lb.school_id = ${schoolId}');
    expect(handler).toContain('pickup_address = ${newPickupAddress}');
    expect(handler).toContain('dropoff_address = ${newDropoffAddress}');
    expect(handler).toContain('instructor_notes = ${newNotes}');

    expect(js).toContain("if (b.status === 'chargeable')");
    expect(js).toContain('Edit lesson');
    expect(js).toContain("document.getElementById('adminEditPickup').value = b.pickup_address || '';");
    expect(js).toContain('Learner credit will be reduced by ');
    expect(js).toContain('minutes will be returned to learner credit.');
    expect(js).toContain("var errorMessage = data.message || (typeof data.error === 'string' ? data.error : '') || 'Failed to edit';");
    expect(js).toContain("pickup_address: document.getElementById('adminEditPickup').value.trim()");
    expect(js).toContain("dropoff_address: document.getElementById('adminEditDropoff').value.trim()");
    expect(js).toContain("notes: document.getElementById('adminEditNotes').value.trim()");
    expect(html).toContain('id="adminEditPickup"');
    expect(html).toContain('id="adminEditDropoff"');
    expect(html).toContain('id="adminEditNotes"');
  });
});
