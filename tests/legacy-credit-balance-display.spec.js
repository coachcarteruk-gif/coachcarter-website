const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test.describe('legacy credit_balance display deprecation', () => {
  test('admin learner list displays minute-derived hours', () => {
    const portalHtml = read('public/admin/portal.html');
    const portalJs = read('public/admin/portal.js');

    expect(portalHtml).toContain('<th>Balance</th><th>Delivered</th><th>Bookings</th>');
    expect(portalJs).toContain("fmtBalanceMins(l.balance_minutes || 0)");
    expect(portalJs).toContain("fmtBalanceMins(l.delivered_minutes || 0)");
    expect(portalJs).not.toContain("'<td>' + (l.credit_balance || 0) + '</td>'");
  });

  test('instructor learner pickers use balance_minutes, not legacy credit_balance', () => {
    const indexJs = read('public/instructor/index.js');
    const dashboardJs = read('public/instructor/dashboard.js');
    const sharedActionsJs = read('public/shared/instructor-booking-actions.js');

    for (const source of [indexJs, dashboardJs, sharedActionsJs]) {
      expect(source).toContain('data-balance-minutes');
      expect(source).toContain('formatBalanceMins');
      expect(source).not.toContain('data-credits');
      expect(source).not.toContain('data-balance="' + ' + (l.credit_balance || 0)');
      expect(source).not.toContain('updateCreditNote(learner.credit_balance || 0)');
    }
  });

  test('instructor booking helper labels scoped instructor balances', () => {
    const indexJs = read('public/instructor/index.js');
    const dashboardJs = read('public/instructor/dashboard.js');
    const sharedActionsJs = read('public/shared/instructor-booking-actions.js');
    const instructorApi = read('api/instructor.js');

    expect(indexJs).toContain('with you');
    expect(indexJs).not.toContain('Learner has ${formatBalanceMins(balanceMinutes)} remaining.');
    expect(dashboardJs).toContain("' with you.'");
    expect(sharedActionsJs).toContain('with this instructor');
    expect(sharedActionsJs).toContain('Hours with this instructor: ');
    expect(instructorApi).toContain('COALESCE(lcb.balance_minutes, 0)::int AS balance_minutes');
    expect(instructorApi).toContain('LEFT JOIN learner_credit_balances lcb');
    expect(instructorApi).toContain('AND lcb.instructor_id = ${instructor.id}');
    expect(instructorApi).toContain('AND lcb.school_id = ${schoolId}');
  });

  test('instructor booking confirmation messages use minute-derived balance', () => {
    const instructorApi = read('api/instructor.js');

    expect(instructorApi).toContain('balance_minutes: updated.balance_minutes || 0');
    expect(instructorApi).toContain('balance_hours: ((updated.balance_minutes || 0) / 60).toFixed(1)');
    expect(instructorApi).toContain('`${durationStr} deducted. ${balanceStr} remaining.');
    expect(instructorApi).not.toContain('1 lesson deducted. ${updated.credit_balance} remaining.');
  });
});
