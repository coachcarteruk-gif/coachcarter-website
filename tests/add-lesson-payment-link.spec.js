// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function namedFunctionBody(source, name) {
  const asyncNeedle = `async function ${name}`;
  const syncNeedle = `function ${name}`;
  let start = source.indexOf(asyncNeedle);
  if (start < 0) start = source.indexOf(syncNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', start + 1);
  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const candidates = [next, nextAsync].filter((idx) => idx > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test.describe('instructor add lesson payment links', () => {
  test('calendar and dashboard modals expose Send payment link and helper copy', () => {
    const indexHtml = read('public/instructor/index.html');
    const dashboardHtml = read('public/instructor/dashboard.html');

    for (const html of [indexHtml, dashboardHtml]) {
      expect(html).toContain('value="payment_link"');
      expect(html).toContain('Send payment link');
      expect(html).toContain('Sends a payment link instead of booking now.');
      expect(html).toContain('pending offer for 24 hours');
      expect(html).toContain('booked only after the learner accepts and pays');
    }
  });

  test('selecting payment link changes the CTA in both instructor flows', () => {
    const indexJs = read('public/instructor/index.js');
    const dashboardJs = read('public/instructor/dashboard.js');

    expect(indexJs).toContain('function updateAddLessonPaymentUi()');
    expect(indexJs).toContain("payMethod === 'payment_link' ? 'Send payment link' : 'Book lesson'");
    expect(dashboardJs).toContain('function updateBookPaymentUi()');
    expect(dashboardJs).toContain("payMethod === 'payment_link' ? 'Send payment link' : 'Book lesson'");
  });

  test('calendar payment-link branch posts minimal existing-learner offer payload', () => {
    const body = functionBody(read('public/instructor/index.js'), 'confirmCreateBooking');
    const offerBranch = sliceBetween(body, "if (isPaymentLink) {", "const res = await ccAuth.fetchAuthed('/api/instructor?action=create-booking'");

    expect(offerBranch).toContain("ccAuth.fetchAuthed('/api/instructor?action=create-offer'");
    expect(offerBranch).toContain('learner_id: selectedLearnerId');
    expect(offerBranch).toContain('scheduled_date: newDate');
    expect(offerBranch).toContain('start_time: newTime.slice(0, 5)');
    expect(offerBranch).toContain("lesson_type_id: parseInt(document.getElementById('addLessonType').value) || null");
    expect(offerBranch).not.toContain('payment_method');
    expect(offerBranch).not.toContain('notes');
    expect(offerBranch).not.toContain('dropoff_address');
    expect(offerBranch).not.toContain('offer_price_pence');
    expect(offerBranch).not.toContain('end_time');
  });

  test('dashboard payment-link branch posts minimal existing-learner offer payload', () => {
    const body = functionBody(read('public/instructor/dashboard.js'), 'confirmBook');
    const offerBranch = sliceBetween(body, "if (isPaymentLink) {", 'var body = {');

    expect(offerBranch).toContain("ccAuth.fetchAuthed('/api/instructor?action=create-offer'");
    expect(offerBranch).toContain('learner_id: selectedLearnerId');
    expect(offerBranch).toContain('scheduled_date: date');
    expect(offerBranch).toContain('start_time: time.slice(0,5)');
    expect(offerBranch).toContain("lesson_type_id: parseInt(document.getElementById('bookType').value)");
    expect(offerBranch).not.toContain('payment_method');
    expect(offerBranch).not.toContain('notes');
    expect(offerBranch).not.toContain('dropoff_address');
    expect(offerBranch).not.toContain('offer_price_pence');
    expect(offerBranch).not.toContain('end_time');
  });

  test('cash, credit, and free still use the existing create-booking payloads', () => {
    const indexBody = functionBody(read('public/instructor/index.js'), 'confirmCreateBooking');
    const dashboardBody = functionBody(read('public/instructor/dashboard.js'), 'confirmBook');

    expect(indexBody).toContain("ccAuth.fetchAuthed('/api/instructor?action=create-booking'");
    expect(indexBody).toContain('payment_method: payMethod');
    expect(indexBody).toContain('notes: notes || null');
    expect(indexBody).toContain("dropoff_address: document.getElementById('addLessonDropoff').value.trim() || null");
    expect(dashboardBody).toContain("ccAuth.fetchAuthed('/api/instructor?action=create-booking'");
    expect(dashboardBody).toContain('payment_method: payMethod');
    expect(dashboardBody).toContain("notes: document.getElementById('bookNotes').value.trim() || null");
    expect(dashboardBody).toContain("dropoff_address: document.getElementById('bookDropoff').value.trim() || null");
  });

  test('create-booking sends the instructor a text confirmation after booking', () => {
    const body = functionBody(read('api/instructor.js'), 'handleCreateBooking').replace(/\r\n/g, '\n');

    expect(body).toContain('SELECT id, name, email, phone FROM instructors');
    expect(body).toContain('await sendWhatsApp(\n      instrDetails.phone');
    expect(body).toContain('Learner: ${learner.name}');
    expect(body).toContain('View schedule: https://coachcarter.uk/instructor/');
    expect(body).toContain("purpose: 'instructor.booking_created'");
    expect(body).toContain('learnerId: learner.id');
    expect(body).toContain('instructorId: instructor.id');
    expect(body).toContain('schoolId');
  });

  test('payment-link success keeps copy fallback and delivery state visible', () => {
    const indexJs = read('public/instructor/index.js');
    const dashboardJs = read('public/instructor/dashboard.js');

    for (const js of [indexJs, dashboardJs]) {
      expect(js).toContain('email_available === true');
      expect(js).toContain('message_available === true');
      expect(js).toContain("deliveryParts.push('email')");
      expect(js).toContain("deliveryParts.push('text message')");
      expect(js).toContain('delivery did not complete');
      expect(js).toContain('Copy link');
      expect(js).toContain('pending offer for 24 hours');
      expect(js).not.toContain('Payment link booked');
    }
  });

  test('calendar stale payment-link success is cleared when learner changes', () => {
    const js = read('public/instructor/index.js');
    const helper = namedFunctionBody(js, 'clearPaymentLinkSuccess');
    const selectBody = namedFunctionBody(js, 'selectLearner');
    const clearBody = namedFunctionBody(js, 'clearSelectedLearner');

    expect(helper).toContain("document.getElementById('addLessonOfferSuccess')");
    expect(helper).toContain("successEl.style.display = 'none'");
    expect(helper).toContain("successEl.innerHTML = ''");
    expect(selectBody).toMatch(/function selectLearner[\s\S]*clearPaymentLinkSuccess\(\);[\s\S]*selectedLearnerId = id/);
    expect(clearBody).toMatch(/function clearSelectedLearner[\s\S]*clearPaymentLinkSuccess\(\);[\s\S]*selectedLearnerId = null/);
  });

  test('calendar stale payment-link success is cleared when slot-defining fields change', () => {
    const js = read('public/instructor/index.js').replace(/\r\n/g, '\n');

    expect(js).toContain("['addLessonDate', 'addLessonTime', 'addLessonType'].forEach(function (id) {");
    expect(js).toContain("if (field) field.addEventListener('change', clearPaymentLinkSuccess);");
    expect(js).toContain("if (e.target.name === 'addLessonPay') {\n    clearPaymentLinkSuccess();\n    updateAddLessonPaymentUi();");
    expect(namedFunctionBody(js, 'openAddLessonModal')).toContain('clearPaymentLinkSuccess();');
    expect(namedFunctionBody(js, 'closeAddLessonModal')).toContain('clearPaymentLinkSuccess();');
  });

  test('dashboard stale payment-link success is cleared when learner or slot-defining fields change', () => {
    const js = read('public/instructor/dashboard.js');
    const helper = namedFunctionBody(js, 'clearPaymentLinkSuccess');
    const selectBody = namedFunctionBody(js, 'selectLearner');
    const clearBody = namedFunctionBody(js, 'clearLearner');

    expect(helper).toContain("document.getElementById('bookOfferSuccess')");
    expect(helper).toContain("successEl.style.display = 'none'");
    expect(helper).toContain("successEl.innerHTML = ''");
    expect(selectBody).toMatch(/function selectLearner[\s\S]*clearPaymentLinkSuccess\(\);[\s\S]*selectedLearnerId = id/);
    expect(clearBody).toMatch(/function clearLearner[\s\S]*clearPaymentLinkSuccess\(\);[\s\S]*selectedLearnerId = null/);
    expect(js).toContain("['bookDate', 'bookTime', 'bookType'].forEach(function (id) {");
    expect(js).toContain("if (field) field.addEventListener('change', clearPaymentLinkSuccess);");
  });

  test('dashboard payment method change clears stale success before refreshing payment UI', () => {
    const js = read('public/instructor/dashboard.js').replace(/\r\n/g, '\n');

    expect(js).toContain("radio.addEventListener('change', function () {\n      clearPaymentLinkSuccess();\n      updateBookPaymentUi();");
    expect(namedFunctionBody(js, 'openBookModal')).toContain('clearPaymentLinkSuccess();');
    expect(namedFunctionBody(js, 'closeBookModal')).toContain('clearPaymentLinkSuccess();');
  });

  test('create-offer remains canonical and guards instructor lesson-type offering', () => {
    const api = read('api/instructor.js');
    const body = functionBody(api, 'handleCreateOffer');

    expect(api).toContain("const { isLessonTypeOffered } = require('./_lesson-type-helpers');");
    expect(body).toContain('SELECT id, name, email, phone, offered_lesson_types FROM instructors');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('if (!isLessonTypeOffered(instrDetails.offered_lesson_types, lessonType.slug))');
    expect(body).toContain("return res.status(400).json({ error: 'This instructor does not offer that lesson type' })");
    expect(body).toContain('INSERT INTO lesson_offers');
    expect(body).not.toContain('INSERT INTO lesson_bookings');
    expect(body).toContain('calcOfferLessonPrice(sql, {');
  });
});
