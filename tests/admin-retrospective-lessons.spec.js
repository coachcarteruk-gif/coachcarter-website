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
});
