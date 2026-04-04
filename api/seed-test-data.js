// Seed/reset test data for testing GDPR flows, booking, and learner journeys.
//
// GET /api/seed-test-data?secret=MIGRATION_SECRET
//   or GET /api/seed-test-data?secret=MIGRATION_SECRET&action=clean
//
// Creates 3 test learner accounts with realistic data:
//   - coachcarteruk+testlearner@gmail.com  (full data: bookings, sessions, credits, progress, Q&A)
//   - coachcarteruk+testdelete@gmail.com   (for testing account deletion flow)
//   - coachcarteruk+testempty@gmail.com    (empty account for testing edge cases)
//
// ?action=clean removes all test data and accounts first.
// Without action, it resets test accounts to a known state (clean + re-seed).

const { neon } = require('@neondatabase/serverless');

const TEST_ACCOUNTS = [
  { email: 'coachcarteruk+testlearner@gmail.com', name: 'Test Learner', phone: '07900100001' },
  { email: 'coachcarteruk+testdelete@gmail.com',  name: 'Test Delete',  phone: '07900100002' },
  { email: 'coachcarteruk+testempty@gmail.com',   name: 'Test Empty',   phone: '07900100003' },
];

const TEST_PHONES = TEST_ACCOUNTS.map(a => a.phone);
const TEST_EMAILS = TEST_ACCOUNTS.map(a => a.email);

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!secret || secret !== process.env.MIGRATION_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' });
  }

  const action = req.query.action || 'reset';
  const sql = neon(process.env.POSTGRES_URL);
  const results = { cleaned: false, seeded: false, accounts: [] };

  try {
    // ── Step 1: Clean existing test data ──────────────────────────────────
    const existing = await sql`SELECT id, email FROM learner_users WHERE email = ANY(${TEST_EMAILS})`;
    const existingIds = existing.map(r => r.id);

    if (existingIds.length > 0) {
      for (const id of existingIds) {
        // Anonymize credit transactions
        try { await sql`UPDATE credit_transactions SET learner_id = NULL, anonymized = true WHERE learner_id = ${id}`; } catch (e) {}
        // Delete related records
        try { await sql`DELETE FROM skill_ratings WHERE user_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM driving_sessions WHERE user_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM quiz_results WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM mock_test_faults WHERE mock_test_id IN (SELECT id FROM mock_tests WHERE learner_id = ${id})`; } catch (e) {}
        try { await sql`DELETE FROM mock_tests WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM qa_answers WHERE question_id IN (SELECT id FROM qa_questions WHERE learner_id = ${id})`; } catch (e) {}
        try { await sql`DELETE FROM qa_questions WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM sent_reminders WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${id})`; } catch (e) {}
        try { await sql`DELETE FROM slot_reservations WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM lesson_confirmations WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${id})`; } catch (e) {}
        try { await sql`DELETE FROM lesson_bookings WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM learner_onboarding WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM waitlist WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM instructor_learner_notes WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM learner_availability WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`DELETE FROM deletion_requests WHERE learner_id = ${id}`; } catch (e) {}
        try { await sql`UPDATE cookie_consents SET learner_id = NULL WHERE learner_id = ${id}`; } catch (e) {}
      }
      await sql`DELETE FROM learner_users WHERE id = ANY(${existingIds})`;
    }

    // Clean magic link tokens for test emails
    for (const email of TEST_EMAILS) {
      try { await sql`DELETE FROM magic_link_tokens WHERE email = ${email}`; } catch (e) {}
    }
    for (const phone of TEST_PHONES) {
      try { await sql`DELETE FROM magic_link_tokens WHERE phone = ${phone}`; } catch (e) {}
    }

    results.cleaned = true;
    if (action === 'clean') {
      return res.json({ ok: true, message: 'Test data cleaned', results });
    }

    // ── Step 2: Create test learner accounts ──────────────────────────────
    const schoolId = 1;
    const createdAccounts = [];

    for (const acct of TEST_ACCOUNTS) {
      const [learner] = await sql`
        INSERT INTO learner_users (name, email, phone, current_tier, credit_balance, balance_minutes, school_id, last_activity_at)
        VALUES (${acct.name}, ${acct.email}, ${acct.phone}, 1, 5, 450, ${schoolId}, NOW())
        RETURNING id, name, email, phone`;
      createdAccounts.push(learner);
    }

    const mainLearner = createdAccounts[0]; // testlearner — gets full data
    const deleteLearner = createdAccounts[1]; // testdelete — gets minimal data

    // ── Step 3: Seed realistic data for the main test learner ─────────────

    // Get a real instructor for bookings
    const [instructor] = await sql`SELECT id FROM instructors WHERE school_id = ${schoolId} AND active = true LIMIT 1`;
    const instructorId = instructor?.id || 1;

    // Get a lesson type
    const [lessonType] = await sql`SELECT id FROM lesson_types WHERE school_id = ${schoolId} LIMIT 1`;
    const lessonTypeId = lessonType?.id || 1;

    // Bookings (past confirmed, upcoming, one completed)
    const today = new Date();
    const bookingDates = [
      { offset: -14, status: 'completed' },
      { offset: -7, status: 'completed' },
      { offset: 3, status: 'confirmed' },
      { offset: 10, status: 'confirmed' },
    ];

    for (const bd of bookingDates) {
      const d = new Date(today);
      d.setDate(d.getDate() + bd.offset);
      const dateStr = d.toISOString().slice(0, 10);
      await sql`
        INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, pickup_address, minutes_deducted, school_id)
        VALUES (${mainLearner.id}, ${instructorId}, ${dateStr}, '10:00', '11:30', ${bd.status}, ${lessonTypeId}, '10 Test Street, Reading RG1 1AA', 90, ${schoolId})`;
    }

    // Credit transactions
    await sql`
      INSERT INTO credit_transactions (learner_id, type, credits, minutes, amount_pence, payment_method, school_id)
      VALUES
        (${mainLearner.id}, 'purchase', 5, 450, 41250, 'stripe', ${schoolId}),
        (${mainLearner.id}, 'admin_remove', -1, -90, 0, 'booking', ${schoolId}),
        (${mainLearner.id}, 'admin_remove', -1, -90, 0, 'booking', ${schoolId})`;

    // Driving sessions
    const session1Date = new Date(today); session1Date.setDate(session1Date.getDate() - 14);
    const session2Date = new Date(today); session2Date.setDate(session2Date.getDate() - 7);
    await sql`
      INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, school_id)
      VALUES
        (${mainLearner.id}, ${session1Date.toISOString().slice(0, 10)}, 90, 'instructor', 'First lesson — covered cockpit drill, moving off, and stopping. Good start.', ${schoolId}),
        (${mainLearner.id}, ${session2Date.toISOString().slice(0, 10)}, 90, 'instructor', 'Junctions and roundabouts. Needs more mirror checks.', ${schoolId})`;

    // Skill ratings (session_id references a driving_sessions record)
    const [latestSession] = await sql`SELECT id FROM driving_sessions WHERE user_id = ${mainLearner.id} ORDER BY id DESC LIMIT 1`;
    const sessionId = latestSession?.id || 1;
    const skills = ['controls_steering', 'junctions_approach', 'mirrors_use', 'progress_appropriate_speed'];
    for (const skill of skills) {
      await sql`
        INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating, note, school_id)
        VALUES (${sessionId}, ${mainLearner.id}, 1, ${skill}, 'ok', 'Test rating', ${schoolId})`;
    }

    // Q&A question
    await sql`
      INSERT INTO qa_questions (learner_id, title, body, status, school_id)
      VALUES (${mainLearner.id}, 'When should I check mirrors?', 'I keep forgetting to check mirrors before signalling. Any tips?', 'open', ${schoolId})`;

    // Onboarding
    await sql`
      INSERT INTO learner_onboarding (learner_id, prior_hours_pro, prior_hours_private, previous_tests, transmission, test_date, main_concerns, school_id)
      VALUES (${mainLearner.id}, 8, 2, 0, 'manual', ${new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}, 'Roundabouts and parallel parking', ${schoolId})`;

    // Also give the delete test learner a booking so deletion has something to cascade
    const deleteDate = new Date(today); deleteDate.setDate(deleteDate.getDate() - 3);
    await sql`
      INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, minutes_deducted, school_id)
      VALUES (${deleteLearner.id}, ${instructorId}, ${deleteDate.toISOString().slice(0, 10)}, '14:00', '15:30', 'completed', ${lessonTypeId}, 90, ${schoolId})`;
    await sql`
      INSERT INTO credit_transactions (learner_id, type, credits, minutes, amount_pence, payment_method, school_id)
      VALUES (${deleteLearner.id}, 'purchase', 2, 180, 16500, 'stripe', ${schoolId})`;

    results.seeded = true;
    results.accounts = createdAccounts.map(a => ({ id: a.id, name: a.name, email: a.email, phone: a.phone }));

    return res.json({
      ok: true,
      message: 'Test data seeded successfully',
      results,
      how_to_login: 'Use magic link login with any test email. All emails go to your coachcarteruk@gmail.com inbox.',
      test_accounts: {
        full_data: 'coachcarteruk+testlearner@gmail.com — has bookings, sessions, credits, skills, Q&A, onboarding',
        deletion_test: 'coachcarteruk+testdelete@gmail.com — has a booking + credits, use to test Delete My Account',
        empty: 'coachcarteruk+testempty@gmail.com — clean account, test edge cases with no data'
      }
    });
  } catch (err) {
    console.error('seed-test-data error:', err);
    return res.status(500).json({ error: 'Failed to seed test data', details: err.message });
  }
};
