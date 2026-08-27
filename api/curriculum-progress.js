const { neon } = require('@neondatabase/serverless');
const { requireAuth } = require('./_auth');
const { reportError } = require('./_error-alert');
const { withNeonTransaction } = require('./_db-transaction');
const { SCHEDULED, CHARGEABLE, BLOCKING_STATUSES } = require('./_booking-status');
const {
  loadCurriculumProgressBetaState,
  validateInstructorSubmission,
  validateLearnerSubmission,
  isBookingReviewable,
} = require('./_curriculum-progress');

function clientSqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const result = await client.query(text, values);
    return result.rows || [];
  };
}

function sendError(res, status, code, error) {
  return res.status(status).json({ ok: false, code, error });
}

async function actorFor(req, role) {
  return requireAuth(req, { roles: [role], requireSchool: true });
}

async function enabledFor(sql, actor) {
  return actor && Number.isInteger(Number(actor.school_id))
    ? loadCurriculumProgressBetaState(sql, Number(actor.school_id))
    : false;
}

async function loadOwnedBooking(sql, { schoolId, bookingId, instructorId = null, learnerId = null }) {
  if (instructorId) {
    const [booking] = await sql`
      SELECT lb.id, lb.school_id, lb.learner_id, lb.instructor_id, lb.status,
             COALESCE(lb.credit_forfeited, false) AS credit_forfeited,
             lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
             (lb.scheduled_date + lb.end_time) AS lesson_ended_at,
             lu.name AS learner_name, i.name AS instructor_name,
             lt.name AS lesson_type_name
      FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = ${schoolId}
      JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = ${schoolId}
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND lt.school_id = ${schoolId}
      WHERE lb.id = ${bookingId}
        AND lb.school_id = ${schoolId}
        AND lb.instructor_id = ${instructorId}
    `;
    return booking || null;
  }
  const [booking] = await sql`
    SELECT lb.id, lb.school_id, lb.learner_id, lb.instructor_id, lb.status,
           COALESCE(lb.credit_forfeited, false) AS credit_forfeited,
           lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
           (lb.scheduled_date + lb.end_time) AS lesson_ended_at,
           lu.name AS learner_name, i.name AS instructor_name,
           lt.name AS lesson_type_name
    FROM lesson_bookings lb
    JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = ${schoolId}
    JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = ${schoolId}
    LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND lt.school_id = ${schoolId}
    WHERE lb.id = ${bookingId}
      AND lb.school_id = ${schoolId}
      AND lb.learner_id = ${learnerId}
  `;
  return booking || null;
}

async function loadReviewState(sql, schoolId, booking) {
  const [instructorSubmission] = await sql`
    SELECT id, note, submitted_at
    FROM curriculum_review_submissions
    WHERE school_id = ${schoolId} AND booking_id = ${booking.id} AND assessor_role = 'instructor'
    ORDER BY submitted_at DESC, id DESC LIMIT 1
  `;
  const [learnerSubmission] = await sql`
    SELECT id, note, submitted_at
    FROM curriculum_review_submissions
    WHERE school_id = ${schoolId} AND booking_id = ${booking.id} AND assessor_role = 'learner'
    ORDER BY submitted_at DESC, id DESC LIMIT 1
  `;
  const instructorRatings = instructorSubmission ? await sql`
    SELECT curriculum_item_key AS item_key, score, note, assessed_at
    FROM curriculum_rating_events
    WHERE school_id = ${schoolId} AND submission_id = ${instructorSubmission.id}
    ORDER BY id
  ` : [];
  const learnerRatings = learnerSubmission ? await sql`
    SELECT curriculum_item_key AS item_key, score, note, assessed_at
    FROM curriculum_rating_events
    WHERE school_id = ${schoolId} AND submission_id = ${learnerSubmission.id}
    ORDER BY id
  ` : [];
  const completions = await sql`
    SELECT curriculum_item_key AS item_key, completed_at, completed_by_instructor_id, booking_id
    FROM curriculum_completion_events
    WHERE school_id = ${schoolId} AND learner_id = ${booking.learner_id}
    ORDER BY completed_at, id
  `;
  return {
    booking,
    reviewable: isBookingReviewable(booking),
    instructor_submission: instructorSubmission || null,
    instructor_ratings: instructorRatings,
    learner_submission: learnerSubmission || null,
    learner_ratings: learnerRatings,
    completions,
  };
}

async function handleFeatureState(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = requireAuth(req, { roles: ['instructor', 'learner'], requireSchool: true });
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const sql = neon(process.env.POSTGRES_URL);
  return res.json({ ok: true, enabled: await enabledFor(sql, actor) });
}

async function handleReviewsDue(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = await actorFor(req, 'instructor');
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const schoolId = Number(actor.school_id);
  const sql = neon(process.env.POSTGRES_URL);
  if (!await enabledFor(sql, actor)) return res.json({ ok: true, enabled: false, reviews: [] });
  const reviews = await sql`
    SELECT lb.id AS booking_id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
           lu.id AS learner_id, lu.name AS learner_name, lt.name AS lesson_type_name
    FROM lesson_bookings lb
    JOIN learner_users lu ON lu.id = lb.learner_id AND lu.school_id = ${schoolId}
    LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id AND lt.school_id = ${schoolId}
    WHERE lb.school_id = ${schoolId}
      AND lb.instructor_id = ${actor.id}
      AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
      AND COALESCE(lb.credit_forfeited, false) = false
      AND (lb.scheduled_date + lb.end_time) <= NOW()
      AND NOT EXISTS (
        SELECT 1 FROM curriculum_review_submissions crs
        WHERE crs.school_id = ${schoolId}
          AND crs.booking_id = lb.id
          AND crs.assessor_role = 'instructor'
      )
    ORDER BY lb.scheduled_date DESC, lb.start_time DESC
    LIMIT 100
  `;
  return res.json({ ok: true, enabled: true, reviews });
}

async function handleReview(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = await actorFor(req, 'instructor');
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const schoolId = Number(actor.school_id);
  const bookingId = Number(req.query.booking_id);
  if (!Number.isInteger(bookingId)) return sendError(res, 400, 'INVALID_BOOKING', 'A valid booking is required');
  const sql = neon(process.env.POSTGRES_URL);
  if (!await enabledFor(sql, actor)) return sendError(res, 404, 'FEATURE_DISABLED', 'Curriculum progress beta is not enabled');
  const booking = await loadOwnedBooking(sql, { schoolId, bookingId, instructorId: actor.id });
  if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return res.json({ ok: true, enabled: true, ...(await loadReviewState(sql, schoolId, booking)) });
}

async function handleReflectionDue(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = await actorFor(req, 'learner');
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const schoolId = Number(actor.school_id);
  const sql = neon(process.env.POSTGRES_URL);
  if (!await enabledFor(sql, actor)) return res.json({ ok: true, enabled: false, reviews: [] });
  const reviews = await sql`
    WITH latest_instructor AS (
      SELECT DISTINCT ON (booking_id) id, booking_id, submitted_at
      FROM curriculum_review_submissions
      WHERE school_id = ${schoolId} AND learner_id = ${actor.id} AND assessor_role = 'instructor'
      ORDER BY booking_id, submitted_at DESC, id DESC
    ), latest_learner AS (
      SELECT DISTINCT ON (booking_id) id, booking_id, submitted_at
      FROM curriculum_review_submissions
      WHERE school_id = ${schoolId} AND learner_id = ${actor.id} AND assessor_role = 'learner'
      ORDER BY booking_id, submitted_at DESC, id DESC
    )
    SELECT lb.id AS booking_id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
           i.name AS instructor_name,
           COUNT(cre.id)::int AS skill_count
    FROM latest_instructor ins
    JOIN lesson_bookings lb ON lb.id = ins.booking_id AND lb.school_id = ${schoolId}
    JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = ${schoolId}
    LEFT JOIN latest_learner lr ON lr.booking_id = ins.booking_id
    JOIN curriculum_rating_events cre ON cre.submission_id = ins.id AND cre.school_id = ${schoolId}
    WHERE lb.learner_id = ${actor.id}
      AND lb.status = ANY(${BLOCKING_STATUSES}::text[])
      AND COALESCE(lb.credit_forfeited, false) = false
      AND (lr.id IS NULL OR lr.submitted_at < ins.submitted_at)
    GROUP BY lb.id, i.name, ins.submitted_at
    ORDER BY ins.submitted_at DESC
    LIMIT 20
  `;
  return res.json({ ok: true, enabled: true, reviews });
}

async function handleReflection(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = await actorFor(req, 'learner');
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const schoolId = Number(actor.school_id);
  const bookingId = Number(req.query.booking_id);
  if (!Number.isInteger(bookingId)) return sendError(res, 400, 'INVALID_BOOKING', 'A valid booking is required');
  const sql = neon(process.env.POSTGRES_URL);
  if (!await enabledFor(sql, actor)) return sendError(res, 404, 'FEATURE_DISABLED', 'Curriculum progress beta is not enabled');
  const booking = await loadOwnedBooking(sql, { schoolId, bookingId, learnerId: actor.id });
  if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
  const state = await loadReviewState(sql, schoolId, booking);
  if (!state.instructor_submission) return sendError(res, 409, 'INSTRUCTOR_REVIEW_REQUIRED', 'Your instructor has not submitted this review yet');
  return res.json({ ok: true, enabled: true, ...state });
}

async function saveSubmission({ actor, role, body }) {
  const schoolId = Number(actor.school_id);
  return withNeonTransaction(process.env.POSTGRES_URL, async (client) => {
    const sql = clientSqlTag(client);
    if (!await loadCurriculumProgressBetaState(sql, schoolId)) {
      return { error: { status: 404, code: 'FEATURE_DISABLED', error: 'Curriculum progress beta is not enabled' } };
    }
    const bookingId = Number(body.booking_id);
    const booking = await loadOwnedBooking(sql, role === 'instructor'
      ? { schoolId, bookingId, instructorId: actor.id }
      : { schoolId, bookingId, learnerId: actor.id });
    if (!booking) return { error: { status: 404, code: 'BOOKING_NOT_FOUND', error: 'Booking not found' } };
    if (!isBookingReviewable(booking)) {
      return { error: { status: 409, code: 'BOOKING_NOT_REVIEWABLE', error: 'This lesson is not eligible for review' } };
    }

    let validated;
    if (role === 'instructor') {
      validated = validateInstructorSubmission(body);
    } else {
      const [latestInstructor] = await sql`
        SELECT id FROM curriculum_review_submissions
        WHERE school_id = ${schoolId} AND booking_id = ${bookingId} AND assessor_role = 'instructor'
        ORDER BY submitted_at DESC, id DESC LIMIT 1
      `;
      if (!latestInstructor) {
        return { error: { status: 409, code: 'INSTRUCTOR_REVIEW_REQUIRED', error: 'Your instructor has not submitted this review yet' } };
      }
      const selected = await sql`
        SELECT curriculum_item_key FROM curriculum_rating_events
        WHERE school_id = ${schoolId} AND submission_id = ${latestInstructor.id}
      `;
      validated = validateLearnerSubmission(body, new Set(selected.map((row) => row.curriculum_item_key)));
    }
    if (!validated.ok) return { error: { status: 400, code: validated.code, error: validated.error } };

    const sessions = await sql`
      INSERT INTO driving_sessions (
        user_id, session_date, duration_minutes, session_type, notes, booking_id, school_id
      ) VALUES (
        ${booking.learner_id}, ${booking.scheduled_date}::date,
        GREATEST(1, EXTRACT(EPOCH FROM (${booking.end_time}::time - ${booking.start_time}::time)) / 60)::int,
        'instructor', NULL, ${booking.id}, ${schoolId}
      )
      ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL
      DO UPDATE SET booking_id = EXCLUDED.booking_id
      RETURNING id
    `;
    const sessionId = sessions[0].id;
    const submissions = await sql`
      INSERT INTO curriculum_review_submissions (
        school_id, session_id, booking_id, learner_id, instructor_id,
        assessor_role, client_request_id, note
      ) VALUES (
        ${schoolId}, ${sessionId}, ${booking.id}, ${booking.learner_id}, ${booking.instructor_id},
        ${role}, ${validated.client_request_id}, ${validated.note}
      )
      ON CONFLICT (school_id, assessor_role, client_request_id)
      DO UPDATE SET client_request_id = EXCLUDED.client_request_id
      RETURNING id, booking_id, (xmax = 0) AS created_now
    `;
    const submission = submissions[0];
    if (Number(submission.booking_id) !== Number(booking.id)) {
      return { error: { status: 409, code: 'REQUEST_ID_REUSED', error: 'Request id was already used for another booking' } };
    }
    if (!submission.created_now) return { ok: true, duplicate: true, submission_id: submission.id, booking_id: booking.id };

    for (const rating of validated.ratings) {
      await sql`
        INSERT INTO curriculum_rating_events (
          school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
          curriculum_item_key, assessor_role, score, note
        ) VALUES (
          ${schoolId}, ${submission.id}, ${sessionId}, ${booking.id}, ${booking.learner_id}, ${booking.instructor_id},
          ${rating.item_key}, ${role}, ${rating.score}, ${rating.note}
        )
      `;
    }
    if (role === 'instructor') {
      for (const itemKey of validated.completions) {
        await sql`
          INSERT INTO curriculum_completion_events (
            school_id, learner_id, curriculum_item_key, completed_by_instructor_id, session_id, booking_id
          ) VALUES (${schoolId}, ${booking.learner_id}, ${itemKey}, ${actor.id}, ${sessionId}, ${booking.id})
          ON CONFLICT (school_id, learner_id, curriculum_item_key) DO NOTHING
        `;
      }
    }
    return { ok: true, duplicate: false, submission_id: submission.id, booking_id: booking.id };
  });
}

async function handleSubmit(req, res, role) {
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = await actorFor(req, role);
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const preliminary = role === 'instructor' ? validateInstructorSubmission(req.body) : null;
  if (preliminary && !preliminary.ok) return sendError(res, 400, preliminary.code, preliminary.error);
  const result = await saveSubmission({ actor, role, body: req.body || {} });
  if (result.error) return sendError(res, result.error.status, result.error.code, result.error.error);
  return res.json(result);
}

async function handleProgress(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const actor = requireAuth(req, { roles: ['instructor', 'learner'], requireSchool: true });
  if (!actor) return sendError(res, 401, 'UNAUTHORISED', 'Unauthorised');
  const schoolId = Number(actor.school_id);
  const sql = neon(process.env.POSTGRES_URL);
  if (!await enabledFor(sql, actor)) return res.json({ ok: true, enabled: false, ratings: [], completions: [], history: [] });
  const learnerId = actor.role === 'learner' ? Number(actor.id) : Number(req.query.learner_id);
  if (!Number.isInteger(learnerId)) return sendError(res, 400, 'INVALID_LEARNER', 'A valid learner is required');
  if (actor.role === 'instructor') {
    const [relationship] = await sql`
      SELECT 1 FROM lesson_bookings
      WHERE school_id = ${schoolId} AND learner_id = ${learnerId} AND instructor_id = ${actor.id}
      LIMIT 1
    `;
    if (!relationship) return sendError(res, 404, 'LEARNER_NOT_FOUND', 'Learner not found');
  }
  const viewerInstructorId = actor.role === 'instructor' ? Number(actor.id) : null;
  const ratings = await sql`
    SELECT DISTINCT ON (curriculum_item_key, assessor_role)
           curriculum_item_key AS item_key, assessor_role, score, note, assessed_at, booking_id
    FROM curriculum_rating_events
    WHERE school_id = ${schoolId} AND learner_id = ${learnerId}
      AND (${viewerInstructorId}::int IS NULL OR instructor_id = ${viewerInstructorId})
    ORDER BY curriculum_item_key, assessor_role, assessed_at DESC, id DESC
  `;
  const completions = await sql`
    SELECT c.curriculum_item_key AS item_key, c.completed_at, c.booking_id,
           i.name AS completed_by
    FROM curriculum_completion_events c
    JOIN instructors i ON i.id = c.completed_by_instructor_id AND i.school_id = ${schoolId}
    WHERE c.school_id = ${schoolId} AND c.learner_id = ${learnerId}
      AND (${viewerInstructorId}::int IS NULL OR c.completed_by_instructor_id = ${viewerInstructorId})
    ORDER BY c.completed_at DESC, c.id DESC
  `;
  const history = await sql`
    SELECT e.curriculum_item_key AS item_key, e.assessor_role, e.score, e.note, e.assessed_at,
           e.booking_id, lb.scheduled_date::text, i.name AS instructor_name,
           s.note AS submission_note
    FROM curriculum_rating_events e
    JOIN curriculum_review_submissions s ON s.id = e.submission_id AND s.school_id = ${schoolId}
    JOIN lesson_bookings lb ON lb.id = e.booking_id AND lb.school_id = ${schoolId}
    JOIN instructors i ON i.id = e.instructor_id AND i.school_id = ${schoolId}
    WHERE e.school_id = ${schoolId} AND e.learner_id = ${learnerId}
      AND (${viewerInstructorId}::int IS NULL OR e.instructor_id = ${viewerInstructorId})
    ORDER BY e.assessed_at DESC, e.id DESC
    LIMIT 500
  `;
  return res.json({ ok: true, enabled: true, learner_id: learnerId, ratings, completions, history });
}

module.exports = async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'feature-state') return await handleFeatureState(req, res);
    if (action === 'reviews-due') return await handleReviewsDue(req, res);
    if (action === 'review') return await handleReview(req, res);
    if (action === 'submit-instructor-review') return await handleSubmit(req, res, 'instructor');
    if (action === 'reflection-due') return await handleReflectionDue(req, res);
    if (action === 'reflection') return await handleReflection(req, res);
    if (action === 'submit-learner-reflection') return await handleSubmit(req, res, 'learner');
    if (action === 'progress') return await handleProgress(req, res);
    return sendError(res, 400, 'UNKNOWN_ACTION', 'Unknown action');
  } catch (err) {
    console.error('curriculum-progress error:', err);
    reportError('/api/curriculum-progress', err);
    return sendError(res, 500, 'CURRICULUM_PROGRESS_FAILED', 'Curriculum progress is temporarily unavailable');
  }
};

module.exports._test = {
  loadOwnedBooking,
  loadReviewState,
  saveSubmission,
  clientSqlTag,
};
