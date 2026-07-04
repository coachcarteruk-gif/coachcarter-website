const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
const visibleText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

test.describe('learner practice and log-session flow copy', () => {
  test('practice hub has one primary Start a drive CTA and keeps secondary routes separate', () => {
    const html = read('public/learner/practice.html');

    expect(html).toContain('hub-card primary start');
    expect(html).toContain('Start a drive');
    expect(html).toContain('Take a mock test');
    expect(html).toContain('View my driving plan');

    expect(html.indexOf('Start a drive')).toBeLessThan(html.indexOf('Take a mock test'));
    expect(visibleText(html)).not.toContain('Log a drive');
    expect(visibleText(html)).not.toContain('Practice with a supervisor');
    expect(html).not.toContain('>LOG<');
    expect(html).not.toContain('>MOCK<');
    expect(html).not.toContain('>FCS<');
    expect(html).not.toContain('>TRK<');
    expect(html).not.toContain('Competency scores');
    expect(html).not.toContain('readiness');
  });

  test('log session defaults to traffic-light reflection and hides formal marks', () => {
    const html = read('public/learner/log-session.html');
    const source = read('public/learner/log-session.js');

    expect(source).toContain("let currentType = 'private';");
    expect(html).toContain('<button class="type-btn selected" id="btn-private">Private practice</button>');
    expect(html).toContain('Needs work');
    expect(html).toContain('Getting there');
    expect(html).toContain('Confident');
    expect(html).toContain('.fault-row {\n      display: none;');
    expect(html).toContain('id="advanced-instructor-panel" hidden');
    expect(html).toContain('Advanced instructor notes');
    expect(html).not.toContain('Optional fault counters');
    expect(source).toContain('function shouldUseFormalMarks()');
    expect(source).toContain("return currentType === 'instructor' && advancedMarksOpen;");
    expect(source).toContain("const f = shouldUseFormalMarks() ? (faults[skill_key] || { driving: 0, serious: 0, dangerous: 0 }) : { driving: 0, serious: 0, dangerous: 0 };");
  });

  test('successful save explains that the driving plan changed', () => {
    const html = read('public/learner/log-session.html');

    expect(html).toContain('Saved. Your driving plan has been updated.');
    expect(html).toContain('href="/learner/progress.html"');
    expect(html).toContain('View my driving plan');
  });

  test('sidebar Practice submenu exposes Start a drive as the unified drive route', () => {
    const source = read('public/sidebar.js');
    const practiceSection = source.slice(source.indexOf("{ icon: 'clipboard', label: 'Practice'"), source.indexOf("{ icon: 'play', label: 'Learn'"));

    expect(practiceSection).toContain("label: 'Start a drive', href: '/learner/focused-practice.html'");
    expect(practiceSection).toContain("label: 'Mock Test'");
    expect(practiceSection).toContain("label: 'My driving plan'");
    expect(practiceSection).not.toContain("label: 'Log a drive'");
    expect(practiceSection).not.toContain("label: 'Practice Drive'");
  });

  test('focused-practice route is framed as Start a drive with booked lesson setup', () => {
    const html = read('public/learner/focused-practice.html');
    const source = read('public/learner/focused-practice.js');

    expect(html).toContain('<title>Start a Drive | Coach Carter</title>');
    expect(html).toContain('Start a drive');
    expect(html).toContain('<h1><em>Start</em> a drive.</h1>');
    expect(html).toContain('What are you starting?');
    expect(html).toContain('Start drive');
    expect(html).toContain('View my driving plan');

    expect(source).toContain("ccAuth.fetchAuthed('/api/slots?action=' + action)");
    expect(source).toContain("slotsCall('my-bookings')");
    expect(source).toContain('function isRelevantDriveBooking(booking)');
    expect(source).toContain('Normal drive');
    expect(source).toContain("data-action=\"select-drive-booking\"");
    expect(source).toContain("payload.booking_id = selectedDrive.booking.id;");
    expect(source).toContain("var scoreText = score > 0 ? 'Suggested' : 'Pick';");
    expect(source).toContain("selectedDrive.kind === 'booking'");
    expect(source).toContain("apiCall('POST', 'focused-practice'");
    expect(source).not.toContain('take a mock test');
    expect(html).not.toContain('Targeted drill');
    expect(html).not.toContain('weakest areas');
  });

  test('focused-practice reflection uses simple supervisor labels and prompts', () => {
    const source = read('public/learner/focused-practice.js');

    expect(source).toContain("{ key: 'nailed', label: 'Went well' }");
    expect(source).toContain("{ key: 'ok', label: 'Needs practice' }");
    expect(source).toContain("{ key: 'struggled', label: 'Ask instructor' }");
    expect(source).toContain('What happened? (optional)');
    expect(source).toContain('Where? (optional)');
    expect(source).toContain('What should your instructor know? (optional)');
    expect(source).toContain('Ask your instructor about');
    expect(source).toContain('buildPracticeNote(reflections[catKey])');
  });

  test('focused-practice POST accepts optional booking_id with learner and school validation only', () => {
    const source = read('api/learner.js');
    const body = source.slice(source.indexOf('async function handleFocusedPractice'), source.indexOf('// ── Quiz Results'));

    expect(body).toContain('booking_id, session_date, session_type, notes');
    expect(body).toContain('lb.learner_id = ${user.id}');
    expect(body).toContain('COALESCE(lb.school_id, 1) = ${schoolId}');
    expect(body).toContain('lb.status IN (${SCHEDULED}, ${CHARGEABLE})');
    expect(body).toContain('WHERE booking_id = ${bookingId}');
    expect(body).toContain('INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, booking_id, school_id)');
    expect(body).not.toContain('UPDATE lesson_bookings');
    expect(body).not.toContain('credit_returned');
    expect(body).not.toContain('refund');
    expect(body).not.toContain('payout');
  });

  test('focused-practice booking save does not alter booking payment or lifecycle state', () => {
    const source = read('api/learner.js');
    const body = source.slice(source.indexOf('async function handleFocusedPractice'), source.indexOf('// ── Quiz Results'));

    expect(body).toContain('driving_sessions');
    expect(body).toContain('focused_practice_sessions');
    expect(body).toContain('skill_ratings');
    expect(body).not.toContain('lesson_bookings SET');
    expect(body).not.toContain('booking_credit_sources');
    expect(body).not.toContain('refund_events');
    expect(body).not.toContain('payout');
  });

  test('focused-practice visible copy avoids formal assessment terms', () => {
    const copy = visibleText(read('public/learner/focused-practice.html')).toLowerCase();

    ['mock test', 'dl25', 'fault', 'serious', 'dangerous', 'readiness', 'competency'].forEach((term) => {
      expect(copy).not.toContain(term);
    });
  });

  test('mock-test route stays clearly formal rather than ordinary supervisor practice', () => {
    const html = read('public/learner/mock-test.html');
    const source = read('public/learner/mock-test.js');

    expect(html).toContain('<title>Formal Mock Assessment | Coach Carter</title>');
    expect(html).toContain('Formal mock setup');
    expect(html).toContain('Best with your instructor. Use this for a full test-style assessment.');
    expect(html).toContain('For ordinary private practice, use Start a drive from the practice hub.');
    expect(html).toContain('My instructor is running this');
    expect(html).toContain('Primary formal mock assessment');
    expect(html).toContain('Supervisor formal mock (secondary)');
    expect(html).toContain('Use Start a drive for normal private practice.');
    expect(html).toContain('full DL25 marking sheet');
    expect(html.indexOf('My instructor is running this')).toBeLessThan(html.indexOf('Supervisor formal mock (secondary)'));
    expect(source).toContain('This is still a formal mock assessment, not ordinary private practice.');
    expect(source).toContain('use Start a drive for normal supervisor practice.');
    expect(source).toContain('best run by your instructor');
    expect(source).toContain('Record assessment notes');
    expect(source).toContain('Formal mock / supervisor assessment.');
    expect(source).toContain('Formal mock / instructor assessment.');
    expect(source).toContain('driving, serious, dangerous');

    expect(html).not.toContain('Practising with a supervisor');
    expect(html).not.toContain('ordinary private practice mode');
    expect(source).not.toContain('no exam jargon');
  });
});
