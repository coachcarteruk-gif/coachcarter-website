-- ══════════════════════════════════════════════════════════════════════════════
-- DEMO EARNINGS DATA
-- Populates Simon Edwards' diary with realistic bookings to demo the earnings
-- dashboard. Finds instructor + learner by name, creates a mix of completed
-- and upcoming lessons over the past 4 weeks + current week.
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING on the unique slot constraint.
-- To clear: DELETE FROM lesson_bookings WHERE instructor_notes = 'demo-seed';
-- ══════════════════════════════════════════════════════════════════════════════

-- Find the instructor and learner dynamically by name
DO $$
DECLARE
  v_instructor_id INTEGER;
  v_learner_id    INTEGER;
  v_lesson_type   INTEGER;
  v_week_start    DATE;
  v_day           DATE;
BEGIN

  -- Look up Simon Edwards (case-insensitive partial match)
  SELECT id INTO v_instructor_id
  FROM instructors
  WHERE LOWER(name) LIKE '%simon%edwards%'
  LIMIT 1;

  IF v_instructor_id IS NULL THEN
    RAISE NOTICE 'Instructor "Simon Edwards" not found — skipping seed.';
    RETURN;
  END IF;

  -- Look up a learner with credits (prefer one named Fraser, else first with credits)
  SELECT id INTO v_learner_id
  FROM learner_users
  WHERE LOWER(name) LIKE '%fraser%'
  LIMIT 1;

  IF v_learner_id IS NULL THEN
    SELECT id INTO v_learner_id
    FROM learner_users
    WHERE credit_balance > 0 OR balance_minutes > 0
    ORDER BY credit_balance DESC
    LIMIT 1;
  END IF;

  IF v_learner_id IS NULL THEN
    -- Fallback: just pick the first learner
    SELECT id INTO v_learner_id FROM learner_users ORDER BY id LIMIT 1;
  END IF;

  IF v_learner_id IS NULL THEN
    RAISE NOTICE 'No learners found — skipping seed.';
    RETURN;
  END IF;

  -- Get the Standard Lesson type
  SELECT id INTO v_lesson_type FROM lesson_types WHERE slug = 'standard' LIMIT 1;
  IF v_lesson_type IS NULL THEN v_lesson_type := 1; END IF;

  RAISE NOTICE 'Seeding bookings: instructor_id=%, learner_id=%, lesson_type=%',
    v_instructor_id, v_learner_id, v_lesson_type;

  -- ── 4 weeks ago (Mon-Fri, all completed) ───────────────────────────────────
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 28;

  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
  VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- ── 3 weeks ago ────────────────────────────────────────────────────────────
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 21;

  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
  VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 3, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- ── 2 weeks ago ────────────────────────────────────────────────────────────
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 14;

  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
  VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- ── Last week ──────────────────────────────────────────────────────────────
  v_week_start := date_trunc('week', CURRENT_DATE)::date - 7;

  INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
  VALUES
    (v_learner_id, v_instructor_id, v_week_start,     '10:00', '11:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 1, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 2, '14:00', '15:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 3, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed'),
    (v_learner_id, v_instructor_id, v_week_start + 4, '11:00', '12:30', 'completed', v_lesson_type, 'demo-seed')
  ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;

  -- ── This week (mix of completed earlier in week + confirmed upcoming) ──────
  v_week_start := date_trunc('week', CURRENT_DATE)::date;

  -- Past days this week → completed
  FOR v_day IN SELECT d FROM generate_series(v_week_start, CURRENT_DATE - 1, '1 day'::interval) AS d
  LOOP
    INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
    VALUES (v_learner_id, v_instructor_id, v_day, '09:00', '10:30', 'completed', v_lesson_type, 'demo-seed')
    ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;
  END LOOP;

  -- Future days this week → confirmed (upcoming)
  FOR v_day IN SELECT d FROM generate_series(CURRENT_DATE + 1, v_week_start + 4, '1 day'::interval) AS d
  LOOP
    INSERT INTO lesson_bookings (learner_id, instructor_id, scheduled_date, start_time, end_time, status, lesson_type_id, instructor_notes)
    VALUES (v_learner_id, v_instructor_id, v_day, '10:00', '11:30', 'confirmed', v_lesson_type, 'demo-seed')
    ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Demo earnings seed complete!';
END $$;
