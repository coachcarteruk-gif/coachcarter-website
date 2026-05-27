const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('learner instructor-aware credit purchase UI', () => {
  test('buy-credits page renders and loads an instructor selector', () => {
    const html = read('public/learner/buy-credits.html');
    const js = read('public/learner/buy-credits.js');

    expect(html).toContain('id="instructorSelect"');
    expect(html).toContain('Choose instructor');
    expect(js).toContain("fetch('/api/instructors?action=list')");
    expect(js).toContain("parseInt(params.get('instructor_id'), 10)");
    expect(js).toContain('opt.selected = Number(inst.id) === Number(currentInstructorId)');
  });

  test('buy-credits blocks checkout until an instructor is selected', () => {
    const js = read('public/learner/buy-credits.js');

    expect(js).toContain('function requireInstructorSelection()');
    expect(js).toContain("showToast('Choose an instructor before checkout.', 'error')");
    expect(js).toContain('if (!requireInstructorSelection()) return;');
    expect(js).toContain('checkoutBtn.disabled = !allowed');
    expect(js).toContain("document.querySelectorAll('.sl-buy-btn')");
  });

  test('buy-credits sends instructor_id for package and single-lesson checkout', () => {
    const js = read('public/learner/buy-credits.js');

    expect(js).toContain('var payload = { hours: qty, instructor_id: currentInstructorId };');
    expect(js).toContain('var payload = { hours: hours, instructor_id: currentInstructorId };');
    expect(js).not.toContain('var payload = { hours: qty };\n      if (currentInstructorId)');
    expect(js).not.toContain('var payload = { hours: hours };\n      if (currentInstructorId)');
  });

  test('buy-credits login redirect preserves instructor context', () => {
    const js = read('public/learner/buy-credits.js');

    expect(js).toContain('function buyCreditsPath()');
    expect(js).toContain("path += '?instructor_id=' + encodeURIComponent(currentInstructorId)");
    expect(js).toContain('var redirect = encodeURIComponent(buyCreditsPath())');
    expect(js).toContain('/learner/login.html?redirect=');
    expect(js).toContain("+ redirect +");
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

    expect(js).toContain('const hasCreds = selectedInstructorBalanceMinutes >= ltDuration;');
    expect(js).toContain('const hasCreds = selectedInstructorBalanceMinutes >= totalMins;');
    expect(js).toContain('const balance = selectedInstructorBalanceMinutes || 0;');
    expect(js).toContain('` with ${pendingSlot.instructor_name}`');
    expect(js).not.toContain('const hasCreds = balanceMinutes >= ltDuration;');
    expect(js).not.toContain('const hasCreds = balanceMinutes >= totalMins;');
  });

  test('booking modal buy-credit links pass selected slot instructor_id', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain('function buyCreditsUrlForSlot(slot)');
    expect(js).toContain('/learner/buy-credits.html?instructor_id=${encodeURIComponent(slot.instructor_id)}');
    expect(js).toContain('function updateModalBuyCreditLinks()');
    expect(js).toContain('updateModalBuyCreditLinks();');
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
