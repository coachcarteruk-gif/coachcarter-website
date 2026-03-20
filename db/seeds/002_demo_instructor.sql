-- Demo instructor for the public booking demo page (/demo/book.html)
-- This instructor is excluded from real booking flows via email filter in the API.
-- After running this, note the returned ID and set DEMO_INSTRUCTOR_ID in /public/demo/book.html.

INSERT INTO instructors (name, email, bio, buffer_minutes, active)
VALUES (
  'Demo Instructor',
  'demo@coachcarter.uk',
  'This is a demo instructor to preview the booking experience.',
  0,
  true
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Full availability: 7 days a week, 07:00–21:00
-- Run after the INSERT above, replacing DEMO_ID with the returned id.
-- Example: If the returned id is 5, replace all occurrences of DEMO_ID with 5.

-- To run as a single block, use a CTE:
WITH demo AS (
  SELECT id FROM instructors WHERE email = 'demo@coachcarter.uk'
)
INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time, active)
SELECT demo.id, d.dow, '07:00'::time, '21:00'::time, true
FROM demo, (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(dow)
ON CONFLICT DO NOTHING;
