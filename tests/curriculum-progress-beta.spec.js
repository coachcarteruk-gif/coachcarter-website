const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const curriculum = require('../public/competency-config');
const {
  isCurriculumProgressBetaEnabled,
  validateInstructorSubmission,
  validateLearnerSubmission,
  validateCompletionKeys,
  validateRatings,
  isBookingReviewable,
} = require('../api/_curriculum-progress');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('curriculum progress beta contracts', () => {
  test('runtime config contains the agreed stable 10 completion and 51 scored items', () => {
    expect(curriculum.CURRICULUM_ITEMS).toHaveLength(61);
    expect(curriculum.CURRICULUM_ITEMS.filter((x) => x.assessmentType === 'completion')).toHaveLength(10);
    expect(curriculum.CURRICULUM_ITEMS.filter((x) => x.assessmentType === 'score')).toHaveLength(51);
    expect(new Set(curriculum.CURRICULUM_ITEMS.map((x) => x.key)).size).toBe(61);
    expect(curriculum.CURRICULUM_RATINGS).toEqual([
      { score: 1, key: 'struggled', label: 'Needs support' },
      { score: 2, key: 'ok', label: 'Developing' },
      { score: 3, key: 'nailed', label: 'Independent' },
    ]);
  });

  test('feature flag is disabled unless the nested value is exact boolean true', () => {
    for (const config of [undefined, {}, { features: {} }, { features: { curriculum_progress_beta: false } }, { features: { curriculum_progress_beta: 'true' } }, { features: { curriculum_progress_beta: 1 } }]) {
      expect(isCurriculumProgressBetaEnabled(config)).toBe(false);
    }
    expect(isCurriculumProgressBetaEnabled({ features: { curriculum_progress_beta: true } })).toBe(true);
  });

  test('production routing serves curriculum booking pages without dropping query parameters', () => {
    const config = JSON.parse(read('vercel.json'));
    const rewrites = config.rewrites || [];
    const catchAllIndex = rewrites.findIndex((rule) => rule.source === '/:path*');
    const expected = [
      ['/instructor/review-lesson', '/instructor/review-lesson.html'],
      ['/learner/rate-lesson', '/learner/rate-lesson.html'],
    ];

    expect(catchAllIndex).toBeGreaterThan(-1);
    for (const [source, destination] of expected) {
      const index = rewrites.findIndex((rule) => rule.source === source && rule.destination === destination);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(catchAllIndex);
    }
  });

  test('eligible past scheduled/chargeable lessons work retrospectively; refunded, future and cancelled-forfeit rows do not', () => {
    const past = '2026-08-20T11:00:00.000Z';
    const now = new Date('2026-08-27T11:00:00.000Z');
    expect(isBookingReviewable({ status: 'scheduled', lesson_ended_at: past, credit_forfeited: false }, now)).toBe(true);
    expect(isBookingReviewable({ status: 'chargeable', lesson_ended_at: past, credit_forfeited: false }, now)).toBe(true);
    expect(isBookingReviewable({ status: 'refunded', lesson_ended_at: past }, now)).toBe(false);
    expect(isBookingReviewable({ status: 'scheduled', lesson_ended_at: '2026-08-28T11:00:00.000Z' }, now)).toBe(false);
    expect(isBookingReviewable({ status: 'scheduled', lesson_ended_at: past, credit_forfeited: true }, now)).toBe(false);
  });

  test('server validation separates scoreable skills from completion checks and rejects blank/out-of-range scores', () => {
    expect(validateRatings([{ item_key: 'MOVE-01', score: 1 }]).ok).toBe(true);
    expect(validateRatings([{ item_key: 'MOVE-01', score: null }]).code).toBe('INVALID_SCORE');
    expect(validateRatings([{ item_key: 'MOVE-01', score: 0 }]).code).toBe('INVALID_SCORE');
    expect(validateRatings([{ item_key: 'MOVE-01', score: 4 }]).code).toBe('INVALID_SCORE');
    expect(validateRatings([{ item_key: 'SET-01', score: 2 }]).code).toBe('INVALID_CURRICULUM_ITEM');
    expect(validateCompletionKeys(['SET-01']).ok).toBe(true);
    expect(validateCompletionKeys(['MOVE-01']).code).toBe('INVALID_COMPLETION_ITEM');
    expect(validateCompletionKeys(['UNKNOWN']).code).toBe('INVALID_COMPLETION_ITEM');
  });

  test('instructor retries have a stable request id and learner can rate only every instructor-selected skill', () => {
    const instructor = validateInstructorSubmission({
      booking_id: 91, client_request_id: 'review-request-123',
      ratings: [{ item_key: 'MOVE-01', score: 2 }], completions: ['SET-01'],
    });
    expect(instructor.ok).toBe(true);
    const allowed = new Set(['MOVE-01', 'RNDB-01']);
    expect(validateLearnerSubmission({ booking_id: 91, client_request_id: 'reflection-123', ratings: [
      { item_key: 'MOVE-01', score: 2 }, { item_key: 'RNDB-01', score: 1 },
    ] }, allowed).ok).toBe(true);
    expect(validateLearnerSubmission({ booking_id: 91, client_request_id: 'reflection-124', ratings: [
      { item_key: 'MOVE-01', score: 2 }, { item_key: 'CORE-01', score: 2 },
    ] }, allowed).code).toBe('SKILL_NOT_SELECTED_BY_INSTRUCTOR');
    expect(validateLearnerSubmission({ booking_id: 91, client_request_id: 'reflection-125', ratings: [
      { item_key: 'MOVE-01', score: 2 },
    ] }, allowed).code).toBe('INCOMPLETE_REFLECTION');
  });

  test('schema, API and GDPR code enforce school scope, immutable history and retry-safe booking submissions', () => {
    const migration = read('db/migrations/054_curriculum_progress_beta.sql');
    const api = read('api/curriculum-progress.js');
    const gdpr = read('api/_gdpr.js');
    const learner = read('api/learner.js');
    const instructorWidget = read('public/instructor/curriculum-reviews-widget.js');
    const learnerWidget = read('public/learner/curriculum-reflection-widget.js');
    expect(migration).toContain('school_id          INTEGER NOT NULL REFERENCES schools(id)');
    expect(migration).toContain("CHECK (assessor_role IN ('instructor', 'learner'))");
    expect(migration).toContain('CHECK (score BETWEEN 1 AND 3)');
    expect(migration).toContain('UNIQUE (school_id, assessor_role, client_request_id)');
    expect(migration).toContain('UNIQUE (school_id, learner_id, curriculum_item_key)');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_driving_sessions_booking');
    expect(migration).toContain('CONSTRAINT curriculum_rating_events_item_type_check');
    expect(migration).toContain('CONSTRAINT curriculum_completion_events_item_type_check');
    expect(api).toContain('AND lb.instructor_id = ${instructorId}');
    expect(api).toContain('AND lb.learner_id = ${learnerId}');
    expect(api).toContain('AND lb.school_id = ${schoolId}');
    expect(api).toContain('OR e.instructor_id = ${viewerInstructorId}');
    expect(api).toContain('OR instructor_id = ${viewerInstructorId}');
    expect(api).toContain('loadCurriculumProgressBetaState(sql, schoolId)');
    expect(api).toContain('withNeonTransaction(process.env.POSTGRES_URL');
    expect(api).toContain('ON CONFLICT (school_id, assessor_role, client_request_id)');
    expect(api).toContain("code: 'INSTRUCTOR_REVIEW_REQUIRED'");
    expect(api).toContain('curriculum_item_key, assessor_role, assessed_at DESC');
    expect(gdpr).toContain('DELETE FROM curriculum_rating_events');
    expect(gdpr).toContain('DELETE FROM curriculum_review_submissions');
    expect(gdpr).toContain('DELETE FROM curriculum_completion_events');
    expect(learner).toContain('curriculum_rating_events: curriculumRatingEvents');
    expect(instructorWidget).toContain('href="/instructor/review-lesson?booking_id=');
    expect(instructorWidget).not.toContain('review-lesson.html?booking_id=');
    expect(learnerWidget).toContain('href="/learner/rate-lesson?booking_id=');
    expect(learnerWidget).not.toContain('rate-lesson.html?booking_id=');
  });

  test('curriculum API does not mutate booking, credit, refund, payout or Stripe state', () => {
    const api = read('api/curriculum-progress.js').toLowerCase();
    expect(api).not.toContain('update lesson_bookings');
    expect(api).not.toContain('learner_credit_balances');
    expect(api).not.toContain('credit_transactions');
    expect(api).not.toContain('refund_events');
    expect(api).not.toContain('payout_line_items');
    expect(api).not.toContain('stripe.');
  });
});

test.describe('curriculum progress browser flow', () => {
  test('instructor reviews a past booked lesson on mobile with server-derived context', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
      localStorage.setItem('cc_instructor', JSON.stringify({ instructor: { id: 7, school_id: 1, name: 'Alex' } }));
    });
    let submitted;
    await page.route('**/api/curriculum-progress?action=review**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, enabled: true, reviewable: true,
      booking: { id: 91, learner_id: 41, learner_name: 'Jamie Learner', instructor_name: 'Alex', scheduled_date: '2026-08-20', start_time: '10:00:00', end_time: '11:30:00', lesson_type_name: '90 minute lesson' },
      instructor_submission: null, instructor_ratings: [], learner_submission: null, learner_ratings: [], completions: [],
    }) }));
    await page.route('**/api/curriculum-progress?action=submit-instructor-review**', async (route) => { submitted = route.request().postDataJSON(); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, duplicate: false, submission_id: 1 }) }); });
    await page.goto('/instructor/review-lesson?booking_id=91', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/instructor\/review-lesson\?booking_id=91$/);
    await expect(page.getByText('Jamie Learner')).toBeVisible();
    await page.getByText('Moving off and stopping', { exact: true }).click();
    const movingOff = page.locator('[data-skill="MOVE-01"]');
    await movingOff.check();
    await movingOff.locator('xpath=ancestor::div[contains(@class,"cp-item")]').getByText('2 · Developing', { exact: true }).click();
    await page.getByText('Getting ready', { exact: true }).click();
    await page.locator('[data-completion="SET-01"]').check();
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    await page.getByRole('button', { name: 'Submit review' }).click();
    await expect.poll(() => submitted).toBeTruthy();
    expect(submitted).toMatchObject({ booking_id: 91, ratings: [{ item_key: 'MOVE-01', score: 2, note: '' }], completions: ['SET-01'] });
    expect(Object.keys(submitted).sort()).toEqual(['booking_id', 'client_request_id', 'completions', 'note', 'ratings']);
  });

  test('learner sees only instructor-selected skills and submits separate confidence scores', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
      localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 41, school_id: 1, name: 'Jamie' } }));
    });
    let submitted;
    await page.route('**/api/curriculum-progress?action=reflection&**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, enabled: true, booking: { id: 91, learner_name: 'Jamie', instructor_name: 'Alex', scheduled_date: '2026-08-20', start_time: '10:00:00' },
      instructor_submission: { id: 1 }, instructor_ratings: [{ item_key: 'MOVE-01', score: 2 }, { item_key: 'RNDB-03', score: 1 }], learner_submission: null, learner_ratings: [], completions: [],
    }) }));
    await page.route('**/api/curriculum-progress?action=submit-learner-reflection**', async (route) => { submitted = route.request().postDataJSON(); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
    await page.goto('/learner/rate-lesson?booking_id=91', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/learner\/rate-lesson\?booking_id=91$/);
    await expect(page.getByText('Choose and check the correct mirrors at the right time')).toHaveCount(0);
    await expect(page.getByText('Choose a safe, legal and appropriate place to pull up')).toBeVisible();
    await page.locator('.cp-card').filter({ hasText: 'MOVE-01' }).getByText('3 · Independent', { exact: true }).click();
    await page.locator('.cp-card').filter({ hasText: 'RNDB-03' }).getByText('2 · Developing', { exact: true }).click();
    await page.getByRole('button', { name: 'Save reflection' }).click();
    await expect.poll(() => submitted).toBeTruthy();
    expect(submitted.ratings.map((x) => [x.item_key, x.score])).toEqual([['MOVE-01', 3], ['RNDB-03', 2]]);
  });
});
