-- ============================================================
-- Seed 001 — Placeholder Instructors
-- Run this in the Neon SQL Editor to populate test data.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.
-- ============================================================
-- day_of_week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday,
--              4=Thursday, 5=Friday, 6=Saturday
-- ============================================================


-- ── Instructors ───────────────────────────────────────────────────────────────

INSERT INTO instructors (name, email, phone, bio, active)
VALUES
  (
    'James Carter',
    'james@coachcarter.uk',
    '07700 900001',
    'ADI qualified with 8 years of experience. Calm, patient approach — specialises in nervous beginners.',
    true
  ),
  (
    'Sarah Mitchell',
    'sarah@coachcarter.uk',
    '07700 900002',
    'ADI qualified with 5 years of experience. Focused on building confidence and test-ready technique.',
    true
  ),
  (
    'Liam Okafor',
    'liam@coachcarter.uk',
    '07700 900003',
    'ADI qualified with 3 years of experience. Energetic style, great with younger learners.',
    true
  )
ON CONFLICT (email) DO NOTHING;


-- ── Availability windows ──────────────────────────────────────────────────────
-- We reference instructors by email so this is safe to re-run.
-- Delete existing windows first to avoid duplicates on re-run.

DELETE FROM instructor_availability
WHERE instructor_id IN (
  SELECT id FROM instructors WHERE email IN (
    'james@coachcarter.uk',
    'sarah@coachcarter.uk',
    'liam@coachcarter.uk'
  )
);

-- James: Mon–Fri 09:00–17:00, Saturday 09:00–13:00
INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
SELECT id, 1, '09:00', '17:00' FROM instructors WHERE email = 'james@coachcarter.uk'
UNION ALL
SELECT id, 2, '09:00', '17:00' FROM instructors WHERE email = 'james@coachcarter.uk'
UNION ALL
SELECT id, 3, '09:00', '17:00' FROM instructors WHERE email = 'james@coachcarter.uk'
UNION ALL
SELECT id, 4, '09:00', '17:00' FROM instructors WHERE email = 'james@coachcarter.uk'
UNION ALL
SELECT id, 5, '09:00', '17:00' FROM instructors WHERE email = 'james@coachcarter.uk'
UNION ALL
SELECT id, 6, '09:00', '13:00' FROM instructors WHERE email = 'james@coachcarter.uk';

-- Sarah: Mon/Wed/Fri 10:00–18:00, Saturday 09:00–15:00
INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
SELECT id, 1, '10:00', '18:00' FROM instructors WHERE email = 'sarah@coachcarter.uk'
UNION ALL
SELECT id, 3, '10:00', '18:00' FROM instructors WHERE email = 'sarah@coachcarter.uk'
UNION ALL
SELECT id, 5, '10:00', '18:00' FROM instructors WHERE email = 'sarah@coachcarter.uk'
UNION ALL
SELECT id, 6, '09:00', '15:00' FROM instructors WHERE email = 'sarah@coachcarter.uk';

-- Liam: Tue/Thu/Sat 09:00–17:00, Sunday 10:00–14:00
INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
SELECT id, 2, '09:00', '17:00' FROM instructors WHERE email = 'liam@coachcarter.uk'
UNION ALL
SELECT id, 4, '09:00', '17:00' FROM instructors WHERE email = 'liam@coachcarter.uk'
UNION ALL
SELECT id, 6, '09:00', '17:00' FROM instructors WHERE email = 'liam@coachcarter.uk'
UNION ALL
SELECT id, 0, '10:00', '14:00' FROM instructors WHERE email = 'liam@coachcarter.uk';


-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT
  i.name,
  i.email,
  COUNT(ia.id) AS availability_windows
FROM instructors i
LEFT JOIN instructor_availability ia ON ia.instructor_id = i.id
GROUP BY i.id, i.name, i.email
ORDER BY i.name;

-- ============================================================
