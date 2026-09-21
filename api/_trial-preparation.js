const { currentDetails, localDate } = require('./_learner-test-details');
const { operationalTimeZone } = require('./_full-curriculum');
const { REFUNDED } = require('./_booking-status');

// Access follows the current assignment. A historical note alone cannot grant
// access to a learner's new personal data after reassignment.
async function loadPreparation(sql, schoolId, instructorId, learnerIds) {
  if (!learnerIds.length) return new Map();
  const [school] = await sql`SELECT config FROM schools WHERE id=${schoolId}`;
  const today = localDate(new Date(), operationalTimeZone(school?.config));
  const profiles = await sql`
    SELECT lu.id, lu.test_booked, lu.test_date, lu.test_time, lu.test_centre, lu.test_details_updated_at
    FROM learner_users lu WHERE lu.school_id = ${schoolId} AND lu.id = ANY(${learnerIds}::int[])
      AND (lu.primary_instructor_id = ${instructorId} OR
        EXISTS (
          SELECT 1 FROM lesson_bookings b WHERE b.school_id = ${schoolId}
            AND b.learner_id = lu.id AND b.instructor_id = ${instructorId} AND b.status <> ${REFUNDED}
            AND (lu.primary_instructor_id IS NULL OR b.scheduled_date >= ${today}::date)
            AND NOT EXISTS (SELECT 1 FROM lesson_bookings child WHERE child.school_id = ${schoolId} AND child.rescheduled_from = b.id)
        ))
  `;
  const ids = profiles.map(p => p.id);
  if (!ids.length) return new Map();
  const intakes = await sql`
    WITH RECURSIVE chain AS (
      SELECT t.booking_id AS root_id, b.id, b.instructor_id, b.learner_id, b.scheduled_date, ARRAY[b.id] AS path, false AS cycle
      FROM trial_booking_intakes t JOIN lesson_bookings b ON b.school_id = ${schoolId} AND b.id = t.booking_id
      WHERE t.school_id = ${schoolId} AND t.learner_id = ANY(${ids}::int[])
      UNION ALL
      SELECT c.root_id, b.id, b.instructor_id, b.learner_id, b.scheduled_date, c.path || b.id, b.id = ANY(c.path)
      FROM chain c JOIN lesson_bookings b ON b.rescheduled_from = c.id AND b.school_id = ${schoolId} AND b.learner_id = c.learner_id
      WHERE NOT c.cycle AND cardinality(c.path) < 100
    )
    SELECT t.*, leaf.id AS current_booking_id, leaf.scheduled_date::text AS current_booking_date
    FROM trial_booking_intakes t
    JOIN chain leaf ON leaf.root_id = t.booking_id
    JOIN learner_users lu ON lu.id = t.learner_id AND lu.school_id = ${schoolId}
    WHERE t.school_id = ${schoolId} AND t.learner_id = ANY(${ids}::int[])
      AND NOT EXISTS (SELECT 1 FROM lesson_bookings b WHERE b.school_id = ${schoolId} AND b.rescheduled_from = leaf.id)
      AND NOT EXISTS (SELECT 1 FROM chain bad WHERE bad.root_id = leaf.root_id AND (bad.cycle OR cardinality(bad.path) >= 100))
      AND NOT EXISTS (SELECT 1 FROM chain parent JOIN lesson_bookings b ON b.school_id = ${schoolId} AND b.rescheduled_from = parent.id
        WHERE parent.root_id = leaf.root_id GROUP BY parent.id HAVING count(*) > 1)
      AND (leaf.instructor_id = ${instructorId} OR lu.primary_instructor_id = ${instructorId})
    ORDER BY t.booked_at DESC
  `;
  return new Map(profiles.map(p => [p.id, {
    current_test_details: currentDetails(p), trial_intake: intakes.find(t => t.learner_id === p.id) || null
  }]));
}
module.exports = { loadPreparation };
