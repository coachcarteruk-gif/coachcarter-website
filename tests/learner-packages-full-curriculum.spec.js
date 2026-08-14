const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  buildProgrammeWeeks,
  catalogueEligibility,
  parseFutureTestBooking,
  parseRecurringAvailability,
  operationalTimeZone,
  programmeBoundaries,
  retakeWindow,
  validateRetakeAllocation,
  weeklyCancellationOutcome,
  zonedDateTimeToDate,
} = require('../api/_full-curriculum');
const { fulfilFullCurriculum } = require('../api/package-webhook')._test;

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function paidAttempt(overrides = {}) {
  return {
    id: '018f47b0-1a2b-4c3d-8e9f-0123456789ab', school_id: 7, learner_id: 41,
    product_slug: 'full-curriculum', status: 'paid', ...overrides,
  };
}

test.describe('Full Curriculum revised foundation', () => {
  test('commercial reconciliation deactivates phase products without deleting or repurposing history', () => {
    for (const source of [read('db/migration.sql'), read('db/migrations/046_full_curriculum_foundation.sql')]) {
      expect(source).toContain("slug IN ('phase-1-fundamental', 'phase-2-intermediate', 'phase-3-independent')");
      expect(source).toMatch(/SET active = FALSE, visible = FALSE/);
      expect(source).toContain("slug = 'full-curriculum'");
      expect(source).toContain("'full-curriculum-pilot-v2-test'");
      expect(source).toContain('200000');
      expect(source).not.toMatch(/DELETE FROM package_product_versions/i);
      expect(source).not.toMatch(/UPDATE package_product_versions\s+SET/i);
    }
  });

  test('only Full Curriculum can become checkout eligible', () => {
    const eligible = catalogueEligibility({ slug: 'full-curriculum' }, {
      purchasingEnabled: true, sameSchoolLearner: true,
      testBookingStatus: 'verified', testBookingFuture: true,
    });
    expect(eligible).toMatchObject({ state: 'test_checkout_available', purchase_eligible: true, checkout_available: true });
    expect(catalogueEligibility({ slug: 'flexible-30-hours' }, { purchasingEnabled: true, sameSchoolLearner: true })).toMatchObject({ checkout_available: false });
    expect(catalogueEligibility({ slug: 'manoeuvres' }, { purchasingEnabled: true, sameSchoolLearner: true })).toMatchObject({ checkout_available: false });
    expect(catalogueEligibility({ slug: 'phase-2-intermediate' }, { purchasingEnabled: true, sameSchoolLearner: true })).toMatchObject({ state: 'internal_stage', checkout_available: false });
    expect(catalogueEligibility({ slug: 'full-curriculum' }, { purchasingEnabled: true, sameSchoolLearner: true, testBookingStatus: 'verified', testBookingFuture: true, hasActiveEnrolment: true })).toMatchObject({ state: 'already_enrolled', checkout_available: false });
  });

  test('manual verification input retains only future date, time and centre with no lead-time invention', () => {
    const now = new Date('2026-08-13T10:00:00Z');
    expect(parseFutureTestBooking({ test_date: '2026-08-20', test_time: '09:15', test_centre: '  Example   Test Centre ' }, now)).toMatchObject({ ok: true, testCentre: 'Example Test Centre' });
    expect(parseFutureTestBooking({ test_date: '2026-08-13', test_time: '09:15', test_centre: 'Example' }, now)).toMatchObject({ ok: false, code: 'TEST_BOOKING_NOT_FUTURE' });
    expect(read('api/_full-curriculum-api.js')).not.toMatch(/licen[cs]e|booking_reference|screenshot|document_upload/i);
  });

  test('DVSA local test times use the school IANA timezone in winter and BST', () => {
    expect(operationalTimeZone({ timezone: 'Europe/London' })).toBe('Europe/London');
    expect(operationalTimeZone({ timezone: 'Not/A-Timezone' })).toBe('Europe/London');
    expect(zonedDateTimeToDate('2027-01-15', '10:00', 'Europe/London').toISOString())
      .toBe('2027-01-15T10:00:00.000Z');
    expect(zonedDateTimeToDate('2027-07-15', '10:00', 'Europe/London').toISOString())
      .toBe('2027-07-15T09:00:00.000Z');
    expect(parseFutureTestBooking(
      { test_date: '2027-07-15', test_time: '10:00', test_centre: 'Example Centre' },
      new Date('2027-07-15T09:30:00.000Z'),
      'Europe/London'
    )).toMatchObject({ ok: false, code: 'TEST_BOOKING_NOT_FUTURE' });
  });

  test('original first-test and 24-week boundaries produce one 90-minute opportunity per programme week', () => {
    const start = '2026-08-17T09:00:00Z';
    const earlyTest = '2026-09-07T08:00:00Z';
    const early = programmeBoundaries(start, earlyTest);
    expect(early.baseEndsAt.toISOString()).toBe('2026-09-07T08:00:00.000Z');
    expect(buildProgrammeWeeks(start, earlyTest)).toHaveLength(3);
    expect(buildProgrammeWeeks(start, earlyTest).every((week) => week.opportunityMinutes === 90)).toBe(true);
    const distant = programmeBoundaries(start, '2027-08-17T09:00:00Z');
    expect(distant.baseEndsAt.toISOString()).toBe(distant.twentyFourWeekCapAt.toISOString());
    expect(buildProgrammeWeeks(start, '2027-08-17T09:00:00Z')).toHaveLength(24);
  });

  test('payment starts matching only; instructor/admin agreement starts programme weeks and the 24-week clock', () => {
    const webhook = read('api/package-webhook.js');
    const api = read('api/_full-curriculum-api.js');
    const migration = read('db/migrations/046_full_curriculum_foundation.sql');
    expect(webhook).toContain("'paid_matching', 1, p.paid_at + INTERVAL '7 days'");
    expect(webhook).toContain("'programme_started', false");
    expect(webhook).not.toContain('generate_series(0, 23)');
    expect(api).toContain("'start-programme'");
    expect(api).toContain("scopeFor(req, res, ['instructor', 'admin'])");
    expect(api).toContain("e.status = 'paid_matching' AND e.programme_start_at IS NULL");
    expect(api).toContain("programme_start_at = ${startAt}::timestamptz");
    expect(api).toContain("twenty_four_week_cap_at = ${startAt}::timestamptz + INTERVAL '24 weeks'");
    expect(api).toContain('CROSS JOIN generate_series(0, 23)');
    expect(api).toContain("'package.start_programme'");
    expect(migration).toContain('programme_start_at         TIMESTAMPTZ,');
    expect(migration).toContain("'programme_started'");
  });

  test('recurring availability validates structured local windows without inventing a minimum count', () => {
    expect(parseRecurringAvailability([], 'Europe/London')).toEqual({ ok: true, timezone: 'Europe/London', windows: [] });
    expect(parseRecurringAvailability([
      { weekday: 5, local_start_time: '13:00', local_end_time: '16:30' },
      { weekday: 1, local_start_time: '09:00', local_end_time: '11:00' },
    ], 'Europe/London')).toMatchObject({
      ok: true,
      windows: [
        { weekday: 1, localStartTime: '09:00', localEndTime: '11:00' },
        { weekday: 5, localStartTime: '13:00', localEndTime: '16:30' },
      ],
    });
    expect(parseRecurringAvailability([{ weekday: 1, local_start_time: '11:00', local_end_time: '09:00' }], 'Europe/London')).toMatchObject({ ok: false, code: 'INVALID_AVAILABILITY_WINDOW' });
    expect(parseRecurringAvailability([{ weekday: 1, local_start_time: '09:00', local_end_time: '10:00' }], 'Not/A-Timezone')).toMatchObject({ ok: false, code: 'INVALID_AVAILABILITY_TIMEZONE' });
  });

  test('matching schema preserves initial assignment, append-only history and versioned availability', () => {
    for (const source of [read('db/migration.sql'), read('db/migrations/047_full_curriculum_matching.sql')]) {
      const matchingSection = source.slice(source.indexOf('-- Full Curriculum matching, instructor assignment and agreed availability.'));
      expect(source).toContain('CREATE TABLE IF NOT EXISTS full_curriculum_matching_records');
      expect(source).toContain('initial_instructor_id');
      expect(source).toContain('current_instructor_id');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS full_curriculum_assignment_events');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS full_curriculum_availability_versions');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS full_curriculum_availability_windows');
      expect(source).toContain('active = TRUE');
      expect(source).toContain('full_curriculum_assignment_events');
      expect(matchingSection).not.toContain('INSERT INTO learner_credit_balances');
      expect(matchingSection).not.toContain('INSERT INTO lesson_bookings');
    }
  });

  test('assignment and start authorization are pinned to the active current same-school instructor', () => {
    const api = read('api/_full-curriculum-api.js');
    expect(api).toContain("'assign-instructor'");
    expect(api).toContain("'accept-assignment'");
    expect(api).toContain('INSTRUCTOR_SELF_ASSIGNMENT_ONLY');
    expect(api).toContain('m.current_instructor_id = ${scope.actor.id}');
    expect(api).toContain('i.school_id = ${scope.schoolId} AND i.active = TRUE');
    expect(api).toContain("'package.reassign_instructor'");
    expect(api).toContain("m.status = 'accepted'");
    expect(api).toContain('m.accepted_by_instructor_id = ${scope.actor.id}');
    expect(api).toContain('FROM full_curriculum_availability_versions av');
    expect(api).toContain("${startAt}::timestamptz >= p.paid_at");
    expect(api).toContain("${startAt}::timestamptz < e.original_first_test_at");
  });

  test('webhook creates pending matching identity but still creates no programme week', () => {
    const webhook = read('api/package-webhook.js');
    expect(webhook).toContain('INSERT INTO full_curriculum_matching_records');
    expect(webhook).toContain("e.learner_id, 'pending'");
    expect(webhook).not.toContain('generate_series(0, 23)');
  });

  test('matching, assignment and availability participate in learner visibility and GDPR handling', () => {
    const learnerApi = read('api/learner.js');
    const gdpr = read('api/_gdpr.js');
    const learnerUi = read('public/learner/packages.js');
    expect(learnerApi).toContain('full_curriculum_matching_records');
    expect(learnerApi).toContain('full_curriculum_assignment_events');
    expect(learnerApi).toContain('full_curriculum_availability_windows');
    expect(gdpr).toContain('UPDATE full_curriculum_matching_records');
    expect(gdpr).toContain('SET learner_id = NULL');
    expect(learnerUi).toContain('Matched instructor');
    expect(learnerUi).toContain('Agreed availability');
    expect(read('public/instructor/programmes.js')).toContain('These windows are not reservations or lesson bookings');
    expect(read('public/admin/packages.js')).toContain('Save an empty version if no recurring window was agreed');
  });

  test('learner postponement does not extend while permitted admin reasons are explicit and audited', () => {
    const api = read('api/_full-curriculum-api.js');
    expect(api).toContain("'learner_requested', 'dvsa', 'exceptional'");
    expect(api).toContain("'entitlement_extended', false");
    expect(api).toContain("'dvsa_change', 'exceptional_circumstance', 'coachcarter_replacement'");
    expect(api).toContain("'package.record_test_date_change'");
    expect(api).toContain("'package.record_extension'");
  });

  test('weekly cancellation policy consumes late learner cancellations and protects CoachCarter replacements', () => {
    expect(weeklyCancellationOutcome({ cancelledBy: 'learner', noticeHours: 47 })).toEqual({ opportunityStatus: 'used_late_cancel', used: true, mayExtend: false });
    expect(weeklyCancellationOutcome({ cancelledBy: 'learner', noticeHours: 48 })).toEqual({ opportunityStatus: 'unused', used: false, mayExtend: false });
    expect(weeklyCancellationOutcome({ cancelledBy: 'coachcarter', noticeHours: 1 })).toEqual({ opportunityStatus: 'replacement_required', used: false, mayExtend: true });
    expect(weeklyCancellationOutcome({ cancelledBy: 'instructor', noticeHours: 1, replacementDelivered: true })).toEqual({ opportunityStatus: 'booked', used: true, mayExtend: false });
  });

  test('independent assessment requires a different active same-school instructor and creates no checkout', () => {
    const migration = read('db/migrations/046_full_curriculum_foundation.sql');
    const api = read('api/_full-curriculum-api.js');
    expect(migration).toContain('CHECK (teaching_instructor_id <> assessor_instructor_id)');
    expect(api).toContain('teachingId === assessorId');
    expect(api).toContain("assessor.school_id = ${scope.schoolId}");
    expect(api).toContain("pe.detail->>'teaching_instructor_id' = ${String(teachingId)}");
    expect(api).toContain("a.instructor_id = ${teachingId} AND a.allocation_type = 'base_lesson'");
    expect(api).toContain("event_type = 'ready_for_assessment'");
    const assessmentSection = api.slice(api.indexOf('async function recordAssessment'), api.indexOf('async function recordTestDateChange'));
    expect(assessmentSection).not.toContain('create-checkout');
    expect(assessmentSection).not.toContain('package_purchase_attempts');
  });

  test('booking allocation and weekly mutation reject cross-school and other-instructor assignment', () => {
    const api = read('api/_full-curriculum-api.js');
    expect(api).toContain("b.school_id = ${scope.schoolId} AND b.learner_id = e.learner_id");
    expect(api).toContain("i.school_id = ${scope.schoolId} AND i.active = TRUE");
    expect(api.match(/scope\.actorType !== 'instructor'\} OR b\.instructor_id = \$\{scope\.actor\.id\}/g)).toHaveLength(2);
    expect(api).toContain('a.weekly_opportunity_id = full_curriculum_weekly_opportunities.id');
    expect(api).toContain("a.instructor_id = ${scope.actor.id}");
  });

  test('retake rules enforce evidence window, durations, cap and second-test expiry', () => {
    const window = retakeWindow('2026-12-10T10:00:00Z');
    expect(window.opensAt.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    expect(validateRetakeAllocation({ durationMinutes: 60, bookingAt: '2026-11-20T10:00:00Z', secondTestAt: '2026-12-10T10:00:00Z' })).toMatchObject({ ok: false, code: 'RETAKE_DURATION_NOT_ALLOWED' });
    expect(validateRetakeAllocation({ durationMinutes: 90, bookingAt: '2026-11-11T10:00:00Z', secondTestAt: '2026-12-10T10:00:00Z' })).toMatchObject({ ok: false, code: 'RETAKE_WINDOW_NOT_OPEN' });
    expect(validateRetakeAllocation({ durationMinutes: 120, bookingAt: '2026-12-10T10:00:00Z', secondTestAt: '2026-12-10T10:00:00Z' })).toMatchObject({ ok: false, code: 'RETAKE_ALLOWANCE_EXPIRED' });
    expect(validateRetakeAllocation({ durationMinutes: 120, bookingAt: '2026-11-20T10:00:00Z', secondTestAt: '2026-12-10T10:00:00Z', alreadyConsumedMinutes: 510 })).toMatchObject({ ok: false, code: 'RETAKE_ALLOWANCE_EXCEEDED' });
    expect(validateRetakeAllocation({ durationMinutes: 90, bookingAt: '2026-11-20T10:00:00Z', secondTestAt: '2026-12-10T10:00:00Z', alreadyConsumedMinutes: 510 })).toMatchObject({ ok: true, remainingMinutes: 0 });
    for (const source of [read('db/migration.sql'), read('db/migrations/046_full_curriculum_foundation.sql')]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS full_curriculum_retake_usage_counters');
      expect(source).toContain('reserve_full_curriculum_retake_minutes');
      expect(source).toContain("CONSTRAINT = 'full_curriculum_retake_usage_cap'");
    }
    expect(read('api/_full-curriculum-api.js')).not.toContain('SELECT SUM(m.minutes) FROM full_curriculum_retake_movements');
  });

  test('schema is school-scoped, indexed, append-only, and never creates Lesson Credit', () => {
    const source = read('db/migrations/046_full_curriculum_foundation.sql');
    for (const table of ['learner_package_purchases', 'full_curriculum_enrolments', 'full_curriculum_weekly_opportunities', 'full_curriculum_progress_events', 'full_curriculum_assessments', 'full_curriculum_booking_allocations', 'full_curriculum_retake_allowances', 'full_curriculum_retake_movements']) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(source).toContain('uq_full_curriculum_active_learner');
    expect(source).toContain('forbid_full_curriculum_evidence_change');
    expect(source).toContain('idx_full_curriculum_allocations_instructor');
    expect(source).not.toContain('INSERT INTO learner_credit_balances');
    expect(read('api/package-webhook.js')).not.toContain('learner_credit_balances');
  });

  test('webhook fulfilment atomically creates one unstarted paid-matching enrolment and duplicate calls return it', async () => {
    const calls = [];
    const results = [
      [{ id: 501, school_id: 7, fulfilment_created: true }],
      [{ id: 501, school_id: 7, fulfilment_created: false }],
    ];
    const sql = async (strings) => { calls.push(strings.join('?')); return results.shift(); };
    const first = await fulfilFullCurriculum(sql, { attempt: paidAttempt() });
    const duplicate = await fulfilFullCurriculum(sql, { attempt: paidAttempt() });
    expect(first).toMatchObject({ created: true, enrolment: { id: 501 } });
    expect(duplicate).toMatchObject({ created: false, enrolment: { id: 501 } });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('WITH source AS');
    expect(calls[0]).toContain('ON CONFLICT (attempt_id) DO UPDATE');
    expect(calls[0]).toContain('ON CONFLICT (purchase_id) DO UPDATE');
    expect(calls[0]).toContain('RETURNING *, (xmax = 0) AS created_now');
    expect(calls[0]).toContain('WHERE e.created_now = TRUE');
    expect(calls[0]).toContain("'paid_matching'");
    expect(calls[0]).toContain("'programme_started'");
    expect(calls[0]).not.toContain('generate_series(0, 23)');
  });

  test('success/return page cannot fulfil and signed live events remain rejected', () => {
    const learnerJs = read('public/learner/packages.js');
    const webhook = read('api/package-webhook.js');
    expect(learnerJs).toContain('This return page cannot activate a package');
    expect(learnerJs).not.toContain('learner_package_purchases');
    expect(webhook.indexOf('constructEvent')).toBeLessThan(webhook.indexOf('neon(process.env.POSTGRES_URL)'));
    expect(webhook).toContain('LIVE_STRIPE_EVENT_REJECTED');
    expect(webhook).toContain('await fulfilFullCurriculum');
  });

  test('GDPR export/anonymisation and admin audit cover new learner evidence', () => {
    const gdpr = read('api/_gdpr.js');
    const learner = read('api/learner.js');
    const api = read('api/_full-curriculum-api.js');
    expect(gdpr).toContain('UPDATE learner_package_purchases SET learner_id = NULL');
    expect(gdpr).toContain('UPDATE full_curriculum_enrolments SET learner_id = NULL');
    expect(gdpr).toContain('UPDATE full_curriculum_test_bookings SET learner_id = NULL, test_centre = NULL');
    expect(learner).toContain("['full_curriculum']");
    expect(learner).toContain('full_curriculum_progress_events');
    for (const exportTable of [
      'full_curriculum_test_date_changes',
      'full_curriculum_extensions',
      'full_curriculum_booking_allocations',
      'full_curriculum_retake_allowances',
      'full_curriculum_retake_window_events',
      'full_curriculum_retake_movements',
    ]) {
      expect(learner).toContain(exportTable);
    }
    expect(api).toContain('await logAudit(sql');
    expect(api).toContain("'package.verify_test_booking'");
  });

  test('learner/admin/instructor surfaces are responsive, accessible, and expose only the revised product model', () => {
    const learnerHtml = read('public/learner/packages.html');
    const learnerCss = read('public/learner/packages.css');
    const adminHtml = read('public/admin/packages.html');
    const instructorHtml = read('public/instructor/programmes.html');
    expect(learnerHtml).toContain('id="test-booking-form"');
    expect(learnerHtml).toContain('id="programme-status"');
    expect(learnerHtml).toContain('Three internal stages');
    expect(learnerHtml).not.toContain('id="phase-products"');
    expect(adminHtml).toContain('Manual test-booking verification');
    expect(read('public/admin/packages.js')).toContain('start-programme-form');
    expect(read('public/instructor/programmes.js')).toContain('start-programme-form');
    expect(read('public/learner/packages.js')).toContain('Awaiting the programme start agreed by your instructor or admin');
    expect(instructorHtml).toContain('role="status" aria-live="polite"');
    expect(instructorHtml).toContain('/cookie-consent.js');
    expect(instructorHtml).toContain('/posthog-loader.js');
    expect(learnerCss).toContain('@media (max-width: 620px)');
    expect(read('public/instructor/programmes.css')).toContain('@media(max-width:760px)');
  });
});
