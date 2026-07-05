const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('learner read-only Lesson Credit UI', () => {
  test('legacy buy-credits route renders as an existing Lesson Credit balance page', () => {
    const html = read('public/learner/buy-credits.html');
    const js = read('public/learner/buy-credits.js');

    expect(html).toContain('id="instructorSelect"');
    expect(html).toContain('id="creditsTitle"');
    expect(html).toContain('id="pricingRateValue"');
    expect(html).toContain('id="packagesNote"');
    expect(html).toContain('#btnCheckout');
    expect(html).toContain('display: none !important;');
    expect(js).toContain('function renderRetiredPageShell()');
    expect(js).toContain('Existing Lesson Credit is still available');
    expect(js).toContain('New self-serve top-ups are retired');
    expect(js).toContain("fetch('/api/instructors?action=list')");
    expect(js).toContain("parseInt(params.get('instructor_id'), 10)");
  });

  test('Lesson Credit page fetches aggregate and selected-instructor balances only', () => {
    const js = read('public/learner/buy-credits.js');

    expect(js).toContain("var url = '/api/credits?action=balance';");
    expect(js).toContain("url += '&instructor_id=' + encodeURIComponent(currentInstructorId)");
    expect(js).toContain('data.selected_instructor_balance_minutes');
    expect(js).toContain('data.balance_minutes || 0');
    expect(js).toContain("document.getElementById('creditBalanceRows') || document.getElementById('packages')");
    expect(js).not.toContain('/api/credits?action=checkout');
    expect(js).not.toContain('/api/lesson-types?action=list');
    expect(js).not.toContain('checkoutBusy');
  });

  test('learner navigation no longer exposes a Buy Credits entry point', () => {
    const sidebar = read('public/sidebar.js');
    const dashboard = read('public/learner/index.html');
    const bookHtml = read('public/learner/book.html');
    const bookJs = read('public/learner/book.js');

    expect(sidebar).not.toContain("label: 'Buy Credits'");
    expect(dashboard).toContain('<a href="/learner/profile.html" class="stat-cell" id="stat-balance">');
    expect(bookHtml).not.toContain('href="/learner/buy-credits.html"');
    expect(bookHtml).toContain('You can still pay when you book.');
    expect(bookJs).not.toContain('buyCreditsUrlForSlot');
    expect(bookJs).not.toContain('/learner/buy-credits.html?instructor_id=');
  });
});

test.describe('learner booking modal instructor-aware credit balance', () => {
  test('booking modal loads selected slot instructor balance', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain('let selectedInstructorBalanceMinutes = 0;');
    expect(js).toContain('async function loadSelectedInstructorBalance(slot)');
    expect(js).toContain('/api/credits?action=balance&instructor_id=${encodeURIComponent(slot.instructor_id)}');
    expect(js).toContain('const selectedBalancePromise = isGuest ? Promise.resolve() : loadSelectedInstructorBalance(slot);');
    expect(js).toContain('await selectedBalancePromise;');
  });

  test('booking modal uses selected instructor balance for credit eligibility and copy', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain('const hasCreds = selectedInstructorBalanceMinutes >= chargeMins;');
    expect(js).toContain('const hasCreds = selectedInstructorBalanceMinutes >= totalMins;');
    expect(js).toContain('const balance = selectedInstructorBalanceMinutes || 0;');
    expect(js).toContain('` with ${pendingSlot.instructor_name}`');
    expect(js).not.toContain('const hasCreds = balanceMinutes >= ltDuration;');
    expect(js).not.toContain('const hasCreds = balanceMinutes >= totalMins;');
  });

  test('booking modal does not link to retired buy-credit journeys', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(html).not.toContain('href="/learner/buy-credits.html"');
    expect(html).toContain('Existing Lesson Credit remains available for eligible bookings.');
    expect(html).toContain('Eligible 48+ hour cancellations return as Lesson Credit.');
    expect(js).not.toContain('function buyCreditsUrlForSlot');
    expect(js).not.toContain('function updateModalBuyCreditLinks');
  });

  test('booking success wires Reserved Weekly Slot preview after single bookings only', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(html).toContain('id="reservedWeeklySuccessPrompt"');
    expect(html).toContain('id="reservedWeeklyPaidPrompt"');
    expect(html).toContain('id="btnOpenRecurringFromSuccess"');
    expect(html).toContain('id="recurringBlockModal"');
    expect(html).toContain('Preview weekly options');
    expect(html).toContain('Same instructor, same day, same time');
    expect(html).toContain('Unavailable weeks are skipped');
    expect(html).toContain('Choose 4-12 future weekly lessons');
    expect(html).toContain('body.cc-paid-return .reserved-weekly-prompt.compact');
    expect(js).toContain("document.body.classList.add('cc-paid-return')");
    expect(js).toContain("document.getElementById('reservedWeeklyPaidPrompt')");
    expect(js).toContain("document.getElementById('reservedWeeklySuccessPrompt')");
    expect(js).toContain("reservedWeeklyPrompt.style.display = weeks && weeks > 1 ? 'none' : 'block';");
    expect(js).toContain('recurringAnchorBookingId = isSingleBooking ? lastBookingId : null;');
    expect(js).toContain("window.location.href = auth ? '/learner/lessons.html' : '/learner/login.html';");
  });

  test('booking UI calls recurring block preview then routes to credit commit or bank checkout', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(js).toContain('/api/slots?action=recurring-block-preview');
    expect(js).toContain('/api/slots?action=recurring-block-commit');
    expect(js).toContain('/api/slots?action=recurring-block-bank-checkout');
    expect(js).toContain('anchor_booking_id: recurringAnchorBookingId');
    expect(js).toContain('lessons: recurringLessonCount');
    expect(js).toContain("if (data.code === 'SLOTS_UNAVAILABLE')");
    expect(js).toContain("if (data.code === 'INSUFFICIENT_CREDIT')");
    expect(js).toContain("if (data.code === 'LESSON_CREDIT_AVAILABLE')");
    expect(js).toContain('Pay upfront by bank');
    expect(html).toContain('Confirm with Lesson Credit');
    expect(js).not.toContain('The bank-payment hold option is coming later');
    expect(js).not.toContain('Klarna');
  });

  test('recurring block action requires server commit flag and chooses funding path from credit sufficiency', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain('const hasEnoughCredit = !!credit.has_sufficient_credit;');
    expect(js).toContain('const canCreditCommit = !!(recurringPreview.can_commit && recurringPreview.credit && recurringPreview.credit.has_sufficient_credit && auth);');
    expect(js).toContain('const canBankCheckout = !!(recurringPreview.can_commit && recurringPreview.credit && !recurringPreview.credit.has_sufficient_credit && auth);');
    expect(js).toContain("recurringConfirmMode = canCreditCommit ? 'credit' : (canBankCheckout ? 'bank' : 'credit');");
    expect(js).toContain("document.getElementById('btnConfirmRecurringBlock').disabled = !(canCreditCommit || canBankCheckout) || recurringCommitBusy;");
    expect(js).toContain('selectedInstructorBalanceMinutes = data.balance_minutes || 0;');
    expect(js).toContain('loadCreditBalance();');
  });

  test('booking modal excludes trial durations but keeps the guest free-trial CTA link', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(js).toContain(".filter(d => d && d.slug !== 'trial')");
    expect(js).toContain("hasFreeTrialSlot = lessonTypes.some(lt => lt && lt.slug === 'trial')");
    expect(js).toContain("claimCta.style.display = 'block'");
    expect(js).toContain("params.set('instructor_id', pendingSlot.instructor_id)");
    expect(js).toContain("params.set('date', pendingSlot.date)");
    expect(js).toContain("window.location.href = '/free-trial.html'");
    expect(html).toContain('id="claimTrialCta"');
    expect(html).toContain('id="claimTrialLink"');
  });

  test('paid booking server paths reject the free-trial lesson type', () => {
    const js = read('api/slots.js');

    expect(js).toContain('function rejectFreeTrialOnPaidPath(res)');
    expect(js).toContain('Use the free trial page to book a trial.');
    expect(js).toContain('if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);');
    expect(js).toContain("AND slug != 'trial'");
  });
});

test.describe('learner aggregate-safe balance displays', () => {
  test('dashboard loads live aggregate balance and labels it across instructors', () => {
    const html = read('public/learner/index.html');
    const js = read('public/learner/index.js');
    const glue = read('public/learner/index-page.js');

    expect(html).toContain('<div class="stat-cell-label">Total hours</div>');
    expect(html).toContain('<div class="stat-cell-sub" id="stat-balance-sub">across instructors</div>');
    expect(js).toContain("ccAuth.fetchAuthed('/api/credits?action=balance')");
    expect(js).toContain('BALANCE_DATA?.balance_minutes ?? AUTH?.user?.balance_minutes');
    expect(js).toContain('total credit across instructors');
    expect(glue).toContain("balSub.textContent = 'across instructors';");
  });

  test('profile fetches balance API and renders per-instructor rows', () => {
    const html = read('public/learner/profile.html');
    const js = read('public/learner/profile.js');

    expect(html).toContain('Lesson credit balances');
    expect(html).toContain('Total across instructors');
    expect(html).toContain('id="creditBalanceRows"');
    expect(js).toContain("ccAuth.fetchAuthed('/api/credits?action=balance')");
    expect(js).toContain('const rows = (BALANCE_DATA.balances || []).filter');
    expect(js).toContain("escapeHtml(row.instructor_name || 'Instructor')");
    expect(js).toContain("'<span class=\"credit-balance-hours\">' + hours + ' hr'");
    expect(js).toContain('No lesson credits yet');
  });

  test('sidebar balance copy is aggregate-safe', () => {
    const js = read('public/sidebar.js');

    expect(js).toContain("' total credit'");
    expect(js).toContain("' hrs total credit'");
    expect(js).not.toContain("' remaining'");
    expect(js).not.toContain("' hrs remaining'");
  });
});

test.describe('learner test date reminders', () => {
  test('sidebar shows an authenticated weeks-until-test counter', () => {
    const js = read('public/sidebar.js');

    expect(js).toContain('id="cc-sb-test-weeks"');
    expect(js).toContain('formatTestWeeksCopy');
    expect(js).toContain("window.ccAuth.fetchAuthed('/api/learner?action=progress')");
    expect(js).toContain('updateLearnerTestWeeks(data.test_date)');
    expect(js).toContain('>Weeks</span>');
  });

  test('booking date grid marks the learner test date inside the booking window', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');

    expect(js).toContain('function learnerTestDateString()');
    expect(js).toContain('function isLearnerTestDate(dateStr)');
    expect(js).toContain('date-cell-test-badge');
    expect(js).toContain('your driving test date');
    expect(js).toContain('selected-date-test-note');
    expect(html).toContain('.date-cell-test');
    expect(html).toContain('.selected-date-test-note');
  });
});
