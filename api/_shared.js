/**
 * Shared utilities for CoachCarter API endpoints.
 * Extracted to avoid duplication across ask-examiner.js and advisor.js.
 */

const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');

// ── Auth helper ──────────────────────────────────────────────────────────────
function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

// ── Skill labels for readable AI context ─────────────────────────────────────
const SKILL_LABELS = {
  accelerator_12a: 'Accelerator', clutch_12b: 'Clutch', gears_12c: 'Gears',
  footbrake_12d: 'Footbrake', parking_brake_12e: 'Parking Brake', steering_12f: 'Steering',
  mirrors_14: 'Use of Mirrors', signals_15: 'Signals', awareness_26: 'Awareness & Planning',
  signs_signals_17: 'Signs & Signals', positioning_23: 'Positioning', clearance_16: 'Clearance',
  following_19: 'Following Distance', junctions_21: 'Junctions', judgement_22: 'Judgement',
  speed_18: 'Use of Speed', pedestrians_24: 'Pedestrian Crossings', progress_20: 'Progress',
  controlled_stop_2: 'Controlled Stop', reverse_right_4: 'Reverse Right',
  reverse_park_5: 'Reverse Park', forward_park_8: 'Forward Park', move_off_13: 'Move Off'
};
const RATING_LABELS = { struggled: 'Needs work (weak)', ok: 'Getting there (developing)', nailed: 'Confident (strong)' };

// ── Build personalised learner context for AI ────────────────────────────────
async function buildLearnerContext(userId) {
  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [onboarding] = await sql`SELECT * FROM learner_onboarding WHERE learner_id = ${userId}`;

    const lessonData = await sql`
      SELECT DISTINCT ON (skill_key) skill_key, rating, driving_faults, serious_faults, dangerous_faults, created_at
      FROM skill_ratings WHERE user_id = ${userId}
      ORDER BY skill_key, created_at DESC`;

    const quizData = await sql`
      SELECT skill_key, COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE correct)::int AS correct_count
      FROM quiz_results WHERE learner_id = ${userId}
      GROUP BY skill_key`;

    const [mockData] = await sql`
      SELECT COUNT(*)::int AS total_tests, COUNT(*) FILTER (WHERE result = 'pass')::int AS passes
      FROM mock_tests WHERE learner_id = ${userId} AND completed_at IS NOT NULL`;

    const [stats] = await sql`
      SELECT COUNT(*)::int AS total_sessions, COALESCE(SUM(duration_minutes), 0)::int AS total_minutes
      FROM driving_sessions WHERE user_id = ${userId} AND session_type != 'onboarding'`;

    const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${userId}`;

    const hasData = (lessonData?.length > 0) || (quizData?.length > 0) || (mockData?.total_tests > 0) || onboarding;

    if (!hasData) {
      return learner?.name
        ? `\n\nLEARNER CONTEXT:\nThis learner's name is ${learner.name}. They haven't completed their profile, logged any sessions, or taken any quizzes yet. Be encouraging and suggest they start with the Examiner Quiz or complete their driving profile.`
        : '';
    }

    let ctx = `\n\nLEARNER CONTEXT (use this to personalise your responses — reference specific areas when relevant):\n`;
    if (learner?.name) ctx += `Name: ${learner.name}\n`;

    if (onboarding) {
      const totalPrior = (onboarding.prior_hours_pro || 0) + (onboarding.prior_hours_private || 0);
      ctx += `Prior experience: ${onboarding.prior_hours_pro || 0} hours professional lessons, ${onboarding.prior_hours_private || 0} hours private practice (${totalPrior} total)\n`;
      ctx += `Previous tests taken: ${onboarding.previous_tests || 0}\n`;
      ctx += `Transmission: ${onboarding.transmission || 'manual'}\n`;
      if (onboarding.test_booked && onboarding.test_date) {
        const testDate = new Date(onboarding.test_date);
        const daysUntil = Math.ceil((testDate - new Date()) / (1000 * 60 * 60 * 24));
        ctx += `Test booked: ${onboarding.test_date} (${daysUntil > 0 ? daysUntil + ' days away' : 'in the past'})\n`;
      }
      if (onboarding.main_concerns) ctx += `Main concerns: "${onboarding.main_concerns}"\n`;
    }

    ctx += `Sessions logged with CoachCarter: ${stats?.total_sessions || 0} (${Math.round((stats?.total_minutes || 0) / 60 * 10) / 10} hours)\n`;
    if (mockData?.total_tests > 0) ctx += `Mock tests: ${mockData.passes}/${mockData.total_tests} passed\n`;

    if (lessonData.length > 0) {
      ctx += `\nLatest skill self-assessment:\n`;
      const weak = [], developing = [], strong = [];
      for (const r of lessonData) {
        const label = SKILL_LABELS[r.skill_key] || r.skill_key;
        const ratingLabel = RATING_LABELS[r.rating] || r.rating;
        const faultNote = (r.driving_faults > 0 || r.serious_faults > 0 || r.dangerous_faults > 0)
          ? ` [${r.driving_faults}D ${r.serious_faults}S ${r.dangerous_faults}✕ faults logged]` : '';
        if (r.rating === 'struggled') weak.push(`  - ${label}: ${ratingLabel}${faultNote}`);
        else if (r.rating === 'ok') developing.push(`  - ${label}: ${ratingLabel}${faultNote}`);
        else strong.push(`  - ${label}: ${ratingLabel}${faultNote}`);
      }
      if (weak.length > 0) ctx += `WEAK areas:\n${weak.join('\n')}\n`;
      if (developing.length > 0) ctx += `DEVELOPING areas:\n${developing.join('\n')}\n`;
      if (strong.length > 0) ctx += `STRONG areas:\n${strong.join('\n')}\n`;
    }

    if (quizData.length > 0) {
      const lowAccuracy = quizData
        .map(q => ({ ...q, pct: Math.round(100 * q.correct_count / q.attempts) }))
        .filter(q => q.pct < 70)
        .sort((a, b) => a.pct - b.pct);
      if (lowAccuracy.length > 0) {
        ctx += `\nExaminer Quiz weak areas (below 70% accuracy):\n`;
        for (const q of lowAccuracy.slice(0, 5)) {
          ctx += `  - ${SKILL_LABELS[q.skill_key] || q.skill_key}: ${q.correct_count}/${q.attempts} correct (${q.pct}%)\n`;
        }
      }
    }

    // Readiness estimate
    if (lessonData.length > 0) {
      const totalSkills = Object.keys(SKILL_LABELS).length;
      const strongCount = lessonData.filter(r => r.rating === 'nailed').length;
      const readinessPct = Math.round(100 * strongCount / totalSkills);
      ctx += `\nReadiness estimate: ${readinessPct}% (${strongCount}/${totalSkills} skills rated as strong)\n`;
    }

    ctx += `\nWhen this learner asks questions, proactively connect your answers to their weak areas and concerns. If they have a test booked soon, factor in urgency. Be specific — reference their actual data.`;
    return ctx;
  } catch (err) {
    console.error('Failed to build learner context:', err);
    return '';
  }
}

module.exports = { verifyAuth, buildLearnerContext, SKILL_LABELS, RATING_LABELS };
