'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');
const { isLearnerPackagesEnabled } = require('./_learner-packages');
const {
  ACTIVE_ENROLMENT_STATUSES,
  DEFAULT_OPERATIONAL_TIMEZONE,
  operationalTimeZone,
  parseFutureTestBooking,
  parseRecurringAvailability,
  retakeWindow,
  weeklyCancellationOutcome,
} = require('./_full-curriculum');
const {
  listRefundCases,
  requestProgrammeTermination,
  validUuid,
} = require('./_full-curriculum-refunds');
const { PILOT_CERTIFICATION_VERSION } = require('./_full-curriculum-consumer-rights');

const ACTIONS = new Set([
  'submit-test-booking', 'test-bookings', 'verify-test-booking',
  'programme-status', 'programme-list', 'assign-instructor', 'accept-assignment',
  'release-cooling-off-hold', 'record-programme-availability', 'start-programme', 'record-readiness', 'record-assessment',
  'record-test-date-change', 'record-extension', 'record-week-outcome',
  'allocate-programme-booking', 'activate-retake', 'record-retake-test-change',
  'request-programme-termination', 'programme-refund-cases',
  'review-programme-refund', 'approve-programme-refund', 'record-programme-refund-result',
  'programme-pilot-access', 'grant-programme-pilot-access', 'revoke-programme-pilot-access',
]);

function fail(res, status, code, message) {
  return res.status(status).json({ error: true, code, message });
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function actorType(actor) {
  if (actor.role === 'superadmin') return 'superadmin';
  if (actor.role === 'learner') return 'learner';
  if (actor.role === 'instructor' && actor.isAdmin === true) return 'instructor_admin';
  return actor.role === 'instructor' ? 'instructor' : 'admin';
}

function scopeFor(req, res, roles) {
  const actor = requireAuth(req, { roles, requireSchool: true });
  if (!actor) {
    fail(res, 401, 'UNAUTHORIZED', 'Authorised access required');
    return null;
  }
  const schoolId = getSchoolId(actor, req);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    fail(res, 400, 'SCHOOL_REQUIRED', 'A valid school is required');
    return null;
  }
  return { actor, schoolId, actorType: actorType(actor) };
}

function requirePost(req, res) {
  if (req.method === 'POST') return true;
  fail(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  return false;
}

function requireGet(req, res) {
  if (req.method === 'GET') return true;
  fail(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  return false;
}

async function requireCatalogueFeature(sql, schoolId, res) {
  const rows = await sql`SELECT config FROM schools WHERE id = ${schoolId} AND active = TRUE LIMIT 1`;
  if (!isLearnerPackagesEnabled(rows[0]?.config)) {
    fail(res, 404, 'LEARNER_PACKAGES_DISABLED', 'Packages are not available for this school');
    return false;
  }
  return true;
}

async function loadSchoolTimezone(sql, schoolId) {
  const rows = await sql`
    SELECT config
      FROM schools
     WHERE id = ${schoolId}
       AND active = TRUE
     LIMIT 1
  `;
  return operationalTimeZone(rows[0]?.config);
}

async function audit(sql, req, scope, action, targetType, targetId, details) {
  if (!['admin', 'superadmin', 'instructor_admin'].includes(scope.actorType)) return;
  await logAudit(sql, {
    adminId: scope.actor.id,
    adminEmail: scope.actor.email,
    action,
    targetType,
    targetId,
    details,
    schoolId: scope.schoolId,
    req,
  });
}

async function submitTestBooking(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['learner']);
  if (!scope) return;
  const attemptNumber = Number(req.body?.attempt_number || 1);
  const sql = neon(process.env.POSTGRES_URL);
  try {
    if (!await requireCatalogueFeature(sql, scope.schoolId, res)) return;
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const parsed = parseFutureTestBooking(req.body || {}, new Date(), schoolTimezone);
    if (!parsed.ok || ![1, 2].includes(attemptNumber)) {
      return fail(res, 400, parsed.code || 'INVALID_ATTEMPT_NUMBER', 'Valid future practical test details are required');
    }
    const learners = await sql`
      SELECT id FROM learner_users
       WHERE id = ${scope.actor.id} AND school_id = ${scope.schoolId}
       LIMIT 1
    `;
    if (!learners[0]) return fail(res, 404, 'LEARNER_NOT_FOUND', 'Learner not found');
    const rows = await sql`
      INSERT INTO full_curriculum_test_bookings (
        school_id, learner_id, attempt_number, test_date, test_time, test_centre
      ) VALUES (
        ${scope.schoolId}, ${scope.actor.id}, ${attemptNumber}, ${parsed.testDate}::date,
        ${parsed.testTime}::time, ${parsed.testCentre}
      )
      RETURNING id, attempt_number, test_date, test_time, test_centre,
                verification_status, created_at
    `;
    return res.status(201).json({ ok: true, test_booking: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=submit-test-booking', err);
    return fail(res, 500, 'TEST_BOOKING_CREATE_FAILED', 'Failed to record test details');
  }
}

async function listTestBookings(req, res) {
  if (!requireGet(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT tb.id, tb.learner_id, lu.name AS learner_name, lu.email AS learner_email,
             tb.attempt_number, tb.test_date, tb.test_time, tb.test_centre,
             tb.verification_status, tb.verified_by_actor_type,
             tb.verified_by_admin_id, tb.verified_at, tb.verification_reason, tb.created_at
        FROM full_curriculum_test_bookings tb
        LEFT JOIN learner_users lu
          ON lu.id = tb.learner_id AND lu.school_id = ${scope.schoolId}
       WHERE tb.school_id = ${scope.schoolId}
       ORDER BY CASE tb.verification_status WHEN 'pending' THEN 0 ELSE 1 END,
                tb.created_at DESC
       LIMIT 200
    `;
    return res.json({ ok: true, test_bookings: rows });
  } catch (err) {
    reportError('/api/packages?action=test-bookings', err);
    return fail(res, 500, 'TEST_BOOKINGS_LOAD_FAILED', 'Failed to load test-booking verification');
  }
}

async function verifyTestBooking(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const id = positiveInteger(req.body?.test_booking_id);
  const decision = String(req.body?.decision || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!id || !['verified', 'rejected'].includes(decision) || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_VERIFICATION', 'A booking, verification decision, and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = await sql`
      UPDATE full_curriculum_test_bookings
         SET verification_status = ${decision},
             verified_by_actor_type = ${scope.actorType},
             verified_by_admin_id = ${scope.actor.id},
             verified_at = NOW(), verification_reason = ${reason}, updated_at = NOW()
       WHERE id = ${id}
         AND school_id = ${scope.schoolId}
         AND learner_id IS NOT NULL
         AND verification_status = 'pending'
         AND ((test_date + test_time) AT TIME ZONE ${schoolTimezone}) > NOW()
       RETURNING *
    `;
    if (!rows[0]) return fail(res, 409, 'TEST_BOOKING_NOT_VERIFIABLE', 'The pending future booking was not found in this school');
    await audit(sql, req, scope, 'package.verify_test_booking', 'full_curriculum_test_booking', id, { decision, reason });
    return res.json({ ok: true, test_booking: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=verify-test-booking', err);
    return fail(res, 500, 'TEST_BOOKING_VERIFY_FAILED', 'Failed to record verification');
  }
}

async function loadProgramme(sql, schoolId, learnerId) {
  const rows = await sql`
    SELECT e.*, p.attempt_id, p.amount_pence, p.currency, p.product_snapshot, p.customer_terms_version,
           tb.test_date AS verified_test_date, tb.test_time AS verified_test_time,
           tb.test_centre AS verified_test_centre
      FROM full_curriculum_enrolments e
      JOIN learner_package_purchases p
        ON p.id = e.purchase_id AND p.school_id = ${schoolId}
      JOIN full_curriculum_test_bookings tb
        ON tb.id = e.first_test_booking_id AND tb.school_id = ${schoolId}
     WHERE e.school_id = ${schoolId} AND e.learner_id = ${learnerId}
     ORDER BY e.created_at DESC LIMIT 1
  `;
  if (!rows[0]) return null;
  const enrolment = rows[0];
  const [weeks, progress, assessments, retake, matching, contractEvidence, refundCases] = await Promise.all([
    sql`SELECT id, programme_week, week_start_at, week_end_at, opportunity_minutes, status, status_reason
          FROM full_curriculum_weekly_opportunities
         WHERE school_id = ${schoolId} AND enrolment_id = ${enrolment.id}
         ORDER BY programme_week`,
    sql`SELECT phase_number, event_type, actor_type, detail, created_at
          FROM full_curriculum_progress_events
         WHERE school_id = ${schoolId} AND enrolment_id = ${enrolment.id}
         ORDER BY id`,
    sql`SELECT phase_number, outcome, improvement_areas, assessed_at
          FROM full_curriculum_assessments
         WHERE school_id = ${schoolId} AND enrolment_id = ${enrolment.id}
         ORDER BY assessed_at`,
    sql`SELECT r.id, r.total_minutes,
               COALESCE(retake_window.new_opens_at, r.opens_at) AS opens_at,
               COALESCE(retake_window.new_expires_at, r.expires_at) AS expires_at,
               COALESCE(usage.consumed_minutes, 0)::int AS consumed_minutes
          FROM full_curriculum_retake_allowances r
          LEFT JOIN LATERAL (
            SELECT w.new_opens_at, w.new_expires_at
              FROM full_curriculum_retake_window_events w
             WHERE w.school_id = ${schoolId} AND w.allowance_id = r.id
             ORDER BY w.id DESC LIMIT 1
          ) retake_window ON TRUE
          LEFT JOIN full_curriculum_retake_usage_counters usage
            ON usage.allowance_id = r.id AND usage.school_id = ${schoolId}
         WHERE r.school_id = ${schoolId} AND r.enrolment_id = ${enrolment.id}
         LIMIT 1`,
    sql`SELECT m.id, m.status, m.initial_instructor_id, m.current_instructor_id,
               m.assigned_at, m.accepted_at, m.started_at,
               i.name AS instructor_name,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'event_type', ae.event_type,
                   'previous_instructor_id', ae.previous_instructor_id,
                   'instructor_id', ae.instructor_id,
                   'reason', ae.reason,
                   'created_at', ae.created_at
                 ) ORDER BY ae.id)
                   FROM full_curriculum_assignment_events ae
                  WHERE ae.school_id = ${schoolId} AND ae.matching_record_id = m.id
               ), '[]'::jsonb) AS assignment_history,
               (
                 SELECT jsonb_build_object(
                   'version_number', av.version_number,
                   'instructor_id', av.instructor_id,
                   'timezone', av.timezone,
                   'recorded_at', av.created_at,
                   'windows', COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                       'weekday', aw.weekday,
                       'local_start_time', to_char(aw.local_start_time, 'HH24:MI'),
                       'local_end_time', to_char(aw.local_end_time, 'HH24:MI')
                     ) ORDER BY aw.weekday, aw.local_start_time)
                       FROM full_curriculum_availability_windows aw
                      WHERE aw.school_id = ${schoolId} AND aw.availability_version_id = av.id
                   ), '[]'::jsonb)
                 )
                  FROM full_curriculum_availability_versions av
                  WHERE av.school_id = ${schoolId}
                    AND av.matching_record_id = m.id
                    AND av.instructor_id = m.current_instructor_id
                  ORDER BY av.version_number DESC LIMIT 1
               ) AS availability
          FROM full_curriculum_matching_records m
          LEFT JOIN instructors i
            ON i.id = m.current_instructor_id AND i.school_id = ${schoolId}
         WHERE m.school_id = ${schoolId} AND m.enrolment_id = ${enrolment.id}
         LIMIT 1`,
    sql`SELECT customer_terms_version, policy_version, disclosure_version,
               refund_calculation_version, disclosure_snapshot,
               early_start_requested, adult_age_confirmed,
               start_request_text, acknowledged_at
          FROM full_curriculum_consumer_contract_evidence
         WHERE school_id = ${schoolId} AND attempt_id = ${enrolment.attempt_id}::uuid
         LIMIT 1`,
    sql`SELECT c.id, c.classification, c.status, c.original_payment_pence,
               c.previous_refund_pence, c.deduction_pence, c.refund_due_pence,
               c.provider_status, c.created_at, r.received_at
          FROM full_curriculum_refund_cases c
          JOIN full_curriculum_termination_requests r
            ON r.id = c.termination_request_id AND r.school_id = ${schoolId}
         WHERE c.school_id = ${schoolId} AND c.enrolment_id = ${enrolment.id}
         ORDER BY c.created_at DESC`,
  ]);
  return {
    ...enrolment,
    weeks,
    progress,
    assessments,
    retake: retake[0] || null,
    matching: matching[0] || null,
    consumer_contract: contractEvidence[0] || null,
    refund_cases: refundCases,
  };
}

async function programmePilotAccess(req, res) {
  if (!requireGet(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const [rows, eligibleLearners] = await Promise.all([
      sql`SELECT access.id, access.learner_id, access.certification_version,
             access.granted_by_admin_id, access.granted_at, access.grant_reason,
             access.active, access.revoked_by_admin_id, access.revoked_at,
             access.revocation_reason,
             learner.name AS learner_name, learner.email AS learner_email
        FROM full_curriculum_pilot_access access
        LEFT JOIN learner_users learner
          ON learner.id = access.learner_id AND learner.school_id = ${scope.schoolId}
       WHERE access.school_id = ${scope.schoolId}
       ORDER BY access.active DESC, access.granted_at DESC
       LIMIT 100`,
      sql`SELECT learner.id, learner.name, learner.email
            FROM learner_users learner
           WHERE learner.school_id = ${scope.schoolId}
             AND learner.email_verified = TRUE
             AND NOT EXISTS (
               SELECT 1 FROM package_purchase_attempts attempt
                WHERE attempt.school_id = ${scope.schoolId}
                  AND attempt.product_slug = 'full-curriculum'
                  AND attempt.status IN ('created', 'submitting', 'pending', 'paid', 'review_required')
             )
             AND NOT EXISTS (
               SELECT 1 FROM full_curriculum_enrolments active_enrolment
                WHERE active_enrolment.school_id = ${scope.schoolId}
                  AND active_enrolment.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
             )
             AND NOT EXISTS (
               SELECT 1 FROM full_curriculum_enrolments enrolment
                WHERE enrolment.school_id = ${scope.schoolId}
                  AND enrolment.learner_id = learner.id
                  AND enrolment.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
             )
           ORDER BY learner.name, learner.id
           LIMIT 250`,
    ]);
    return res.json({
      ok: true,
      certification_version: PILOT_CERTIFICATION_VERSION,
      active_access: rows.find(row => row.active === true) || null,
      history: rows,
      eligible_learners: eligibleLearners,
    });
  } catch (err) {
    reportError('/api/packages?action=programme-pilot-access', err);
    return fail(res, 500, 'PILOT_ACCESS_LIST_FAILED', 'Failed to load controlled-pilot access');
  }
}

async function grantProgrammePilotAccess(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const learnerId = positiveInteger(req.body?.learner_id);
  const reason = String(req.body?.reason || '').trim();
  if (!learnerId || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_PILOT_ACCESS_GRANT', 'A same-school learner and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    if (!await requireCatalogueFeature(sql, scope.schoolId, res)) return;
    const rows = await sql`
      INSERT INTO full_curriculum_pilot_access (
        id, school_id, learner_id, certification_version,
        granted_by_admin_id, grant_reason
      )
      SELECT ${crypto.randomUUID()}::uuid, ${scope.schoolId}, learner.id,
             ${PILOT_CERTIFICATION_VERSION}, ${scope.actor.id}, ${reason}
        FROM learner_users learner
       WHERE learner.id = ${learnerId}
         AND learner.school_id = ${scope.schoolId}
         AND learner.email_verified = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM package_purchase_attempts attempt
            WHERE attempt.school_id = ${scope.schoolId}
              AND attempt.product_slug = 'full-curriculum'
              AND attempt.status IN ('created', 'submitting', 'pending', 'paid', 'review_required')
         )
         AND NOT EXISTS (
           SELECT 1 FROM full_curriculum_enrolments active_enrolment
            WHERE active_enrolment.school_id = ${scope.schoolId}
              AND active_enrolment.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
         )
         AND NOT EXISTS (
           SELECT 1 FROM full_curriculum_enrolments enrolment
            WHERE enrolment.school_id = ${scope.schoolId}
              AND enrolment.learner_id = learner.id
              AND enrolment.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
         )
      RETURNING *
    `;
    if (!rows[0]) {
      return fail(res, 409, 'PILOT_LEARNER_NOT_ELIGIBLE', 'The learner must be verified, in this school and not already actively enrolled');
    }
    await audit(sql, req, scope, 'package.grant_programme_pilot_access', 'learner', learnerId, {
      pilot_access_id: rows[0].id,
      certification_version: PILOT_CERTIFICATION_VERSION,
      reason,
    });
    return res.status(201).json({ ok: true, access: rows[0] });
  } catch (err) {
    if (err?.code === '23505') {
      return fail(res, 409, 'PILOT_ACCESS_ALREADY_ACTIVE', 'Revoke the current pilot learner before granting another');
    }
    reportError('/api/packages?action=grant-programme-pilot-access', err);
    return fail(res, 500, 'PILOT_ACCESS_GRANT_FAILED', 'Failed to grant controlled-pilot access');
  }
}

async function revokeProgrammePilotAccess(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const accessId = String(req.body?.pilot_access_id || '').trim().toLowerCase();
  const reason = String(req.body?.reason || '').trim();
  if (!validUuid(accessId) || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_PILOT_ACCESS_REVOCATION', 'An active pilot access record and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      UPDATE full_curriculum_pilot_access
         SET active = FALSE, revoked_by_admin_id = ${scope.actor.id},
             revoked_at = NOW(), revocation_reason = ${reason}, updated_at = NOW()
       WHERE id = ${accessId}::uuid
         AND school_id = ${scope.schoolId}
         AND active = TRUE
      RETURNING *
    `;
    if (!rows[0]) return fail(res, 409, 'PILOT_ACCESS_NOT_ACTIVE', 'This pilot access record is not active in this school');
    await audit(sql, req, scope, 'package.revoke_programme_pilot_access', 'learner', rows[0].learner_id, {
      pilot_access_id: rows[0].id,
      reason,
    });
    return res.json({ ok: true, access: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=revoke-programme-pilot-access', err);
    return fail(res, 500, 'PILOT_ACCESS_REVOCATION_FAILED', 'Failed to revoke controlled-pilot access');
  }
}

async function programmeStatus(req, res) {
  if (!requireGet(req, res)) return;
  const scope = scopeFor(req, res, ['learner']);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const programme = await loadProgramme(sql, scope.schoolId, scope.actor.id);
    const bookings = await sql`
      SELECT id, attempt_number, test_date, test_time, test_centre,
             verification_status, verified_at, created_at
        FROM full_curriculum_test_bookings
       WHERE school_id = ${scope.schoolId} AND learner_id = ${scope.actor.id}
       ORDER BY created_at DESC
    `;
    return res.json({ ok: true, programme, test_bookings: bookings });
  } catch (err) {
    reportError('/api/packages?action=programme-status', err);
    return fail(res, 500, 'PROGRAMME_STATUS_FAILED', 'Failed to load programme status');
  }
}

async function programmeList(req, res) {
  if (!requireGet(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const instructorOnly = scope.actorType === 'instructor';
    const rows = await sql`
      SELECT e.id, e.learner_id, lu.name AS learner_name, e.status, e.current_phase,
             e.matching_deadline, e.programme_start_at, e.original_first_test_at,
             e.current_first_test_at, e.base_entitlement_end_at, e.approved_entitlement_end_at,
             e.early_start_requested, e.cooling_off_expires_at, e.service_may_start_at,
             m.id AS matching_record_id, m.status AS matching_status,
             m.initial_instructor_id, m.current_instructor_id, m.assigned_at,
             m.accepted_at, mi.name AS matched_instructor_name,
             availability.version_number AS availability_version,
             availability.instructor_id AS availability_instructor_id,
             availability.timezone AS availability_timezone,
             COALESCE(availability.window_count, 0)::int AS availability_window_count,
             COALESCE(availability.windows, '[]'::jsonb) AS availability_windows
        FROM full_curriculum_enrolments e
        JOIN full_curriculum_matching_records m
          ON m.enrolment_id = e.id AND m.school_id = ${scope.schoolId}
        LEFT JOIN learner_users lu
          ON lu.id = e.learner_id AND lu.school_id = ${scope.schoolId}
        LEFT JOIN instructors mi
          ON mi.id = m.current_instructor_id AND mi.school_id = ${scope.schoolId}
        LEFT JOIN LATERAL (
          SELECT av.version_number, av.instructor_id, av.timezone,
                 COUNT(aw.id)::int AS window_count,
                 COALESCE(jsonb_agg(jsonb_build_object(
                   'weekday', aw.weekday,
                   'local_start_time', to_char(aw.local_start_time, 'HH24:MI'),
                   'local_end_time', to_char(aw.local_end_time, 'HH24:MI')
                 ) ORDER BY aw.weekday, aw.local_start_time) FILTER (WHERE aw.id IS NOT NULL), '[]'::jsonb) AS windows
            FROM full_curriculum_availability_versions av
            LEFT JOIN full_curriculum_availability_windows aw
              ON aw.availability_version_id = av.id AND aw.school_id = ${scope.schoolId}
           WHERE av.school_id = ${scope.schoolId} AND av.matching_record_id = m.id
             AND av.instructor_id = m.current_instructor_id
             AND av.version_number = (
               SELECT MAX(latest.version_number)
                 FROM full_curriculum_availability_versions latest
                WHERE latest.school_id = ${scope.schoolId}
                  AND latest.matching_record_id = m.id
                  AND latest.instructor_id = m.current_instructor_id
             )
           GROUP BY av.id
        ) availability ON TRUE
       WHERE e.school_id = ${scope.schoolId}
         AND (
           ${!instructorOnly}
           OR m.current_instructor_id = ${scope.actor.id}
         )
       ORDER BY e.matching_deadline, e.id
       LIMIT 200
    `;
    const eligibleInstructors = instructorOnly ? [] : await sql`
      SELECT id, name
        FROM instructors
       WHERE school_id = ${scope.schoolId} AND active = TRUE
       ORDER BY name, id
    `;
    return res.json({ ok: true, programmes: rows, eligible_instructors: eligibleInstructors });
  } catch (err) {
    reportError('/api/packages?action=programme-list', err);
    return fail(res, 500, 'PROGRAMME_LIST_FAILED', 'Failed to load programme operations');
  }
}

async function programmeRefundCases(req, res) {
  if (!requireGet(req, res)) return;
  const scope = scopeFor(req, res, ['learner', 'admin']);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const cases = await listRefundCases(
      sql,
      scope.schoolId,
      scope.actorType === 'learner' ? scope.actor.id : null
    );
    return res.json({ ok: true, refund_cases: cases });
  } catch (err) {
    reportError('/api/packages?action=programme-refund-cases', err);
    return fail(res, 500, 'PROGRAMME_REFUND_CASES_FAILED', 'Failed to load programme refund cases');
  }
}

async function requestProgrammeTerminationAction(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['learner', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const requestId = String(req.body?.request_id || '').trim().toLowerCase();
  const learnerRequest = scope.actorType === 'learner';
  const requestKind = learnerRequest
    ? 'learner_cancellation'
    : String(req.body?.request_kind || '').trim();
  const channel = learnerRequest
    ? 'self_service'
    : String(req.body?.channel || 'admin_recorded').trim();
  const receivedAt = learnerRequest ? new Date() : new Date(req.body?.received_at || Date.now());
  if (!enrolmentId || !validUuid(requestId)) {
    return fail(res, 400, 'INVALID_TERMINATION_REQUEST', 'A valid programme and request identity are required');
  }
  if (!learnerRequest && !['learner_cancellation', 'matching_failure', 'provider_nonfulfilment'].includes(requestKind)) {
    return fail(res, 400, 'INVALID_TERMINATION_KIND', 'Choose learner cancellation, matching failure or provider non-fulfilment');
  }
  try {
    const result = await requestProgrammeTermination({
      connectionString: process.env.POSTGRES_URL,
      schoolId: scope.schoolId,
      actorId: scope.actor.id,
      actorType: scope.actorType,
      learnerId: learnerRequest ? scope.actor.id : null,
      enrolmentId,
      requestId,
      requestKind,
      channel,
      reason: req.body?.reason,
      receivedAt,
    });
    await audit(neon(process.env.POSTGRES_URL), req, scope, 'package.request_programme_termination', 'full_curriculum_enrolment', enrolmentId, {
      request_id: requestId,
      request_kind: requestKind,
      channel,
      classification: result.refundCase.classification,
      refund_due_pence: result.refundCase.refund_due_pence,
      idempotent: result.idempotent,
      stripe_refund_issued: false,
    });
    return res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: result.idempotent,
      refund_case: result.refundCase,
      calculation: result.calculation || result.refundCase.calculation_snapshot?.calculation || null,
      stripe_refund_issued: false,
      message: 'Your request has been recorded at its received time. A manual review is required before any refund is issued.',
    });
  } catch (err) {
    reportError('/api/packages?action=request-programme-termination', err);
    return fail(res, err.status || 500, err.code || 'PROGRAMME_TERMINATION_FAILED', err.status ? err.message : 'Failed to record the programme cancellation request');
  }
}

async function reviewProgrammeRefund(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const caseId = String(req.body?.refund_case_id || '').trim().toLowerCase();
  const feePence = Number(req.body?.stripe_fee_absorbed_pence);
  const reason = String(req.body?.reason || '').trim();
  if (!validUuid(caseId) || !Number.isSafeInteger(feePence) || feePence < 0 || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_REFUND_REVIEW', 'A refund case, verified Stripe fee and audit reason are required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      WITH previous AS (
        SELECT id, school_id, status
          FROM full_curriculum_refund_cases
         WHERE id = ${caseId}::uuid AND school_id = ${scope.schoolId}
           AND status IN ('calculated', 'manual_review')
         FOR UPDATE
      ), reviewed AS (
        UPDATE full_curriculum_refund_cases c
           SET status = 'reviewed', stripe_fee_absorbed_pence = ${feePence},
               reviewed_by_admin_id = ${scope.actor.id}, reviewed_at = NOW(), updated_at = NOW()
          FROM previous p
         WHERE c.id = p.id AND c.school_id = p.school_id
        RETURNING c.*, p.status AS from_status
      ), event AS (
        INSERT INTO full_curriculum_refund_case_events (
          school_id, refund_case_id, from_status, to_status, actor_type, actor_id, detail
        )
        SELECT school_id, id, from_status, status, ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('reason', ${reason}::text, 'stripe_fee_absorbed_pence', ${feePence}::integer)
          FROM reviewed
        RETURNING refund_case_id
      )
      SELECT reviewed.* FROM reviewed JOIN event ON event.refund_case_id = reviewed.id
    `;
    if (!rows[0]) return fail(res, 409, 'REFUND_REVIEW_NOT_ALLOWED', 'The refund case is not awaiting first review');
    await audit(sql, req, scope, 'package.review_programme_refund', 'full_curriculum_enrolment', rows[0].enrolment_id, {
      refund_case_id: caseId,
      reason,
      stripe_fee_absorbed_pence: feePence,
    });
    return res.json({ ok: true, refund_case: rows[0], stripe_refund_issued: false });
  } catch (err) {
    reportError('/api/packages?action=review-programme-refund', err);
    return fail(res, 500, 'REFUND_REVIEW_FAILED', 'Failed to record the first refund review');
  }
}

async function approveProgrammeRefund(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const caseId = String(req.body?.refund_case_id || '').trim().toLowerCase();
  const reason = String(req.body?.reason || '').trim();
  if (!validUuid(caseId) || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_REFUND_APPROVAL', 'A refund case and audit reason are required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      WITH approved AS (
        UPDATE full_curriculum_refund_cases
           SET status = 'approved', approved_by_admin_id = ${scope.actor.id},
               approved_at = NOW(), updated_at = NOW()
         WHERE id = ${caseId}::uuid AND school_id = ${scope.schoolId}
           AND status = 'reviewed'
           AND reviewed_by_admin_id IS DISTINCT FROM ${scope.actor.id}
           AND stripe_fee_absorbed_pence IS NOT NULL
        RETURNING *
      ), event AS (
        INSERT INTO full_curriculum_refund_case_events (
          school_id, refund_case_id, from_status, to_status, actor_type, actor_id, detail
        )
        SELECT school_id, id, 'reviewed', status, ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('reason', ${reason}::text, 'provider_call_made', false)
          FROM approved
        RETURNING refund_case_id
      )
      SELECT approved.* FROM approved JOIN event ON event.refund_case_id = approved.id
    `;
    if (!rows[0]) return fail(res, 409, 'SECOND_APPROVER_REQUIRED', 'A different admin must approve a reviewed case with complete fee evidence');
    await audit(sql, req, scope, 'package.approve_programme_refund', 'full_curriculum_enrolment', rows[0].enrolment_id, {
      refund_case_id: caseId,
      reason,
      stripe_refund_issued: false,
    });
    return res.json({ ok: true, refund_case: rows[0], stripe_refund_issued: false });
  } catch (err) {
    reportError('/api/packages?action=approve-programme-refund', err);
    return fail(res, 500, 'REFUND_APPROVAL_FAILED', 'Failed to approve the programme refund');
  }
}

async function recordProgrammeRefundResult(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const caseId = String(req.body?.refund_case_id || '').trim().toLowerCase();
  const providerRefundId = String(req.body?.provider_refund_id || '').trim();
  const providerStatus = String(req.body?.provider_status || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!validUuid(caseId) || !/^re_[A-Za-z0-9_]+$/.test(providerRefundId)
      || !['succeeded', 'failed'].includes(providerStatus)
      || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_PROVIDER_REFUND_RESULT', 'A Stripe refund identity, result and audit reason are required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const targetStatus = providerStatus === 'succeeded' ? 'provider_succeeded' : 'provider_failed';
    const rows = await sql`
      WITH previous AS (
        SELECT id, school_id, status
          FROM full_curriculum_refund_cases
         WHERE id = ${caseId}::uuid AND school_id = ${scope.schoolId}
           AND status = ANY(${['approved', 'provider_failed']}::text[])
         FOR UPDATE
      ), recorded AS (
        UPDATE full_curriculum_refund_cases c
           SET status = ${targetStatus}, provider_refund_id = ${providerRefundId},
               provider_status = ${providerStatus}, provider_recorded_at = NOW(), updated_at = NOW()
          FROM previous p
         WHERE c.id = p.id AND c.school_id = p.school_id
        RETURNING c.*, p.status AS from_status
      ), event AS (
        INSERT INTO full_curriculum_refund_case_events (
          school_id, refund_case_id, from_status, to_status, actor_type, actor_id, detail
        )
        SELECT school_id, id, from_status, status, ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('reason', ${reason}::text, 'provider_refund_id', ${providerRefundId}::text, 'provider_status', ${providerStatus}::text)
          FROM recorded
        RETURNING refund_case_id
      )
      SELECT recorded.* FROM recorded JOIN event ON event.refund_case_id = recorded.id
    `;
    if (!rows[0]) return fail(res, 409, 'REFUND_RESULT_NOT_RECORDABLE', 'Only an approved or failed case can receive a manual Stripe result');
    await audit(sql, req, scope, 'package.record_programme_refund_result', 'full_curriculum_enrolment', rows[0].enrolment_id, {
      refund_case_id: caseId,
      reason,
      provider_refund_id: providerRefundId,
      provider_status: providerStatus,
    });
    return res.json({ ok: true, refund_case: rows[0], provider_call_made_by_application: false });
  } catch (err) {
    reportError('/api/packages?action=record-programme-refund-result', err);
    return fail(res, err?.code === '23505' ? 409 : 500, err?.code === '23505' ? 'PROVIDER_REFUND_ID_CONFLICT' : 'REFUND_RESULT_RECORD_FAILED', err?.code === '23505' ? 'This Stripe refund identity is already recorded' : 'Failed to record the provider refund result');
  }
}

async function releaseCoolingOffHold(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const reason = String(req.body?.reason || '').trim();
  if (!enrolmentId || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_COOLING_OFF_RELEASE', 'An enrolment and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH released AS (
        UPDATE full_curriculum_enrolments e
           SET status = 'paid_matching', updated_at = NOW()
         WHERE e.id = ${enrolmentId}
           AND e.school_id = ${scope.schoolId}
           AND e.status = 'cooling_off_hold'
           AND e.early_start_requested = FALSE
           AND e.service_may_start_at <= NOW()
           AND e.programme_start_at IS NULL
           AND EXISTS (
             SELECT 1
               FROM learner_package_purchases purchase
               JOIN full_curriculum_contract_events confirmation
                 ON confirmation.attempt_id = purchase.attempt_id
                AND confirmation.school_id = purchase.school_id
                AND confirmation.event_type = 'durable_confirmation_delivered'
              WHERE purchase.id = e.purchase_id
                AND purchase.school_id = e.school_id
           )
        RETURNING e.*
      ), contract_event AS (
        INSERT INTO full_curriculum_contract_events (
          school_id, attempt_id, purchase_id, enrolment_id, event_type,
          actor_type, actor_id, detail, occurred_at
        )
        SELECT e.school_id, p.attempt_id, p.id, e.id,
               'cooling_off_hold_released', ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('reason', ${reason}::text), NOW()
          FROM released e
          JOIN learner_package_purchases p
            ON p.id = e.purchase_id AND p.school_id = e.school_id
        RETURNING enrolment_id
      )
      SELECT released.*
        FROM released
        JOIN contract_event ON contract_event.enrolment_id = released.id
    `;
    if (!rows[0]) {
      return fail(res, 409, 'COOLING_OFF_HOLD_NOT_RELEASABLE', 'The cooling-off hold has not expired, was already released, or is outside this school');
    }
    await audit(sql, req, scope, 'package.release_cooling_off_hold', 'full_curriculum_enrolment', enrolmentId, { reason });
    return res.json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=release-cooling-off-hold', err);
    return fail(res, 500, 'COOLING_OFF_RELEASE_FAILED', 'Failed to release the cooling-off hold');
  }
}

async function assignInstructor(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const requestedInstructorId = positiveInteger(req.body?.instructor_id);
  const instructorId = scope.actorType === 'instructor' ? scope.actor.id : requestedInstructorId;
  const reason = String(req.body?.reason || '').trim();
  if (!enrolmentId || !instructorId || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_ASSIGNMENT', 'An enrolment, eligible instructor and audit reason are required');
  }
  if (scope.actorType === 'instructor' && requestedInstructorId && requestedInstructorId !== scope.actor.id) {
    return fail(res, 403, 'INSTRUCTOR_SELF_ASSIGNMENT_ONLY', 'An instructor may assign only themselves');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH current AS (
        SELECT m.*, e.learner_id
          FROM full_curriculum_matching_records m
          JOIN full_curriculum_enrolments e
            ON e.id = m.enrolment_id AND e.school_id = ${scope.schoolId}
          JOIN instructors i
            ON i.id = ${instructorId} AND i.school_id = ${scope.schoolId} AND i.active = TRUE
         WHERE m.enrolment_id = ${enrolmentId}
           AND m.school_id = ${scope.schoolId}
           AND e.learner_id IS NOT NULL
           AND e.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
           AND e.status <> 'cooling_off_hold'
           AND EXISTS (
             SELECT 1
               FROM learner_package_purchases purchase
               JOIN full_curriculum_contract_events confirmation
                 ON confirmation.attempt_id = purchase.attempt_id
                AND confirmation.school_id = purchase.school_id
                AND confirmation.event_type = 'durable_confirmation_delivered'
              WHERE purchase.id = e.purchase_id
                AND purchase.school_id = e.school_id
           )
           AND (${scope.actorType !== 'instructor'} OR (e.status = 'paid_matching' AND m.status <> 'started'))
           AND (
             ${scope.actorType !== 'instructor'}
             OR m.current_instructor_id IS NULL
             OR m.current_instructor_id = ${scope.actor.id}
           )
         FOR UPDATE OF m
      ), changed AS (
        UPDATE full_curriculum_matching_records m
           SET initial_instructor_id = COALESCE(m.initial_instructor_id, ${instructorId}),
               current_instructor_id = ${instructorId},
               status = CASE
                 WHEN m.status = 'started' THEN 'started'
                 ELSE ${scope.actorType === 'instructor' ? 'accepted' : 'assigned'}
               END,
               assigned_at = NOW(),
               accepted_at = CASE WHEN ${scope.actorType === 'instructor'} THEN NOW() ELSE NULL END,
               accepted_by_instructor_id = CASE
                 WHEN ${scope.actorType === 'instructor'} THEN ${scope.actor.id}::integer
                 ELSE NULL::integer
               END,
               updated_at = NOW()
          FROM current c
         WHERE m.id = c.id AND m.school_id = c.school_id
           AND m.current_instructor_id IS DISTINCT FROM ${instructorId}
        RETURNING m.*, c.current_instructor_id AS previous_instructor_id
      ), evidence AS (
        INSERT INTO full_curriculum_assignment_events (
          school_id, matching_record_id, enrolment_id, previous_instructor_id,
          instructor_id, event_type, actor_type, actor_id, reason
        )
        SELECT c.school_id, c.id, c.enrolment_id, c.previous_instructor_id,
               c.current_instructor_id,
               CASE
                 WHEN c.previous_instructor_id IS NOT NULL THEN 'reassigned'
                 WHEN ${scope.actorType === 'instructor'} THEN 'self_assigned'
                 ELSE 'assigned'
               END,
               ${scope.actorType}, ${scope.actor.id}, ${reason}
          FROM changed c
        RETURNING id
      )
      SELECT changed.* FROM changed JOIN evidence ON TRUE
    `;
    if (!rows[0]) {
      const existing = await sql`
        SELECT m.*
          FROM full_curriculum_matching_records m
          JOIN full_curriculum_enrolments e
            ON e.id = m.enrolment_id AND e.school_id = ${scope.schoolId}
         WHERE m.school_id = ${scope.schoolId} AND m.enrolment_id = ${enrolmentId}
         LIMIT 1
      `;
      if (existing[0]?.current_instructor_id === instructorId) {
        return res.json({ ok: true, matching: existing[0], idempotent: true });
      }
      return fail(res, 409, 'ASSIGNMENT_NOT_ALLOWED', 'The enrolment is unavailable, already assigned to another instructor, or the instructor is not eligible in this school');
    }
    await audit(sql, req, scope, rows[0].previous_instructor_id ? 'package.reassign_instructor' : 'package.assign_instructor', 'full_curriculum_enrolment', enrolmentId, {
      previous_instructor_id: rows[0].previous_instructor_id,
      instructor_id: instructorId,
      reason,
    });
    return res.status(201).json({ ok: true, matching: rows[0], idempotent: false });
  } catch (err) {
    reportError('/api/packages?action=assign-instructor', err);
    return fail(res, 500, 'ASSIGNMENT_FAILED', 'Failed to record the instructor assignment');
  }
}

async function acceptAssignment(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const reason = String(req.body?.reason || '').trim();
  if (!enrolmentId || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_ASSIGNMENT_ACCEPTANCE', 'An enrolment and acceptance reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH accepted AS (
        UPDATE full_curriculum_matching_records m
           SET status = 'accepted', accepted_at = NOW(),
               accepted_by_instructor_id = ${scope.actor.id}, updated_at = NOW()
          FROM full_curriculum_enrolments e
          JOIN instructors i
            ON i.id = ${scope.actor.id} AND i.school_id = ${scope.schoolId} AND i.active = TRUE
         WHERE m.enrolment_id = ${enrolmentId} AND m.school_id = ${scope.schoolId}
           AND e.id = m.enrolment_id AND e.school_id = ${scope.schoolId}
           AND e.status = 'paid_matching' AND e.learner_id IS NOT NULL
           AND m.current_instructor_id = ${scope.actor.id}
           AND m.status = 'assigned'
        RETURNING m.*
      ), evidence AS (
        INSERT INTO full_curriculum_assignment_events (
          school_id, matching_record_id, enrolment_id, instructor_id,
          event_type, actor_type, actor_id, reason
        )
        SELECT school_id, id, enrolment_id, current_instructor_id,
               'accepted', 'instructor', ${scope.actor.id}, ${reason}
          FROM accepted
        RETURNING id
      )
      SELECT accepted.* FROM accepted JOIN evidence ON TRUE
    `;
    if (!rows[0]) {
      const existing = await sql`
        SELECT * FROM full_curriculum_matching_records
         WHERE school_id = ${scope.schoolId} AND enrolment_id = ${enrolmentId}
           AND current_instructor_id = ${scope.actor.id}
         LIMIT 1
      `;
      if (existing[0]?.status === 'accepted') return res.json({ ok: true, matching: existing[0], idempotent: true });
      return fail(res, 409, 'ASSIGNMENT_ACCEPTANCE_NOT_ALLOWED', 'Only the active currently assigned instructor may accept this assignment');
    }
    return res.status(201).json({ ok: true, matching: rows[0], idempotent: false });
  } catch (err) {
    reportError('/api/packages?action=accept-assignment', err);
    return fail(res, 500, 'ASSIGNMENT_ACCEPTANCE_FAILED', 'Failed to accept the assignment');
  }
}

async function recordProgrammeAvailability(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const reason = String(req.body?.reason || '').trim();
  if (!enrolmentId || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_AVAILABILITY', 'An enrolment and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schools = await sql`
      SELECT COALESCE(NULLIF(config->>'timezone', ''), NULLIF(config->>'time_zone', ''), ${DEFAULT_OPERATIONAL_TIMEZONE}) AS timezone
        FROM schools
       WHERE id = ${scope.schoolId} AND active = TRUE
       LIMIT 1
    `;
    const parsed = parseRecurringAvailability(req.body?.windows, req.body?.timezone || schools[0]?.timezone);
    if (!parsed.ok) return fail(res, 400, parsed.code, 'Availability must use valid local times, weekdays and an explicit IANA timezone');
    const windowJson = JSON.stringify(parsed.windows.map((window) => ({
      weekday: window.weekday,
      local_start_time: window.localStartTime,
      local_end_time: window.localEndTime,
    })));
    const rows = await sql`
      WITH matching AS (
        SELECT m.*
          FROM full_curriculum_matching_records m
          JOIN full_curriculum_enrolments e
            ON e.id = m.enrolment_id AND e.school_id = ${scope.schoolId}
          JOIN instructors i
            ON i.id = m.current_instructor_id AND i.school_id = ${scope.schoolId} AND i.active = TRUE
         WHERE m.school_id = ${scope.schoolId} AND m.enrolment_id = ${enrolmentId}
           AND e.learner_id IS NOT NULL AND m.status IN ('assigned', 'accepted', 'started')
           AND (${scope.actorType !== 'instructor'} OR m.current_instructor_id = ${scope.actor.id})
         FOR UPDATE OF m
      ), version AS (
        INSERT INTO full_curriculum_availability_versions (
          school_id, matching_record_id, enrolment_id, instructor_id, version_number,
          timezone, actor_type, actor_id, reason
        )
        SELECT m.school_id, m.id, m.enrolment_id, m.current_instructor_id,
               COALESCE((SELECT MAX(existing.version_number)
                           FROM full_curriculum_availability_versions existing
                          WHERE existing.school_id = m.school_id AND existing.matching_record_id = m.id), 0) + 1,
               ${parsed.timezone}, ${scope.actorType}, ${scope.actor.id}, ${reason}
          FROM matching m
        RETURNING *
      ), windows AS (
        INSERT INTO full_curriculum_availability_windows (
          school_id, availability_version_id, weekday, local_start_time, local_end_time
        )
        SELECT v.school_id, v.id, item.weekday,
               item.local_start_time::time, item.local_end_time::time
          FROM version v
          CROSS JOIN jsonb_to_recordset(${windowJson}::jsonb)
            AS item(weekday integer, local_start_time text, local_end_time text)
        RETURNING id
      )
      SELECT version.*, (SELECT COUNT(*) FROM windows)::int AS window_count FROM version
    `;
    if (!rows[0]) return fail(res, 409, 'AVAILABILITY_NOT_ALLOWED', 'Assign an active same-school instructor before recording matching availability');
    await audit(sql, req, scope, 'package.record_programme_availability', 'full_curriculum_enrolment', enrolmentId, {
      version_number: rows[0].version_number,
      timezone: parsed.timezone,
      window_count: parsed.windows.length,
      reason,
    });
    return res.status(201).json({ ok: true, availability: rows[0], windows: parsed.windows });
  } catch (err) {
    reportError('/api/packages?action=record-programme-availability', err);
    return fail(res, 500, 'AVAILABILITY_RECORD_FAILED', 'Failed to record agreed availability');
  }
}

async function startProgramme(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const requestedInstructorId = positiveInteger(req.body?.instructor_id);
  const instructorId = scope.actorType === 'instructor' ? scope.actor.id : requestedInstructorId;
  const programmeStart = new Date(req.body?.programme_start_at);
  const reason = String(req.body?.reason || '').trim();
  const acceptanceOverrideValue = req.body?.instructor_acceptance_override;
  const acceptanceOverrideRequested = acceptanceOverrideValue === true;
  if (!enrolmentId || !instructorId || Number.isNaN(programmeStart.getTime()) || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_PROGRAMME_START', 'An assigned instructor, programme start date and audit reason are required');
  }
  if (acceptanceOverrideValue !== undefined && typeof acceptanceOverrideValue !== 'boolean') {
    return fail(res, 400, 'INVALID_ACCEPTANCE_OVERRIDE', 'Instructor acceptance override must be an explicit Boolean');
  }
  if (scope.actorType === 'instructor' && requestedInstructorId && requestedInstructorId !== scope.actor.id) {
    return fail(res, 403, 'INSTRUCTOR_SELF_START_ONLY', 'An instructor may start only a programme assigned to themselves');
  }
  if (scope.actorType === 'instructor' && acceptanceOverrideRequested) {
    return fail(res, 403, 'ADMIN_ACCEPTANCE_OVERRIDE_ONLY', 'Only an authorised admin may override missing instructor acceptance');
  }
  const startAt = programmeStart.toISOString();
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = await sql`
      WITH eligible AS (
        SELECT e.id, e.school_id, e.original_first_test_at, p.paid_at,
               m.id AS matching_record_id, m.status AS matching_status
          FROM full_curriculum_enrolments e
          JOIN learner_package_purchases p
            ON p.id = e.purchase_id AND p.school_id = ${scope.schoolId}
          JOIN full_curriculum_matching_records m
            ON m.enrolment_id = e.id AND m.school_id = ${scope.schoolId}
          JOIN instructors i
            ON i.id = m.current_instructor_id
           AND i.school_id = ${scope.schoolId}
           AND i.active = TRUE
         WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
           AND e.status = 'paid_matching' AND e.programme_start_at IS NULL
           AND m.current_instructor_id = ${instructorId}
           AND (
             (${scope.actorType === 'instructor'} AND m.status = 'accepted'
               AND m.accepted_by_instructor_id = ${scope.actor.id})
             OR (${scope.actorType !== 'instructor'} AND m.status = 'accepted')
             OR (${scope.actorType !== 'instructor'} AND ${acceptanceOverrideRequested} AND m.status = 'assigned')
           )
           AND EXISTS (
             SELECT 1 FROM full_curriculum_availability_versions av
              WHERE av.school_id = ${scope.schoolId}
                AND av.matching_record_id = m.id
                AND av.instructor_id = m.current_instructor_id
           )
           AND EXISTS (
             SELECT 1
               FROM full_curriculum_contract_events confirmation
              WHERE confirmation.school_id = e.school_id
                AND confirmation.attempt_id = p.attempt_id
                AND confirmation.event_type = 'durable_confirmation_delivered'
           )
           AND e.service_may_start_at IS NOT NULL
           AND ${startAt}::timestamptz >= e.service_may_start_at
           AND ${startAt}::timestamptz < e.original_first_test_at
         FOR UPDATE OF e, m
      ), boundaries AS (
        SELECT eligible.*,
               ${startAt}::timestamptz AS start_at,
               (
                 ((${startAt}::timestamptz AT TIME ZONE ${schoolTimezone}) + INTERVAL '24 weeks')
                 AT TIME ZONE ${schoolTimezone}
               ) AS cap_at
          FROM eligible
      ), started AS (
        UPDATE full_curriculum_enrolments e
           SET status = 'active',
               programme_start_at = boundaries.start_at,
               twenty_four_week_cap_at = boundaries.cap_at,
               base_entitlement_end_at = LEAST(
                 boundaries.original_first_test_at,
                 boundaries.cap_at
               ),
               approved_entitlement_end_at = LEAST(
                 boundaries.original_first_test_at,
                 boundaries.cap_at
               ),
               start_set_by_actor_type = ${scope.actorType},
               start_set_by_actor_id = ${scope.actor.id},
               start_set_at = NOW(),
               updated_at = NOW()
          FROM boundaries
         WHERE e.id = boundaries.id AND e.school_id = boundaries.school_id
        RETURNING e.*
      ), weeks AS (
        INSERT INTO full_curriculum_weekly_opportunities (
          school_id, enrolment_id, programme_week, week_start_at, week_end_at,
          opportunity_minutes, status
        )
        SELECT e.school_id, e.id, series.week_number + 1,
               (
                 ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + (series.week_number * INTERVAL '7 days'))
                 AT TIME ZONE ${schoolTimezone}
               ),
               LEAST(
                 (
                   ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + ((series.week_number + 1) * INTERVAL '7 days'))
                   AT TIME ZONE ${schoolTimezone}
                 ),
                 e.base_entitlement_end_at
               ),
               90, 'available'
          FROM started e
          CROSS JOIN generate_series(0, 23) AS series(week_number)
         WHERE (
           ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + (series.week_number * INTERVAL '7 days'))
           AT TIME ZONE ${schoolTimezone}
         ) < e.base_entitlement_end_at
        ON CONFLICT (school_id, enrolment_id, programme_week) DO NOTHING
        RETURNING id
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, phase_number, event_type, actor_type, actor_id, detail
        )
        SELECT e.school_id, e.id, e.current_phase, 'programme_started',
               ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object(
                 'programme_start_at', e.programme_start_at,
                 'base_entitlement_end_at', e.base_entitlement_end_at,
                 'matching_completed', true,
                 'instructor_id', ${instructorId}::integer,
                 'instructor_acceptance_overridden', (eligible.matching_status = 'assigned'),
                 'operational_timezone', ${schoolTimezone}::text,
                 'availability_recorded', true,
                 'reason', ${reason}::text,
                 'weekly_opportunities_created', (SELECT COUNT(*) FROM weeks)
               )
          FROM started e
          JOIN eligible ON eligible.id = e.id
        RETURNING enrolment_id
      ), matching_started AS (
        UPDATE full_curriculum_matching_records m
           SET status = 'started', started_at = NOW(), updated_at = NOW()
          FROM eligible, started
         WHERE m.id = eligible.matching_record_id
           AND m.school_id = eligible.school_id
           AND started.id = eligible.id
        RETURNING m.id
      )
      SELECT started.*, eligible.matching_status AS start_matching_status
        FROM started
        JOIN eligible ON eligible.id = started.id
        JOIN event ON event.enrolment_id = started.id
        JOIN matching_started ON TRUE
    `;
    if (!rows[0]) {
      return fail(res, 409, 'PROGRAMME_START_NOT_ALLOWED', 'The paid matching enrolment was not found, was already started, or the start falls outside its paid/test boundaries');
    }
    await audit(sql, req, scope, 'package.start_programme', 'full_curriculum_enrolment', enrolmentId, {
      programme_start_at: startAt,
      instructor_id: instructorId,
      instructor_acceptance_overridden: rows[0].start_matching_status === 'assigned',
      operational_timezone: schoolTimezone,
      reason,
      base_entitlement_end_at: rows[0].base_entitlement_end_at,
    });
    return res.status(201).json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=start-programme', err);
    return fail(res, 500, 'PROGRAMME_START_FAILED', 'Failed to start the programme');
  }
}

async function recordReadiness(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const instructorId = scope.actorType === 'instructor' ? scope.actor.id : positiveInteger(req.body?.instructor_id);
  const note = String(req.body?.note || '').trim();
  if (!enrolmentId || !instructorId || note.length > 1000) return fail(res, 400, 'INVALID_READINESS', 'Valid programme and teaching instructor are required');
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH eligible AS (
        SELECT e.id, e.current_phase
          FROM full_curriculum_enrolments e
          JOIN instructors i ON i.id = ${instructorId} AND i.school_id = ${scope.schoolId} AND i.active = TRUE
         WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
           AND e.status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
           AND EXISTS (
             SELECT 1 FROM full_curriculum_booking_allocations a
              WHERE a.school_id = ${scope.schoolId} AND a.enrolment_id = e.id
                AND a.instructor_id = ${instructorId} AND a.allocation_type = 'base_lesson'
           )
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, phase_number, event_type, actor_type, actor_id, detail
        )
        SELECT ${scope.schoolId}, id, current_phase, 'ready_for_assessment',
               ${scope.actorType}, ${scope.actor.id},
               ${JSON.stringify({ teaching_instructor_id: instructorId, note })}::jsonb
          FROM eligible
        RETURNING enrolment_id, phase_number
      )
      UPDATE full_curriculum_enrolments e
         SET status = 'assessment_pending', updated_at = NOW()
        FROM event
       WHERE e.id = event.enrolment_id AND e.school_id = ${scope.schoolId}
      RETURNING e.*
    `;
    if (!rows[0]) return fail(res, 409, 'READINESS_NOT_ALLOWED', 'The instructor is not an eligible same-school teaching instructor for this programme');
    await audit(sql, req, scope, 'package.record_readiness', 'full_curriculum_enrolment', enrolmentId, { instructor_id: instructorId, phase: rows[0].current_phase });
    return res.status(201).json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=record-readiness', err);
    return fail(res, 500, 'READINESS_RECORD_FAILED', 'Failed to record readiness');
  }
}

async function recordAssessment(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const teachingId = positiveInteger(req.body?.teaching_instructor_id);
  const assessorId = scope.actorType === 'instructor' ? scope.actor.id : positiveInteger(req.body?.assessor_instructor_id);
  const outcome = String(req.body?.outcome || '').trim();
  const improvement = String(req.body?.improvement_areas || '').trim();
  if (!enrolmentId || !teachingId || !assessorId || teachingId === assessorId || !['passed', 'improvement_required'].includes(outcome) || (outcome !== 'passed' && improvement.length < 2)) {
    return fail(res, 400, 'INVALID_ASSESSMENT', 'A different same-school assessor and valid outcome are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH eligible AS (
        SELECT e.id, e.current_phase
          FROM full_curriculum_enrolments e
          JOIN instructors teacher ON teacher.id = ${teachingId} AND teacher.school_id = ${scope.schoolId} AND teacher.active = TRUE
          JOIN instructors assessor ON assessor.id = ${assessorId} AND assessor.school_id = ${scope.schoolId} AND assessor.active = TRUE
         WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
           AND e.status = 'assessment_pending'
           AND EXISTS (
             SELECT 1 FROM full_curriculum_booking_allocations a
              WHERE a.school_id = ${scope.schoolId} AND a.enrolment_id = e.id
                AND a.instructor_id = ${teachingId} AND a.allocation_type = 'base_lesson'
           )
           AND EXISTS (
             SELECT 1 FROM full_curriculum_progress_events pe
              WHERE pe.school_id = ${scope.schoolId} AND pe.enrolment_id = e.id
                AND pe.phase_number = e.current_phase AND pe.event_type = 'ready_for_assessment'
                AND pe.detail->>'teaching_instructor_id' = ${String(teachingId)}
           )
      ), assessment AS (
        INSERT INTO full_curriculum_assessments (
          school_id, enrolment_id, phase_number, teaching_instructor_id,
          assessor_instructor_id, outcome, improvement_areas,
          recorded_by_actor_type, recorded_by_actor_id
        )
        SELECT ${scope.schoolId}, id, current_phase, ${teachingId}, ${assessorId},
               ${outcome}, ${improvement || null}, ${scope.actorType}, ${scope.actor.id}
          FROM eligible
        RETURNING *
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, phase_number, event_type, actor_type, actor_id, detail
        )
        SELECT school_id, enrolment_id, phase_number,
               CASE WHEN outcome = 'passed' THEN 'assessment_passed' ELSE 'assessment_not_passed' END,
               ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('assessment_id', id, 'teaching_instructor_id', teaching_instructor_id, 'assessor_instructor_id', assessor_instructor_id)
          FROM assessment
        RETURNING enrolment_id
      )
      UPDATE full_curriculum_enrolments e
         SET current_phase = CASE WHEN ${outcome} = 'passed' AND e.current_phase < 3 THEN e.current_phase + 1 ELSE e.current_phase END,
             status = 'active', updated_at = NOW()
        FROM event
       WHERE e.id = event.enrolment_id AND e.school_id = ${scope.schoolId}
      RETURNING e.*
    `;
    if (!rows[0]) return fail(res, 409, 'ASSESSMENT_NOT_ALLOWED', 'No matching same-school readiness state was found');
    await audit(sql, req, scope, 'package.record_assessment', 'full_curriculum_enrolment', enrolmentId, { teaching_instructor_id: teachingId, assessor_instructor_id: assessorId, outcome });
    return res.status(201).json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=record-assessment', err);
    return fail(res, 500, 'ASSESSMENT_RECORD_FAILED', 'Failed to record assessment');
  }
}

async function recordTestDateChange(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const cause = String(req.body?.cause || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const newTestAt = new Date(req.body?.new_test_at);
  if (!enrolmentId || !['learner_requested', 'dvsa', 'exceptional'].includes(cause) || reason.length < 2 || reason.length > 1000 || Number.isNaN(newTestAt.getTime())) {
    return fail(res, 400, 'INVALID_TEST_DATE_CHANGE', 'A valid test date, cause, and audit reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH previous AS (
        SELECT id, current_first_test_at FROM full_curriculum_enrolments
         WHERE id = ${enrolmentId} AND school_id = ${scope.schoolId}
         FOR UPDATE
      ), change AS (
        INSERT INTO full_curriculum_test_date_changes (
          school_id, enrolment_id, old_test_at, new_test_at, cause, reason,
          recorded_by_actor_type, recorded_by_admin_id
        )
        SELECT ${scope.schoolId}, id, current_first_test_at, ${newTestAt.toISOString()}::timestamptz,
               ${cause}, ${reason}, ${scope.actorType}, ${scope.actor.id}
          FROM previous WHERE current_first_test_at <> ${newTestAt.toISOString()}::timestamptz
        RETURNING enrolment_id, old_test_at, new_test_at
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, event_type, actor_type, actor_id, detail
        )
        SELECT ${scope.schoolId}, enrolment_id, 'test_date_changed', ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('cause', ${cause}, 'old_test_at', old_test_at, 'new_test_at', new_test_at, 'entitlement_extended', false)
          FROM change RETURNING enrolment_id
      )
      UPDATE full_curriculum_enrolments e
         SET current_first_test_at = ${newTestAt.toISOString()}::timestamptz, updated_at = NOW()
        FROM event
       WHERE e.id = event.enrolment_id AND e.school_id = ${scope.schoolId}
      RETURNING e.*
    `;
    if (!rows[0]) return fail(res, 409, 'TEST_DATE_CHANGE_NOT_RECORDED', 'Programme not found or date unchanged');
    await audit(sql, req, scope, 'package.record_test_date_change', 'full_curriculum_enrolment', enrolmentId, { cause, reason, new_test_at: newTestAt.toISOString(), entitlement_extended: false });
    return res.json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=record-test-date-change', err);
    return fail(res, 500, 'TEST_DATE_CHANGE_FAILED', 'Failed to record test-date change');
  }
}

async function recordExtension(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const reasonType = String(req.body?.reason_type || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const approvedEnd = new Date(req.body?.approved_end_at);
  if (!enrolmentId || !['dvsa_change', 'exceptional_circumstance', 'coachcarter_replacement'].includes(reasonType) || reason.length < 2 || reason.length > 1000 || Number.isNaN(approvedEnd.getTime())) {
    return fail(res, 400, 'INVALID_EXTENSION', 'A later end date and audited permitted reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = await sql`
      WITH previous AS (
        SELECT id, approved_entitlement_end_at FROM full_curriculum_enrolments
         WHERE id = ${enrolmentId} AND school_id = ${scope.schoolId}
           AND approved_entitlement_end_at < ${approvedEnd.toISOString()}::timestamptz
         FOR UPDATE
      ), extension AS (
        INSERT INTO full_curriculum_extensions (
          school_id, enrolment_id, previous_end_at, approved_end_at, reason_type,
          reason, approved_by_actor_type, approved_by_admin_id
        )
        SELECT ${scope.schoolId}, id, approved_entitlement_end_at,
               ${approvedEnd.toISOString()}::timestamptz, ${reasonType}, ${reason},
               ${scope.actorType}, ${scope.actor.id}
          FROM previous RETURNING *
      ), weeks AS (
        INSERT INTO full_curriculum_weekly_opportunities (
          school_id, enrolment_id, programme_week, week_start_at, week_end_at,
          opportunity_minutes, status
        )
        SELECT ${scope.schoolId}, e.id, series.week_number + 1,
               (
                 ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + (series.week_number * INTERVAL '7 days'))
                 AT TIME ZONE ${schoolTimezone}
               ),
               LEAST(
                 (
                   ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + ((series.week_number + 1) * INTERVAL '7 days'))
                   AT TIME ZONE ${schoolTimezone}
                 ),
                 extension.approved_end_at
               ),
               90, 'available'
          FROM extension
          JOIN full_curriculum_enrolments e
            ON e.id = extension.enrolment_id AND e.school_id = ${scope.schoolId}
          CROSS JOIN LATERAL generate_series(
            0,
            CEIL(EXTRACT(EPOCH FROM (extension.approved_end_at - e.programme_start_at)) / 604800)::integer + 1
          ) AS series(week_number)
         WHERE (
           ((e.programme_start_at AT TIME ZONE ${schoolTimezone}) + (series.week_number * INTERVAL '7 days'))
           AT TIME ZONE ${schoolTimezone}
         ) < extension.approved_end_at
        ON CONFLICT (school_id, enrolment_id, programme_week) DO NOTHING
        RETURNING id
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, event_type, actor_type, actor_id, detail
        )
        SELECT school_id, enrolment_id, 'extension_approved', ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('extension_id', id, 'reason_type', reason_type, 'approved_end_at', approved_end_at, 'additional_week_records', (SELECT COUNT(*) FROM weeks))
          FROM extension RETURNING enrolment_id
      )
      UPDATE full_curriculum_enrolments e
         SET approved_entitlement_end_at = ${approvedEnd.toISOString()}::timestamptz, updated_at = NOW()
        FROM event
       WHERE e.id = event.enrolment_id AND e.school_id = ${scope.schoolId}
      RETURNING e.*
    `;
    if (!rows[0]) return fail(res, 409, 'EXTENSION_NOT_ALLOWED', 'The programme was not found or the end date is not later');
    await audit(sql, req, scope, 'package.record_extension', 'full_curriculum_enrolment', enrolmentId, { reason_type: reasonType, reason, approved_end_at: approvedEnd.toISOString() });
    return res.status(201).json({ ok: true, enrolment: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=record-extension', err);
    return fail(res, 500, 'EXTENSION_RECORD_FAILED', 'Failed to record programme extension');
  }
}

async function recordWeekOutcome(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const weekId = positiveInteger(req.body?.weekly_opportunity_id);
  const outcome = weeklyCancellationOutcome({
    cancelledBy: String(req.body?.cancelled_by || '').trim(),
    noticeHours: Number(req.body?.notice_hours),
    replacementDelivered: req.body?.replacement_delivered === true,
  });
  const reason = String(req.body?.reason || '').trim();
  if (!weekId || outcome.opportunityStatus === 'manual_review' || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_WEEK_OUTCOME', 'A supported cancellation outcome and reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const rows = await sql`
      WITH changed AS (
        UPDATE full_curriculum_weekly_opportunities
           SET status = ${outcome.opportunityStatus}, status_reason = ${reason},
               updated_by_actor_type = ${scope.actorType}, updated_by_actor_id = ${scope.actor.id}, updated_at = NOW()
         WHERE id = ${weekId} AND school_id = ${scope.schoolId}
           AND status IN ('available', 'booked', 'replacement_required')
           AND (
             ${scope.actorType !== 'instructor'}
             OR EXISTS (
               SELECT 1 FROM full_curriculum_booking_allocations a
                WHERE a.school_id = ${scope.schoolId}
                  AND a.weekly_opportunity_id = full_curriculum_weekly_opportunities.id
                  AND a.instructor_id = ${scope.actor.id}
             )
           )
        RETURNING *
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, event_type, actor_type, actor_id, detail
        )
        SELECT school_id, enrolment_id, 'weekly_outcome', ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('weekly_opportunity_id', id, 'status', status, 'used', ${outcome.used}, 'may_extend', ${outcome.mayExtend})
          FROM changed RETURNING enrolment_id
      ) SELECT changed.* FROM changed JOIN event ON event.enrolment_id = changed.enrolment_id
    `;
    if (!rows[0]) return fail(res, 409, 'WEEK_OUTCOME_NOT_ALLOWED', 'The same-school weekly opportunity cannot be changed from its current state');
    await audit(sql, req, scope, 'package.record_week_outcome', 'full_curriculum_week', weekId, { status: outcome.opportunityStatus, reason });
    return res.json({ ok: true, weekly_opportunity: rows[0], policy: outcome });
  } catch (err) {
    reportError('/api/packages?action=record-week-outcome', err);
    return fail(res, 500, 'WEEK_OUTCOME_FAILED', 'Failed to record weekly outcome');
  }
}

async function activateRetake(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const secondBookingId = positiveInteger(req.body?.second_test_booking_id);
  const evidence = String(req.body?.failed_first_test_evidence || '').trim();
  if (!enrolmentId || !secondBookingId || evidence.length < 2 || evidence.length > 1000) {
    return fail(res, 400, 'INVALID_RETAKE_EVIDENCE', 'Failed-first-test evidence and a verified second-test booking are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = await sql`
      WITH eligible AS (
        SELECT e.id AS enrolment_id,
               (tb.test_date + tb.test_time) AT TIME ZONE ${schoolTimezone} AS second_test_at
          FROM full_curriculum_enrolments e
          JOIN full_curriculum_test_bookings tb
            ON tb.id = ${secondBookingId} AND tb.school_id = ${scope.schoolId}
           AND tb.learner_id = e.learner_id AND tb.attempt_number = 2
           AND tb.verification_status = 'verified'
         WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
           AND ((tb.test_date + tb.test_time) AT TIME ZONE ${schoolTimezone}) > NOW()
      ), allowance AS (
        INSERT INTO full_curriculum_retake_allowances (
          school_id, enrolment_id, second_test_booking_id, total_minutes,
          opens_at, expires_at, failed_first_test_evidence,
          activated_by_actor_type, activated_by_admin_id
        )
        SELECT ${scope.schoolId}, enrolment_id, ${secondBookingId}, 600,
               second_test_at - INTERVAL '28 days', second_test_at, ${evidence},
               ${scope.actorType}, ${scope.actor.id}
          FROM eligible
        ON CONFLICT (school_id, enrolment_id) DO NOTHING
        RETURNING *
      ), event AS (
        INSERT INTO full_curriculum_progress_events (
          school_id, enrolment_id, event_type, actor_type, actor_id, detail
        )
        SELECT school_id, enrolment_id, 'retake_activated', ${scope.actorType}, ${scope.actor.id},
               jsonb_build_object('allowance_id', id, 'opens_at', opens_at, 'expires_at', expires_at, 'total_minutes', total_minutes)
          FROM allowance RETURNING enrolment_id
      )
      UPDATE full_curriculum_enrolments e
         SET status = CASE WHEN r.opens_at <= NOW() THEN 'retake_active' ELSE 'retake_pending' END,
             updated_at = NOW()
        FROM allowance r, event
       WHERE e.id = r.enrolment_id AND e.school_id = ${scope.schoolId}
      RETURNING r.*, e.status AS enrolment_status
    `;
    if (!rows[0]) return fail(res, 409, 'RETAKE_NOT_ACTIVATED', 'Eligible evidence was not found or the retake allowance already exists');
    await audit(sql, req, scope, 'package.activate_retake', 'full_curriculum_enrolment', enrolmentId, { second_test_booking_id: secondBookingId });
    return res.status(201).json({ ok: true, retake: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=activate-retake', err);
    return fail(res, 500, 'RETAKE_ACTIVATION_FAILED', 'Failed to activate retake allowance');
  }
}

async function recordRetakeTestChange(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const secondBookingId = positiveInteger(req.body?.second_test_booking_id);
  const cause = String(req.body?.cause || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!enrolmentId || !secondBookingId || !['dvsa', 'exceptional'].includes(cause) || reason.length < 2 || reason.length > 1000) {
    return fail(res, 400, 'INVALID_RETAKE_TEST_CHANGE', 'A verified replacement second-test booking and audited reason are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = await sql`
      WITH current_window AS (
        SELECT r.id AS allowance_id, r.enrolment_id,
               COALESCE(last.new_opens_at, r.opens_at) AS opens_at,
               COALESCE(last.new_expires_at, r.expires_at) AS expires_at,
               e.learner_id
          FROM full_curriculum_retake_allowances r
          JOIN full_curriculum_enrolments e
            ON e.id = r.enrolment_id AND e.school_id = ${scope.schoolId}
          LEFT JOIN LATERAL (
            SELECT w.new_opens_at, w.new_expires_at
              FROM full_curriculum_retake_window_events w
             WHERE w.school_id = ${scope.schoolId} AND w.allowance_id = r.id
             ORDER BY w.id DESC LIMIT 1
          ) last ON TRUE
         WHERE r.school_id = ${scope.schoolId} AND r.enrolment_id = ${enrolmentId}
         FOR UPDATE OF r
      ), replacement AS (
        SELECT tb.id, (tb.test_date + tb.test_time) AT TIME ZONE ${schoolTimezone} AS test_at
          FROM full_curriculum_test_bookings tb
          JOIN current_window cw ON cw.learner_id = tb.learner_id
         WHERE tb.id = ${secondBookingId} AND tb.school_id = ${scope.schoolId}
           AND tb.attempt_number = 2 AND tb.verification_status = 'verified'
            AND ((tb.test_date + tb.test_time) AT TIME ZONE ${schoolTimezone}) > NOW()
      ), event AS (
        INSERT INTO full_curriculum_retake_window_events (
          school_id, allowance_id, new_second_test_booking_id,
          previous_opens_at, previous_expires_at, new_opens_at, new_expires_at,
          cause, reason, recorded_by_actor_type, recorded_by_admin_id
        )
        SELECT ${scope.schoolId}, cw.allowance_id, replacement.id,
               cw.opens_at, cw.expires_at, replacement.test_at - INTERVAL '28 days',
               replacement.test_at, ${cause}, ${reason}, ${scope.actorType}, ${scope.actor.id}
          FROM current_window cw CROSS JOIN replacement
         WHERE replacement.test_at <> cw.expires_at
        RETURNING *
      ) SELECT * FROM event
    `;
    if (!rows[0]) return fail(res, 409, 'RETAKE_TEST_CHANGE_NOT_RECORDED', 'No eligible same-school retake or verified changed date was found');
    await audit(sql, req, scope, 'package.record_retake_test_change', 'full_curriculum_enrolment', enrolmentId, { second_test_booking_id: secondBookingId, cause, reason });
    return res.status(201).json({ ok: true, retake_window_event: rows[0] });
  } catch (err) {
    reportError('/api/packages?action=record-retake-test-change', err);
    return fail(res, 500, 'RETAKE_TEST_CHANGE_FAILED', 'Failed to record retake test-date change');
  }
}

async function allocateBooking(req, res) {
  if (!requirePost(req, res)) return;
  const scope = scopeFor(req, res, ['instructor', 'admin']);
  if (!scope) return;
  const enrolmentId = positiveInteger(req.body?.enrolment_id);
  const bookingId = positiveInteger(req.body?.lesson_booking_id);
  const weekId = positiveInteger(req.body?.weekly_opportunity_id);
  const type = String(req.body?.allocation_type || '').trim();
  if (!enrolmentId || !bookingId || !['base_lesson', 'retake_lesson'].includes(type) || (type === 'base_lesson' && !weekId)) {
    return fail(res, 400, 'INVALID_PROGRAMME_ALLOCATION', 'A programme, booking, and valid allocation type are required');
  }
  const sql = neon(process.env.POSTGRES_URL);
  try {
    const schoolTimezone = await loadSchoolTimezone(sql, scope.schoolId);
    const rows = type === 'base_lesson'
      ? await sql`
          WITH eligible AS (
            SELECT e.id AS enrolment_id, w.id AS week_id, b.id AS booking_id,
                   b.instructor_id,
                   (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int AS minutes
              FROM full_curriculum_enrolments e
              JOIN full_curriculum_weekly_opportunities w
                ON w.id = ${weekId} AND w.school_id = ${scope.schoolId} AND w.enrolment_id = e.id
              JOIN lesson_bookings b
                ON b.id = ${bookingId} AND b.school_id = ${scope.schoolId} AND b.learner_id = e.learner_id
              JOIN instructors i ON i.id = b.instructor_id AND i.school_id = ${scope.schoolId} AND i.active = TRUE
             WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
               AND (${scope.actorType !== 'instructor'} OR b.instructor_id = ${scope.actor.id})
               AND (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int = 90
               AND ((b.scheduled_date + b.start_time) AT TIME ZONE ${schoolTimezone}) >= w.week_start_at
               AND ((b.scheduled_date + b.start_time) AT TIME ZONE ${schoolTimezone}) < w.week_end_at
          ), allocation AS (
            INSERT INTO full_curriculum_booking_allocations (
              school_id, enrolment_id, weekly_opportunity_id, lesson_booking_id,
              instructor_id, allocation_type, allocated_minutes,
              created_by_actor_type, created_by_actor_id
            )
            SELECT ${scope.schoolId}, enrolment_id, week_id, booking_id, instructor_id,
                   'base_lesson', minutes, ${scope.actorType}, ${scope.actor.id}
              FROM eligible
            ON CONFLICT (school_id, lesson_booking_id) DO NOTHING
            RETURNING *
          )
          UPDATE full_curriculum_weekly_opportunities w
             SET status = 'booked', updated_by_actor_type = ${scope.actorType},
                 updated_by_actor_id = ${scope.actor.id}, updated_at = NOW()
            FROM allocation a
           WHERE w.id = a.weekly_opportunity_id AND w.school_id = ${scope.schoolId}
          RETURNING a.*`
      : await sql`
          WITH eligible AS (
            SELECT e.id AS enrolment_id, r.id AS allowance_id, b.id AS booking_id,
                   b.instructor_id,
                   (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int AS minutes
              FROM full_curriculum_enrolments e
              JOIN full_curriculum_retake_allowances r
                ON r.enrolment_id = e.id AND r.school_id = ${scope.schoolId}
              LEFT JOIN LATERAL (
                SELECT w.new_opens_at, w.new_expires_at
                  FROM full_curriculum_retake_window_events w
                 WHERE w.school_id = ${scope.schoolId} AND w.allowance_id = r.id
                 ORDER BY w.id DESC LIMIT 1
              ) retake_window ON TRUE
              JOIN lesson_bookings b
                ON b.id = ${bookingId} AND b.school_id = ${scope.schoolId} AND b.learner_id = e.learner_id
              JOIN instructors i ON i.id = b.instructor_id AND i.school_id = ${scope.schoolId} AND i.active = TRUE
             WHERE e.id = ${enrolmentId} AND e.school_id = ${scope.schoolId}
               AND (${scope.actorType !== 'instructor'} OR b.instructor_id = ${scope.actor.id})
               AND (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int IN (90, 120)
               AND ((b.scheduled_date + b.start_time) AT TIME ZONE ${schoolTimezone}) >= COALESCE(retake_window.new_opens_at, r.opens_at)
               AND ((b.scheduled_date + b.start_time) AT TIME ZONE ${schoolTimezone}) < COALESCE(retake_window.new_expires_at, r.expires_at)
             FOR UPDATE OF r
          ), allocation AS (
            INSERT INTO full_curriculum_booking_allocations (
              school_id, enrolment_id, lesson_booking_id, instructor_id,
              allocation_type, allocated_minutes, created_by_actor_type, created_by_actor_id
            )
            SELECT ${scope.schoolId}, enrolment_id, booking_id, instructor_id,
                   'retake_lesson', minutes, ${scope.actorType}, ${scope.actor.id}
              FROM eligible
            ON CONFLICT (school_id, lesson_booking_id) DO NOTHING
            RETURNING *
          ), movement AS (
            INSERT INTO full_curriculum_retake_movements (
              school_id, allowance_id, booking_allocation_id, movement_type, minutes
            )
            SELECT ${scope.schoolId}, w.allowance_id, a.id, 'consume', a.allocated_minutes
              FROM allocation a JOIN eligible w ON w.enrolment_id = a.enrolment_id
            RETURNING *
          ), event AS (
            INSERT INTO full_curriculum_progress_events (
              school_id, enrolment_id, event_type, actor_type, actor_id, detail
            )
            SELECT a.school_id, a.enrolment_id, 'retake_consumed', ${scope.actorType}, ${scope.actor.id},
                   jsonb_build_object('booking_allocation_id', a.id, 'minutes', a.allocated_minutes)
              FROM allocation a JOIN movement m ON m.booking_allocation_id = a.id
            RETURNING enrolment_id
          ) SELECT a.* FROM allocation a JOIN event e ON e.enrolment_id = a.enrolment_id`;
    if (!rows[0]) return fail(res, 409, 'PROGRAMME_ALLOCATION_NOT_ALLOWED', 'Booking, instructor, week/window, duration, learner, or remaining allowance did not match');
    await audit(sql, req, scope, 'package.allocate_programme_booking', 'lesson_booking', bookingId, { enrolment_id: enrolmentId, allocation_type: type });
    return res.status(201).json({ ok: true, allocation: rows[0] });
  } catch (err) {
    if (err?.constraint === 'full_curriculum_retake_usage_cap') {
      return fail(res, 409, 'RETAKE_ALLOWANCE_EXCEEDED', 'The 10-hour retake allowance does not have enough time remaining');
    }
    reportError('/api/packages?action=allocate-programme-booking', err);
    return fail(res, 500, 'PROGRAMME_ALLOCATION_FAILED', 'Failed to allocate the programme booking');
  }
}

async function handleFullCurriculumAction(req, res) {
  const action = req.query?.action;
  if (!ACTIONS.has(action)) return false;
  if (action === 'submit-test-booking') await submitTestBooking(req, res);
  else if (action === 'test-bookings') await listTestBookings(req, res);
  else if (action === 'verify-test-booking') await verifyTestBooking(req, res);
  else if (action === 'programme-status') await programmeStatus(req, res);
  else if (action === 'programme-list') await programmeList(req, res);
  else if (action === 'programme-refund-cases') await programmeRefundCases(req, res);
  else if (action === 'request-programme-termination') await requestProgrammeTerminationAction(req, res);
  else if (action === 'review-programme-refund') await reviewProgrammeRefund(req, res);
  else if (action === 'approve-programme-refund') await approveProgrammeRefund(req, res);
  else if (action === 'record-programme-refund-result') await recordProgrammeRefundResult(req, res);
  else if (action === 'programme-pilot-access') await programmePilotAccess(req, res);
  else if (action === 'grant-programme-pilot-access') await grantProgrammePilotAccess(req, res);
  else if (action === 'revoke-programme-pilot-access') await revokeProgrammePilotAccess(req, res);
  else if (action === 'release-cooling-off-hold') await releaseCoolingOffHold(req, res);
  else if (action === 'assign-instructor') await assignInstructor(req, res);
  else if (action === 'accept-assignment') await acceptAssignment(req, res);
  else if (action === 'record-programme-availability') await recordProgrammeAvailability(req, res);
  else if (action === 'start-programme') await startProgramme(req, res);
  else if (action === 'record-readiness') await recordReadiness(req, res);
  else if (action === 'record-assessment') await recordAssessment(req, res);
  else if (action === 'record-test-date-change') await recordTestDateChange(req, res);
  else if (action === 'record-extension') await recordExtension(req, res);
  else if (action === 'record-week-outcome') await recordWeekOutcome(req, res);
  else if (action === 'activate-retake') await activateRetake(req, res);
  else if (action === 'record-retake-test-change') await recordRetakeTestChange(req, res);
  else if (action === 'allocate-programme-booking') await allocateBooking(req, res);
  return true;
}

module.exports = { ACTIONS, handleFullCurriculumAction };
