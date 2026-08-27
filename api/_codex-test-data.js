const { neon } = require('@neondatabase/serverless');
const { hashPassword } = require('./_password');

const SCHOOL_ID = 1;
const TEST_PASSWORD = 'CodexTestPass!2026';
const INSTRUCTOR_EMAIL = 'codex+instructor@coachcarter.test';
const LEARNER_FULL_EMAIL = 'codex+learner-full@coachcarter.test';
const LEARNER_EMPTY_EMAIL = 'codex+learner-empty@coachcarter.test';
const LEARNER_DELETE_EMAIL = 'codex+learner-delete@coachcarter.test';

const LEARNER_ACCOUNTS = [
  {
    key: 'full',
    email: LEARNER_FULL_EMAIL,
    name: 'Codex Full Learner',
    phone: '07900101001',
    pickup: '10 Test Street, Reading RG1 1AA',
    balanceMinutes: 360,
  },
  {
    key: 'empty',
    email: LEARNER_EMPTY_EMAIL,
    name: 'Codex Empty Learner',
    phone: '07900101002',
    pickup: '22 Empty Lane, Reading RG2 2BB',
    balanceMinutes: 0,
  },
  {
    key: 'delete',
    email: LEARNER_DELETE_EMAIL,
    name: 'Codex Delete Learner',
    phone: '07900101003',
    pickup: '33 Disposal Road, Reading RG3 3CC',
    balanceMinutes: 90,
  },
];

const LEGACY_TEST_EMAILS = [
  'coachcarteruk+testlearner@gmail.com',
  'coachcarteruk+testdelete@gmail.com',
  'coachcarteruk+testempty@gmail.com',
];

const TEST_LEARNER_EMAILS = LEARNER_ACCOUNTS.map((account) => account.email);
const CLEANUP_LEARNER_EMAILS = [...TEST_LEARNER_EMAILS, ...LEGACY_TEST_EMAILS];
const TEST_PHONES = LEARNER_ACCOUNTS.map((account) => account.phone);
const LOCKOUT_KEYS = [
  ...TEST_LEARNER_EMAILS.map((email) => `pwfail:learner:${email}`),
  `pwfail:instructor:${INSTRUCTOR_EMAIL}`,
];

function normalizeConnectionString(value) {
  return String(value || '').trim();
}

function getTestDatabaseUrl(env = process.env) {
  const testUrl = normalizeConnectionString(env.POSTGRES_URL_TEST);
  const prodUrl = normalizeConnectionString(env.POSTGRES_URL);

  if (!testUrl) {
    const err = new Error('POSTGRES_URL_TEST is required for Codex test-data reset.');
    err.statusCode = 500;
    throw err;
  }

  if (prodUrl && testUrl === prodUrl) {
    const err = new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL.');
    err.statusCode = 500;
    throw err;
  }

  return testUrl;
}

function codexSql(env = process.env) {
  return neon(getTestDatabaseUrl(env));
}

function dateWithOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function requireCoreSchema(sql) {
  const requiredTables = [
    'schools',
    'learner_users',
    'instructors',
    'instructor_availability',
    'lesson_types',
    'lesson_bookings',
    'credit_transactions',
    'learner_credit_balances',
    'booking_credit_sources',
  ];
  const rows = await sql`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY(${requiredTables})
  `;
  const found = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length) {
    throw new Error(`Test database is missing required tables: ${missing.join(', ')}. Apply latest migrations to the isolated Neon branch.`);
  }

  const requiredColumns = [
    ['learner_users', 'is_test_account'],
    ['learner_users', 'school_id'],
    ['learner_users', 'password_hash'],
    ['instructors', 'school_id'],
    ['instructors', 'password_hash'],
    ['lesson_bookings', 'school_id'],
    ['credit_transactions', 'school_id'],
    ['credit_transactions', 'instructor_id'],
    ['learner_credit_balances', 'school_id'],
    ['booking_credit_sources', 'school_id'],
  ];
  const columnRows = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY(${requiredColumns.map(([table]) => table)})
  `;
  const foundColumns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = requiredColumns
    .filter(([table, column]) => !foundColumns.has(`${table}.${column}`))
    .map(([table, column]) => `${table}.${column}`);
  if (missingColumns.length) {
    throw new Error(`Test database is missing required columns: ${missingColumns.join(', ')}. Apply latest migrations to the isolated Neon branch.`);
  }
}

async function cleanupCodexData(sql) {
  const learnerRows = await sql`
    SELECT id
      FROM learner_users
     WHERE LOWER(email) = ANY(${CLEANUP_LEARNER_EMAILS})
        OR (is_test_account = TRUE AND LOWER(email) LIKE 'codex+learner-%@coachcarter.test')
  `;
  const learnerIds = learnerRows.map((row) => row.id);

  const instructorRows = await sql`
    SELECT id
      FROM instructors
     WHERE LOWER(email) = LOWER(${INSTRUCTOR_EMAIL})
  `;
  const instructorIds = instructorRows.map((row) => row.id);

  if (learnerIds.length || instructorIds.length) {
    if (learnerIds.length) {
      await sql`DELETE FROM curriculum_rating_events WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM curriculum_completion_events WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM curriculum_review_submissions WHERE learner_id = ANY(${learnerIds})`;
      await sql`
        DELETE FROM booking_credit_sources
         WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ANY(${learnerIds}))
            OR credit_transaction_id IN (SELECT id FROM credit_transactions WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`
        DELETE FROM credit_source_adjustments
         WHERE credit_transaction_id IN (SELECT id FROM credit_transactions WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`
        DELETE FROM refund_event_notes
         WHERE refund_event_id IN (SELECT id FROM refund_events WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`
        DELETE FROM refund_event_lines
         WHERE refund_event_id IN (SELECT id FROM refund_events WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`DELETE FROM refund_events WHERE learner_id = ANY(${learnerIds})`;
      await sql`
        DELETE FROM mock_test_faults
         WHERE mock_test_id IN (SELECT id FROM mock_tests WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`DELETE FROM mock_tests WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM quiz_results WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM skill_ratings WHERE user_id = ANY(${learnerIds})`;
      await sql`DELETE FROM driving_sessions WHERE user_id = ANY(${learnerIds})`;
      await sql`
        DELETE FROM sent_reminders
         WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`
        DELETE FROM lesson_confirmations
         WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ANY(${learnerIds}))
      `;
      await sql`DELETE FROM slot_reservations WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM learner_availability WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM learner_onboarding WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM instructor_learner_notes WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM deletion_requests WHERE learner_id = ANY(${learnerIds})`;
      await sql`UPDATE cookie_consents SET learner_id = NULL WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM learner_credit_balances WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM credit_transactions WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM lesson_bookings WHERE learner_id = ANY(${learnerIds})`;
      await sql`DELETE FROM learner_users WHERE id = ANY(${learnerIds})`;
    }

    if (instructorIds.length) {
      await sql`DELETE FROM instructor_availability WHERE instructor_id = ANY(${instructorIds})`;
      await sql`DELETE FROM instructor_availability_overrides WHERE instructor_id = ANY(${instructorIds})`;
      await sql`DELETE FROM instructor_login_tokens WHERE instructor_id = ANY(${instructorIds})`;
    }
  }

  await sql`DELETE FROM magic_link_tokens WHERE LOWER(email) = ANY(${CLEANUP_LEARNER_EMAILS})`;
  await sql`DELETE FROM magic_link_tokens WHERE phone = ANY(${TEST_PHONES})`;
  await sql`DELETE FROM rate_limits WHERE key = ANY(${LOCKOUT_KEYS})`;

  return {
    learners_removed: learnerIds.length,
    instructors_reset: instructorIds.length,
  };
}

async function ensureSchool(sql) {
  await sql`
    INSERT INTO schools (id, name, slug, contact_email, primary_colour, secondary_colour, accent_colour, config)
    VALUES (
      ${SCHOOL_ID},
      'CoachCarter Driving School',
      'coachcarter',
      'fraser@coachcarter.uk',
      '#f97316',
      '#1e3a5f',
      '#3b82f6',
      '{"payments_enabled": true}'::jsonb
    )
    ON CONFLICT (id) DO UPDATE
      SET config = COALESCE(schools.config, '{}'::jsonb) || '{"payments_enabled": true}'::jsonb
  `;
}

async function seedInstructor(sql, passwordHash) {
  const [instructor] = await sql`
    INSERT INTO instructors (
      name, email, phone, bio, active, buffer_minutes, school_id,
      password_hash, password_set_at, email_verified, must_change_password,
      onboarding_complete, slug, hourly_rate_pence, bulk_tiers_enabled,
      transmission_type, max_booking_days_ahead, service_areas, languages
    )
    VALUES (
      'Codex Instructor',
      ${INSTRUCTOR_EMAIL},
      '07900101999',
      'Seeded Codex test instructor for local browser automation.',
      TRUE,
      15,
      ${SCHOOL_ID},
      ${passwordHash},
      NOW(),
      TRUE,
      FALSE,
      TRUE,
      'codex-instructor',
      5500,
      TRUE,
      'manual',
      84,
      '["Reading", "Caversham", "Tilehurst"]'::jsonb,
      '["English"]'::jsonb
    )
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          bio = EXCLUDED.bio,
          active = TRUE,
          buffer_minutes = EXCLUDED.buffer_minutes,
          school_id = EXCLUDED.school_id,
          password_hash = EXCLUDED.password_hash,
          password_set_at = NOW(),
          email_verified = TRUE,
          must_change_password = FALSE,
          onboarding_complete = TRUE,
          slug = EXCLUDED.slug,
          hourly_rate_pence = EXCLUDED.hourly_rate_pence,
          bulk_tiers_enabled = TRUE,
          transmission_type = EXCLUDED.transmission_type,
          max_booking_days_ahead = EXCLUDED.max_booking_days_ahead,
          service_areas = EXCLUDED.service_areas,
          languages = EXCLUDED.languages
    RETURNING id, name, email, school_id
  `;

  await sql`DELETE FROM instructor_availability WHERE instructor_id = ${instructor.id} AND school_id = ${SCHOOL_ID}`;
  for (const day of [1, 2, 3, 4, 5, 6]) {
    await sql`
      INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time, active, school_id)
      VALUES (${instructor.id}, ${day}, '09:00', '17:00', TRUE, ${SCHOOL_ID})
    `;
  }

  return instructor;
}

async function ensureLessonType(sql) {
  const [lessonType] = await sql`
    INSERT INTO lesson_types (name, slug, duration_minutes, price_pence, colour, sort_order, active, school_id)
    VALUES ('Standard Lesson', 'standard', 90, 8250, '#3b82f6', 1, TRUE, ${SCHOOL_ID})
    ON CONFLICT (slug) DO UPDATE
      SET active = TRUE,
          duration_minutes = EXCLUDED.duration_minutes,
          price_pence = EXCLUDED.price_pence,
          school_id = EXCLUDED.school_id
    RETURNING id, name, duration_minutes, price_pence
  `;
  return lessonType;
}

async function seedLearner(sql, account, passwordHash) {
  const [learner] = await sql`
    INSERT INTO learner_users (
      name, email, phone, password_hash, password_set_at, email_verified,
      current_tier, credit_balance, balance_minutes, pickup_address, school_id,
      terms_accepted_at, last_activity_at, is_test_account
    )
    VALUES (
      ${account.name},
      ${account.email},
      ${account.phone},
      ${passwordHash},
      NOW(),
      TRUE,
      1,
      ${Math.floor(account.balanceMinutes / 90)},
      ${account.balanceMinutes},
      ${account.pickup},
      ${SCHOOL_ID},
      NOW(),
      NOW(),
      TRUE
    )
    RETURNING id, name, email, phone, school_id, is_test_account
  `;
  return learner;
}

async function createCreditSource(sql, learnerId, instructorId, minutes, amountPence, suffix) {
  const [creditTx] = await sql`
    INSERT INTO credit_transactions (
      learner_id, instructor_id, school_id, type, credits, minutes,
      amount_pence, payment_method, stripe_session_id, source,
      effective_rate_pence_per_minute, stripe_fee_pence
    )
    VALUES (
      ${learnerId},
      ${instructorId},
      ${SCHOOL_ID},
      'purchase',
      ${Math.floor(minutes / 90)},
      ${minutes},
      ${amountPence},
      'codex_test_seed',
      ${`cs_test_codex_seed_${suffix}`},
      'stripe',
      ${minutes > 0 ? Math.round(amountPence / minutes) : 0},
      0
    )
    RETURNING id, minutes, amount_pence, effective_rate_pence_per_minute
  `;
  return creditTx;
}

async function createBooking(sql, opts) {
  const [booking] = await sql`
    INSERT INTO lesson_bookings (
      learner_id, instructor_id, scheduled_date, start_time, end_time,
      status, lesson_type_id, pickup_address, minutes_deducted, school_id,
      created_by, payment_method, transmission_type, list_price_pence, list_price_source
    )
    VALUES (
      ${opts.learnerId},
      ${opts.instructorId},
      ${opts.date},
      ${opts.start},
      ${opts.end},
      ${opts.status},
      ${opts.lessonTypeId},
      ${opts.pickup || null},
      ${opts.minutes || 90},
      ${SCHOOL_ID},
      ${opts.createdBy || 'learner'},
      ${opts.paymentMethod || 'credit'},
      'manual',
      ${opts.listPricePence || 8250},
      'live_compute_insert'
    )
    RETURNING id, scheduled_date, start_time::text, end_time::text, status
  `;
  return booking;
}

async function attachCreditSource(sql, bookingId, creditTx, minutes) {
  const rate = creditTx.effective_rate_pence_per_minute || 0;
  await sql`
    INSERT INTO booking_credit_sources (
      school_id, booking_id, credit_transaction_id, minutes_drawn,
      rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by
    )
    VALUES (
      ${SCHOOL_ID},
      ${bookingId},
      ${creditTx.id},
      ${minutes},
      ${rate},
      ${rate * minutes},
      0,
      NULL
    )
  `;
}

async function seedFullLearnerData(sql, learner, instructor, lessonType) {
  const creditTx = await createCreditSource(sql, learner.id, instructor.id, 540, 49680, 'full');
  await sql`
    INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${learner.id}, ${instructor.id}, ${SCHOOL_ID}, 360)
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET school_id = EXCLUDED.school_id,
          balance_minutes = EXCLUDED.balance_minutes,
          updated_at = NOW()
  `;

  const pastOne = await createBooking(sql, {
    learnerId: learner.id,
    instructorId: instructor.id,
    lessonTypeId: lessonType.id,
    date: dateWithOffset(-14),
    start: '10:00',
    end: '11:30',
    status: 'chargeable',
    pickup: '10 Test Street, Reading RG1 1AA',
  });
  const pastTwo = await createBooking(sql, {
    learnerId: learner.id,
    instructorId: instructor.id,
    lessonTypeId: lessonType.id,
    date: dateWithOffset(-7),
    start: '10:00',
    end: '11:30',
    status: 'chargeable',
    pickup: '10 Test Street, Reading RG1 1AA',
  });
  await attachCreditSource(sql, pastOne.id, creditTx, 90);
  await attachCreditSource(sql, pastTwo.id, creditTx, 90);

  await createBooking(sql, {
    learnerId: learner.id,
    instructorId: instructor.id,
    lessonTypeId: lessonType.id,
    date: dateWithOffset(0),
    start: '15:00',
    end: '16:30',
    status: 'scheduled',
    pickup: '10 Test Street, Reading RG1 1AA',
  });
  await createBooking(sql, {
    learnerId: learner.id,
    instructorId: instructor.id,
    lessonTypeId: lessonType.id,
    date: dateWithOffset(3),
    start: '11:00',
    end: '12:30',
    status: 'scheduled',
    pickup: '10 Test Street, Reading RG1 1AA',
  });

  const [session] = await sql`
    INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, school_id)
    VALUES (${learner.id}, ${dateWithOffset(-7)}, 90, 'instructor', 'Seeded Codex lesson log covering junctions, mirrors, and planning.', ${SCHOOL_ID})
    RETURNING id
  `;

  for (const skill of ['controls_steering', 'junctions_approach', 'mirrors_use', 'progress_appropriate_speed']) {
    await sql`
      INSERT INTO skill_ratings (
        session_id, user_id, tier, skill_key, rating, note,
        driving_faults, serious_faults, dangerous_faults, school_id
      )
      VALUES (${session.id}, ${learner.id}, 1, ${skill}, 'ok', 'Seeded Codex rating', 1, 0, 0, ${SCHOOL_ID})
    `;
  }

  await sql`
    INSERT INTO learner_onboarding (
      learner_id, prior_hours_pro, prior_hours_private, previous_tests,
      transmission, test_booked, test_date, main_concerns, completed_at, school_id
    )
    VALUES (
      ${learner.id},
      8,
      2,
      0,
      'manual',
      TRUE,
      ${dateWithOffset(90)},
      'Roundabouts and parallel parking',
      NOW(),
      ${SCHOOL_ID}
    )
  `;

  await sql`
    INSERT INTO learner_availability (learner_id, school_id, day_of_week, start_time, end_time, active)
    VALUES
      (${learner.id}, ${SCHOOL_ID}, 2, '10:00', '12:00', TRUE),
      (${learner.id}, ${SCHOOL_ID}, 4, '14:00', '17:00', TRUE)
  `;
}

async function seedDeleteLearnerData(sql, learner, instructor, lessonType) {
  const creditTx = await createCreditSource(sql, learner.id, instructor.id, 180, 16560, 'delete');
  await sql`
    INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${learner.id}, ${instructor.id}, ${SCHOOL_ID}, 90)
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET school_id = EXCLUDED.school_id,
          balance_minutes = EXCLUDED.balance_minutes,
          updated_at = NOW()
  `;
  const booking = await createBooking(sql, {
    learnerId: learner.id,
    instructorId: instructor.id,
    lessonTypeId: lessonType.id,
    date: dateWithOffset(-3),
    start: '13:00',
    end: '14:30',
    status: 'chargeable',
    pickup: '33 Disposal Road, Reading RG3 3CC',
  });
  await attachCreditSource(sql, booking.id, creditTx, 90);
}

async function seedCodexTestData(options = {}) {
  const action = options.action === 'clean' ? 'clean' : 'reset';
  const sql = options.sql || codexSql(options.env || process.env);
  const startedAt = new Date().toISOString();

  await requireCoreSchema(sql);
  const cleanup = await cleanupCodexData(sql);

  const results = {
    action,
    started_at: startedAt,
    cleaned: true,
    cleanup,
    seeded: false,
    school_id: SCHOOL_ID,
    accounts: {},
  };

  if (action === 'clean') return results;

  await ensureSchool(sql);
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const instructor = await seedInstructor(sql, passwordHash);
  const lessonType = await ensureLessonType(sql);

  const createdLearners = {};
  for (const account of LEARNER_ACCOUNTS) {
    createdLearners[account.key] = await seedLearner(sql, account, passwordHash);
  }

  await seedFullLearnerData(sql, createdLearners.full, instructor, lessonType);
  await seedDeleteLearnerData(sql, createdLearners.delete, instructor, lessonType);

  const unmarked = await sql`
    SELECT email
      FROM learner_users
     WHERE LOWER(email) = ANY(${TEST_LEARNER_EMAILS})
       AND is_test_account IS NOT TRUE
  `;
  if (unmarked.length) {
    throw new Error(`Seeded learner rows missing is_test_account=TRUE: ${unmarked.map((row) => row.email).join(', ')}`);
  }

  results.seeded = true;
  results.accounts = {
    password: TEST_PASSWORD,
    learner_full: createdLearners.full,
    learner_empty: createdLearners.empty,
    learner_delete: createdLearners.delete,
    instructor,
  };
  results.env = {
    CC_TEST_LEARNER_EMAIL: LEARNER_FULL_EMAIL,
    CC_TEST_LEARNER_PASSWORD: TEST_PASSWORD,
    CC_TEST_INSTRUCTOR_EMAIL: INSTRUCTOR_EMAIL,
    CC_TEST_INSTRUCTOR_PASSWORD: TEST_PASSWORD,
  };
  return results;
}

module.exports = {
  SCHOOL_ID,
  TEST_PASSWORD,
  INSTRUCTOR_EMAIL,
  LEARNER_FULL_EMAIL,
  LEARNER_EMPTY_EMAIL,
  LEARNER_DELETE_EMAIL,
  LEARNER_ACCOUNTS,
  TEST_LEARNER_EMAILS,
  getTestDatabaseUrl,
  codexSql,
  seedCodexTestData,
};
