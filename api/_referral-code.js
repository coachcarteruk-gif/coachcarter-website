const REFERRAL_CODE_MIN_LENGTH = 3;
const REFERRAL_CODE_MAX_LENGTH = 32;
const REFERRAL_CODE_RE = /^[A-Z0-9](?:[A-Z0-9_-]{1,30}[A-Z0-9])$/;

function normaliseReferralCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';

  if (!code) {
    return { ok: false, error: 'Enter a referral code.' };
  }
  if (code.length < REFERRAL_CODE_MIN_LENGTH || code.length > REFERRAL_CODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Referral codes must be ${REFERRAL_CODE_MIN_LENGTH}-${REFERRAL_CODE_MAX_LENGTH} characters.`,
    };
  }
  if (!REFERRAL_CODE_RE.test(code)) {
    return {
      ok: false,
      error: 'Use letters, numbers, hyphens or underscores, starting and ending with a letter or number.',
    };
  }

  return { ok: true, code };
}

async function updateReferralCodeForLearner(sql, { learnerId, schoolId, code }) {
  const [referral] = await sql`
    SELECT r.id, r.code, lu.id AS learner_id, lu.name AS learner_name, lu.email AS learner_email
    FROM referrals r
    JOIN learner_users lu
      ON lu.id = r.learner_id
     AND lu.school_id = ${schoolId}
    WHERE r.learner_id = ${learnerId}
      AND r.school_id = ${schoolId}
    LIMIT 1
  `;

  if (!referral) return { status: 'not_found' };
  if (referral.code === code) return { status: 'unchanged', referral };

  const [conflict] = await sql`
    SELECT learner_id
    FROM referrals
    WHERE code = ${code}
      AND school_id = ${schoolId}
      AND learner_id <> ${learnerId}
    LIMIT 1
  `;
  if (conflict) return { status: 'conflict' };

  const [updated] = await sql`
    UPDATE referrals
       SET code = ${code}
     WHERE id = ${referral.id}
       AND school_id = ${schoolId}
    RETURNING learner_id, code
  `;

  if (!updated) return { status: 'not_found' };
  return { status: 'updated', previous: referral, referral: updated };
}

module.exports = {
  REFERRAL_CODE_MIN_LENGTH,
  REFERRAL_CODE_MAX_LENGTH,
  normaliseReferralCode,
  updateReferralCodeForLearner,
};
