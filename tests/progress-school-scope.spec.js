const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

test.describe('progress school scope contracts', () => {
  test('learner session and onboarding progress writes carry school_id', () => {
    const source = read('api/learner.js');

    expect(source).toContain('LEFT JOIN skill_ratings r ON r.session_id = s.id AND r.school_id = ${schoolId}');
    expect(source).toContain('INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating, note, driving_faults, serious_faults, dangerous_faults, school_id)');
    expect(source).toContain('${r.driving_faults || 0}, ${r.serious_faults || 0}, ${r.dangerous_faults || 0}, ${schoolId})');
    expect(source).toContain("WHERE user_id = ${user.id} AND session_type = 'onboarding' AND school_id = ${schoolId}");
    expect(source).toContain("INSERT INTO driving_sessions (user_id, session_date, duration_minutes, session_type, notes, school_id)");
    expect(source).toContain('INSERT INTO skill_ratings (session_id, user_id, tier, skill_key, rating, school_id)');
    expect(source).toContain('VALUES (${sessionId}, ${user.id}, 0, ${r.skill_key}, ${r.rating}, ${schoolId})');
  });

  test('learner progress and mock-test reads do not aggregate cross-school child rows', () => {
    const source = read('api/learner.js');

    expect(source).toContain('FROM skill_ratings WHERE user_id = ${user.id} AND school_id = ${schoolId}');
    expect(source).toContain('LEFT JOIN mock_test_faults f ON f.mock_test_id = mt.id AND f.school_id = ${schoolId}');
    expect(source).toContain('WHERE mock_test_id = ${mock_test_id} AND part = ${part} AND school_id = ${schoolId}');
    expect(source).toContain('JOIN mock_tests mt ON mt.id = f.mock_test_id AND mt.school_id = f.school_id');
    expect(source).toContain('JOIN driving_sessions ds ON ds.id = fp.session_id AND ds.school_id = fp.school_id');
  });

  test('instructor learner history scopes bookings, session logs, and ratings by school_id', () => {
    const source = read('api/instructor.js');

    expect(source).toContain('LEFT JOIN driving_sessions ds ON ds.booking_id = lb.id AND ds.school_id = ${schoolId}');
    expect(source).toContain('AND lb.school_id = ${schoolId}');
    expect(source).toContain('WHERE session_id = ANY(${loggedIds}) AND school_id = ${schoolId} ORDER BY id');
    expect(source).toContain('LEFT JOIN mock_test_faults f ON f.mock_test_id = mt.id AND f.school_id = ${schoolId}');
  });
});
