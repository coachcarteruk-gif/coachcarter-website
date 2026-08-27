const competency = require('../public/competency-config');
const { SCHEDULED, CHARGEABLE } = require('./_booking-status');

const FEATURE_KEY = 'curriculum_progress_beta';
const SCORE_VALUES = new Set([1, 2, 3]);
const ITEM_BY_KEY = new Map(competency.CURRICULUM_ITEMS.map((item) => [item.key, item]));

function isCurriculumProgressBetaEnabled(config) {
  return config?.features?.[FEATURE_KEY] === true;
}

async function loadCurriculumProgressBetaState(sql, schoolId) {
  const [school] = await sql`
    SELECT config
    FROM schools
    WHERE id = ${schoolId}
  `;
  return isCurriculumProgressBetaEnabled(school?.config);
}

function cleanNote(value, maxLength = 1000) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const note = value.trim().replace(/\s+/g, ' ');
  return note ? note.slice(0, maxLength) : null;
}

function validClientRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function validateRatings(ratings, { allowedKeys = null, requireAllAllowed = false } = {}) {
  if (!Array.isArray(ratings) || ratings.length === 0 || ratings.length > 51) {
    return { ok: false, code: 'INVALID_RATINGS', error: 'Select at least one practised skill.' };
  }
  const seen = new Set();
  const cleaned = [];
  for (const row of ratings) {
    const itemKey = typeof row?.item_key === 'string' ? row.item_key.trim() : '';
    const item = ITEM_BY_KEY.get(itemKey);
    const score = Number(row?.score);
    if (!item || item.assessmentType !== 'score') {
      return { ok: false, code: 'INVALID_CURRICULUM_ITEM', error: 'A selected curriculum item is not scoreable.' };
    }
    if (seen.has(itemKey)) {
      return { ok: false, code: 'DUPLICATE_CURRICULUM_ITEM', error: 'Each skill can be rated once per submission.' };
    }
    if (!SCORE_VALUES.has(score)) {
      return { ok: false, code: 'INVALID_SCORE', error: 'Scores must be 1, 2 or 3.' };
    }
    if (allowedKeys && !allowedKeys.has(itemKey)) {
      return { ok: false, code: 'SKILL_NOT_SELECTED_BY_INSTRUCTOR', error: 'You can rate only skills selected by your instructor.' };
    }
    seen.add(itemKey);
    cleaned.push({ item_key: itemKey, score, note: cleanNote(row.note, 500) });
  }
  if (requireAllAllowed && (seen.size !== allowedKeys.size || [...allowedKeys].some((key) => !seen.has(key)))) {
    return { ok: false, code: 'INCOMPLETE_REFLECTION', error: 'Rate every skill shown for this lesson.' };
  }
  return { ok: true, ratings: cleaned };
}

function validateCompletionKeys(keys) {
  if (keys == null) return { ok: true, completions: [] };
  if (!Array.isArray(keys) || keys.length > 10) {
    return { ok: false, code: 'INVALID_COMPLETIONS', error: 'Completion checks are invalid.' };
  }
  const seen = new Set();
  const completions = [];
  for (const rawKey of keys) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    const item = ITEM_BY_KEY.get(key);
    if (!item || item.assessmentType !== 'completion') {
      return { ok: false, code: 'INVALID_COMPLETION_ITEM', error: 'Only completion checks can be marked done.' };
    }
    if (!seen.has(key)) completions.push(key);
    seen.add(key);
  }
  return { ok: true, completions };
}

function validateInstructorSubmission(body) {
  if (!validClientRequestId(body?.client_request_id)) {
    return { ok: false, code: 'INVALID_REQUEST_ID', error: 'A valid request id is required.' };
  }
  const bookingId = Number(body?.booking_id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return { ok: false, code: 'INVALID_BOOKING', error: 'A valid booking is required.' };
  }
  const ratings = validateRatings(body?.ratings);
  if (!ratings.ok) return ratings;
  const completions = validateCompletionKeys(body?.completions);
  if (!completions.ok) return completions;
  return {
    ok: true,
    booking_id: bookingId,
    client_request_id: body.client_request_id,
    ratings: ratings.ratings,
    completions: completions.completions,
    note: cleanNote(body.note, 1000),
  };
}

function validateLearnerSubmission(body, selectedKeys) {
  if (!validClientRequestId(body?.client_request_id)) {
    return { ok: false, code: 'INVALID_REQUEST_ID', error: 'A valid request id is required.' };
  }
  const bookingId = Number(body?.booking_id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return { ok: false, code: 'INVALID_BOOKING', error: 'A valid booking is required.' };
  }
  const allowedKeys = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || []);
  const ratings = validateRatings(body?.ratings, { allowedKeys, requireAllAllowed: true });
  if (!ratings.ok) return ratings;
  return {
    ok: true,
    booking_id: bookingId,
    client_request_id: body.client_request_id,
    ratings: ratings.ratings,
    note: cleanNote(body.note, 1000),
  };
}

function isBookingReviewable(booking, now = new Date()) {
  if (!booking || ![SCHEDULED, CHARGEABLE].includes(booking.status)) return false;
  if (booking.credit_forfeited === true) return false;
  const end = new Date(booking.lesson_ended_at || booking.lessonEndedAt || '');
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime();
}

module.exports = {
  FEATURE_KEY,
  ITEM_BY_KEY,
  isCurriculumProgressBetaEnabled,
  loadCurriculumProgressBetaState,
  validateRatings,
  validateCompletionKeys,
  validateInstructorSubmission,
  validateLearnerSubmission,
  isBookingReviewable,
  cleanNote,
};
