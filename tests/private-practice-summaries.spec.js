const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const start = source.indexOf('function ' + name);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('private practice summaries', () => {
  test('learner competency API returns recent focused-practice rows with school scope', () => {
    const source = read('api/learner.js');
    const body = functionBody(source, 'handleCompetency');

    expect(body).toContain('let recentFocusedPractice = [];');
    expect(body).toContain('recentFocusedPractice = await sql`');
    expect(body).toContain('SELECT fp.id, fp.focus_areas, fp.reflections, fp.completed_at, fp.created_at,');
    expect(body).toContain('JOIN driving_sessions ds ON ds.id = fp.session_id AND ds.school_id = fp.school_id');
    expect(body).toContain('WHERE fp.learner_id = ${user.id} AND fp.school_id = ${schoolId}');
    expect(body).toContain('if (!isMissingFocusedPracticeSchemaError(err)) throw err;');
    expect(body).toContain('focused_practice_count: focusedPracticeCount');
    expect(body).toContain('recent_focused_practice: recentFocusedPractice');
  });

  test('instructor learner history returns recent private-practice rows with school scope', () => {
    const source = read('api/instructor.js');
    const body = functionBody(source, 'handleLearnerHistory');

    expect(body).toContain('const privatePractice = await sql`');
    expect(body).toContain('SELECT fp.id, fp.focus_areas, fp.reflections, fp.completed_at, fp.created_at,');
    expect(body).toContain('JOIN driving_sessions ds ON ds.id = fp.session_id AND ds.school_id = fp.school_id');
    expect(body).toContain('WHERE fp.learner_id = ${learnerId} AND fp.school_id = ${schoolId}');
    expect(body).toContain('private_practice: privatePractice');
  });

  test('instructor learner view surfaces private practice summaries and highlights Tell instructor', () => {
    const source = read('public/instructor/learners.js');

    expect(source).toContain('function summarizePracticeDrive(row)');
    expect(source).toContain('function renderPrivatePracticeSummaries(rows)');
    expect(source).toContain("struggled: 'Tell instructor'");
    expect(source).toContain('Recent Private Practice');
    expect(source).toContain('Practice Drive');
    expect(source).toContain('item.tellInstructorCount > 0');
    expect(source).toContain("meta.push('Tell instructor ' + item.tellInstructorCount)");
    expect(source).toContain('html += renderPrivatePracticeSummaries(data.private_practice || []);');
  });

  test('private practice summary renderers avoid formal assessment wording', () => {
    const learner = functionBody(read('public/learner/progress.js'), 'renderRecentPractice');
    const instructor = functionBody(read('public/instructor/learners.js'), 'renderPrivatePracticeSummaries');
    const combined = (learner + '\n' + instructor).toLowerCase();

    ['dl25', 'fault', 'serious', 'dangerous', 'readiness', 'competency'].forEach((term) => {
      expect(combined).not.toContain(term);
    });
  });
});
