const V1_DISABLED_CODE = 'PAYOUT_V1_DISABLED_FOR_V2_SCHOOL';

function requireSchoolId(schoolId) {
  const parsed = Number(schoolId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error('A positive school_id is required before any v1 payout mutation');
    error.code = 'PAYOUT_SCHOOL_SCOPE_REQUIRED';
    throw error;
  }
  return parsed;
}

/**
 * Final guard immediately before a legacy payout mutation path.
 *
 * This is intentionally a tiny dependency of the live v1 helper. Slice 7
 * preparation does not import its inactive cutover implementation into a live
 * route. Today every school remains v1, so behaviour is unchanged. If a future
 * reviewed cutover transaction changes one school to v2, all v1 instructor and
 * school mutation attempts for that school hard-refuse before a claim, write,
 * or Stripe call.
 */
async function assertV1PayoutEngine(sql, schoolId) {
  const scopedSchoolId = requireSchoolId(schoolId);
  const rows = await sql`
    SELECT COALESCE(to_jsonb(s)->>'payout_engine_version', 'v1') AS payout_engine_version
      FROM schools s
     WHERE s.id = ${scopedSchoolId}
       AND s.active = TRUE
     LIMIT 1
  `;
  if (!rows.length) {
    const error = new Error(`School ${scopedSchoolId} is missing or inactive`);
    error.code = 'PAYOUT_SCHOOL_NOT_ACTIVE';
    throw error;
  }
  if (rows[0].payout_engine_version !== 'v1') {
    const error = new Error(
      `Legacy payout mutation is disabled for school ${scopedSchoolId}`
    );
    error.code = V1_DISABLED_CODE;
    error.school_id = scopedSchoolId;
    throw error;
  }
  return { school_id: scopedSchoolId, payout_engine_version: 'v1' };
}

module.exports = {
  V1_DISABLED_CODE,
  assertV1PayoutEngine,
  requireSchoolId,
};
