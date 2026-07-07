// @ts-check
const { test, expect } = require('@playwright/test');
const { test: authedTest, expect: authedExpect } = require('./fixtures/auth');

// 4-week platform advance booking cap (CLAUDE.md hard rule).
//
// MAX_DAYS_AHEAD = 28 in api/slots.js. The cap covers ?action=available,
// ?action=book, ?action=checkout-slot, ?action=reschedule, ?action=book-free-trial,
// and api/instructor.js?action=create-offer. The legitimate paths past the cap
// are bookOfferSeries() in api/offers.js, fanned out from the Stripe webhook,
// and the narrow practical-test exception in ?action=test-date-availability,
// ?action=book-test-date, and ?action=checkout-test-date. Instructors may
// reduce their own learner-facing booking window via max_booking_days_ahead,
// but may not extend ordinary self-serve booking beyond 28 days.
//
// What this exercises (live API):
//   1. ?action=available rejects `to` > today + 28 days with the documented
//      error message — this is the canonical user-visible cap.
//   2. ?action=available accepts `to` = today + 28 days exactly (boundary).
//   3. POST ?action=book with a date > today + 28 days returns 400 *or* 401
//      (auth runs first; the test asserts that no other status leaks
//      through, which would mean a regression bypassed both gates).
//   4. POST ?action=reschedule mirrors (3).
//   5. POST ?action=book-free-trial mirrors (3).
//   6. POST /api/instructor?action=create-offer with scheduled_date past the
//      cap returns 400 *or* 401 — same logic as (3).
//
// This is the kind of regression that's silent in code review: someone bumps
// MAX_DAYS_AHEAD to 90 "to test something", or adds a new booking entry
// point and forgets the cap. The test is cheap insurance.
//
// Gated behind CC_TEST_API because it needs vercel dev + a database. Run with:
//   CC_TEST_BASE_URL=http://localhost:3000 CC_TEST_API=1 npm test -- advance-cap
// where localhost:3000 is `vercel dev`, not `npx serve`.

const CAP_DAYS = 28;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function daysFromToday(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

test.describe('4-week advance booking cap', () => {
  test.skip(() => !process.env.CC_TEST_API, 'set CC_TEST_API=1 with vercel dev to exercise the live cap');

  test('?action=available rejects `to` past the 28-day cap', async ({ request }) => {
    const from = daysFromToday(0);
    const to = daysFromToday(CAP_DAYS + 1);
    const res = await request.get(`/api/slots?action=available&from=${from}&to=${to}&lesson_type_id=1`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    // Error string is part of the public contract — bumping the cap should
    // be deliberate. If you change MAX_DAYS_AHEAD, update CAP_DAYS here too.
    expect(body.error).toMatch(/28 days/);
  });

  test('?action=available accepts `to` exactly at the 28-day boundary', async ({ request }) => {
    const from = daysFromToday(0);
    const to = daysFromToday(CAP_DAYS);
    const res = await request.get(`/api/slots?action=available&from=${from}&to=${to}&lesson_type_id=1`);
    // 200 (slots returned), or 404 if lesson_type_id=1 doesn't exist in the
    // dev DB — but NOT 400 for the cap reason.
    if (res.status() === 400) {
      const body = await res.json();
      expect(body.error).not.toMatch(/28 days/);
    } else {
      expect([200, 404]).toContain(res.status());
    }
  });

  test('POST ?action=book past the cap is rejected (400 or 401)', async ({ request }) => {
    // Without an auth cookie, auth runs first and 401s. We assert the request
    // never sneaks through with a 2xx — that would mean both the auth gate
    // AND the cap gate were bypassed, which is the regression we care about.
    // The authed version below upgrades this to a real 400 assertion.
    const res = await request.post('/api/slots?action=book', {
      data: {
        instructor_id: 1,
        date: daysFromToday(CAP_DAYS + 30),
        start_time: '10:00',
        end_time: '11:30',
        lesson_type_id: 1,
      },
    });
    expect([400, 401]).toContain(res.status());
  });

  test('POST ?action=reschedule past the cap is rejected (400 or 401)', async ({ request }) => {
    const res = await request.post('/api/slots?action=reschedule', {
      data: {
        booking_id: 999999,
        new_date: daysFromToday(CAP_DAYS + 30),
        new_start_time: '10:00',
      },
    });
    expect([400, 401]).toContain(res.status());
  });

  test('POST ?action=book-free-trial past the cap is rejected (400 or 401)', async ({ request }) => {
    const res = await request.post('/api/slots?action=book-free-trial', {
      data: {
        instructor_id: 1,
        date: daysFromToday(CAP_DAYS + 30),
        start_time: '10:00',
        end_time: '11:30',
      },
    });
    // book-free-trial may not require auth on every code path; the cap check
    // should still fire. Allow 400/401 as above.
    expect([400, 401, 404]).toContain(res.status());
  });

  test('POST /api/instructor?action=create-offer past the cap is rejected (400 or 401)', async ({ request }) => {
    const res = await request.post('/api/instructor?action=create-offer', {
      data: {
        learner_name: 'Test',
        scheduled_date: daysFromToday(CAP_DAYS + 30),
        start_time: '10:00',
      },
    });
    expect([400, 401]).toContain(res.status());
  });
});

// ── Authed cap tests ─────────────────────────────────────────────────────────
// These upgrade the unauth'd 400-or-401 checks above into real 400 assertions
// against the cap-check error string. They run only when the role credentials
// are configured (CC_TEST_LEARNER_*, CC_TEST_INSTRUCTOR_*).
authedTest.describe('4-week advance cap — authed', () => {
  authedTest('learner POST ?action=book past the cap returns 400 with cap message', async ({ learnerRequest }) => {
    const res = await learnerRequest.post('/api/slots?action=book', {
      data: {
        instructor_id: 1,
        date: daysFromToday(CAP_DAYS + 30),
        start_time: '10:00',
        end_time: '11:30',
        lesson_type_id: 1,
      },
    });
    authedExpect(res.status()).toBe(400);
    const body = await res.json();
    authedExpect(body.error).toMatch(/28 days/);
  });

  authedTest('learner POST ?action=reschedule past the cap returns 400 with cap message', async ({ learnerRequest }) => {
    const res = await learnerRequest.post('/api/slots?action=reschedule', {
      data: {
        booking_id: 999999, // bogus id is fine — cap check fires before booking lookup
        new_date: daysFromToday(CAP_DAYS + 30),
        new_start_time: '10:00',
      },
    });
    authedExpect(res.status()).toBe(400);
    const body = await res.json();
    authedExpect(body.error).toMatch(/28 days/);
  });

  authedTest('instructor POST ?action=create-offer past the cap returns 400 with 4-week message', async ({ instructorRequest }) => {
    const res = await instructorRequest.post('/api/instructor?action=create-offer', {
      data: {
        learner_name: 'Test',
        scheduled_date: daysFromToday(CAP_DAYS + 30),
        start_time: '10:00',
      },
    });
    authedExpect(res.status()).toBe(400);
    const body = await res.json();
    authedExpect(body.error).toMatch(/4 weeks/);
  });

  authedTest('learner POST ?action=book at the boundary (today + 28) is NOT rejected for the cap', async ({ learnerRequest }) => {
    // The booking will likely fail for *other* reasons (no slot, no balance,
    // wrong duration) — we only assert the cap-message isn't the rejection.
    const res = await learnerRequest.post('/api/slots?action=book', {
      data: {
        instructor_id: 1,
        date: daysFromToday(CAP_DAYS),
        start_time: '10:00',
        end_time: '11:30',
        lesson_type_id: 1,
      },
    });
    if (res.status() === 400) {
      const body = await res.json();
      authedExpect(body.error || '').not.toMatch(/28 days/);
    }
  });
});
