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

test.describe('learner progress driving plan flow copy', () => {
  test('progress page is reframed as a learner driving plan', () => {
    const html = read('public/learner/progress.html');

    expect(html).toContain('<title>My Driving Plan | Coach Carter</title>');
    expect(html).toContain('My <em>driving plan</em>.');
    expect(html).toContain('Start your driving plan');
    expect(html).toContain('Log a drive');
    expect(html).toContain('Recent activity');
    expect(html).toContain('Full skill breakdown');

    expect(html).not.toContain('DL25 profile');
    expect(html).not.toContain('competency profile');
    expect(html).not.toContain('Competency overview');
    expect(html).not.toContain('Practice level');
    expect(html).not.toContain('Quick actions');
  });

  test('first screen renders 1-3 learner next actions before stats', () => {
    const html = read('public/learner/progress.html');
    const source = read('public/learner/progress.js');

    expect(html.indexOf('id="next-actions-section"')).toBeLessThan(html.indexOf('id="stats-grid"'));
    expect(source).toContain('function renderNextActions()');
    expect(source).toContain("'<h2 class=\"section-title\">Practise next</h2>'");
    expect(source).toContain('for (var a = 0; a < actions.length && a < 3; a++)');
    expect(source).toContain('Log a drive with this focus');
    expect(source).toContain('renderNextActions();');
    expect(source.indexOf('renderNextActions();')).toBeLessThan(source.indexOf('renderStats();'));
  });

  test('technical report labels are softened or kept in formal mock context', () => {
    const source = read('public/learner/progress.js');

    expect(source).toContain('Going well');
    expect(source).toContain('Mock test results');
    expect(source).toContain('Most useful areas to revisit');
    expect(source).toContain('formal mock test');

    expect(source).not.toContain('Areas for Improvement');
    expect(source).not.toContain('Most-faulted skills');
    expect(source).not.toContain('Practice level');
    expect(source).not.toContain('Run a mock test');
    expect(source).not.toContain('Quiz accuracy:');
  });

  test('recent Practice Drive summaries are shown in recent activity', () => {
    const html = read('public/learner/progress.html');
    const source = read('public/learner/progress.js');

    expect(html).toContain('id="recent-practice-section"');
    expect(source).toContain('function summarizeFocusedPracticeSession(row)');
    expect(source).toContain('function renderRecentPractice()');
    expect(source).toContain('DATA.recent_focused_practice');
    expect(source).toContain("struggled: 'Tell instructor'");
    expect(source).toContain('Practice Drive summary');
    expect(source).toContain("renderSignalSourceBadge('supervisor-reflection')");
    expect(source).toContain("area.tellInstructor ? ' tell' : ''");
    expect(source).toContain("meta.push('Tell instructor ' + item.tellInstructorCount)");
    expect(source).toContain('renderRecentPractice();');
  });

  test('weekly summary appears near the top and is computed from existing reads', () => {
    const html = read('public/learner/progress.html');
    const source = read('public/learner/progress.js');
    const api = read('api/learner.js');

    expect(html).toContain('id="weekly-summary-section"');
    expect(html.indexOf('id="next-actions-section"')).toBeLessThan(html.indexOf('id="weekly-summary-section"'));
    expect(html.indexOf('id="weekly-summary-section"')).toBeLessThan(html.indexOf('Recent activity'));

    expect(source).toContain('function renderWeeklySummary()');
    expect(source).toContain('renderWeeklySummary();');
    expect(source.indexOf('renderNextActions();')).toBeLessThan(source.indexOf('renderWeeklySummary();'));
    expect(source.indexOf('renderWeeklySummary();')).toBeLessThan(source.indexOf('renderStats();'));
    expect(source).toContain('DATA.recent_sessions');
    expect(source).toContain('buildWeeklySkillSignals()');
    expect(source).toContain("DATA.recent_focused_practice");
    expect(source).toContain('quizMap');
    expect(source).toContain('recentSkillFaultMap');
    expect(source).not.toContain("ccAuth.fetchAuthed('/api/learner?action=weekly");

    expect(api).toContain('const recentSessions = await sql`');
    expect(api).toContain('SELECT id, session_date::text, duration_minutes, session_type, created_at');
    expect(api).toContain('WHERE user_id = ${user.id} AND school_id = ${schoolId}');
    expect(api).toContain("AND session_type != 'onboarding'");
    expect(api).toContain('recent_sessions: recentSessions');
  });

  test('weekly summary stays honest in low-data states', () => {
    const source = read('public/learner/progress.js');
    const body = functionBody(source, 'renderWeeklySummary');

    expect(body).toContain('No saved practice this week yet.');
    expect(body).toContain('Not enough saved evidence yet.');
    expect(body).toContain('This is a gentle signal from the practice data available here.');
    expect(body).toContain('Log a drive or save a Practice Drive');
    expect(body).not.toContain('saved progress');
  });

  test('weekly summary keeps signal source labels separate and avoids formal mark wording', () => {
    const source = read('public/learner/progress.js');
    const body = functionBody(source, 'renderWeeklySummary');
    const itemBody = functionBody(source, 'renderWeeklyCardItem');

    expect(body).toContain("['learner-reflection', 'quiz-practice']");
    expect(body).toContain("['practice-drive']");
    expect(body).toContain("['instructor-assessment']");
    expect(source).toContain("source: 'practice-drive'");
    expect(source).toContain("source: 'quiz-practice'");
    expect(source).toContain("source: 'formal-mock'");
    expect(source).toContain("source: 'instructor-assessment'");
    expect(itemBody).toContain('renderSignalSourceBadge');

    ['fault', 'serious', 'dangerous', 'pass', 'fail'].forEach((term) => {
      expect(body.toLowerCase()).not.toContain(term);
    });
  });

  test('progress cards label informal reflections separately from formal mock assessment', () => {
    const html = read('public/learner/progress.html');
    const source = read('public/learner/progress.js');

    expect(html).toContain('.source-badge');
    expect(source).toContain('function progressSourceLabel(sourceKey)');
    expect(source).toContain('Learner reflection');
    expect(source).toContain('Supervisor reflection');
    expect(source).toContain('Formal mock');
    expect(source).toContain('Instructor assessment');
    expect(source).toContain('function renderSignalSourceBadge(sourceKey)');
    expect(source).toContain('function latestReflectionSource(skillKey)');
    expect(source).toContain('source: latestReflectionSource(item.skill.key)');
    expect(source).toContain("source: 'formal-mock'");
    expect(source).toContain("renderSignalSourceBadge('formal-mock') + renderSignalSourceBadge('instructor-assessment')");
  });

  test('Practice Drive summary copy avoids formal assessment wording', () => {
    const source = read('public/learner/progress.js');
    const summaryBody = functionBody(source, 'renderRecentPractice');

    ['DL25', 'fault', 'serious', 'dangerous', 'readiness', 'competency'].forEach((term) => {
      expect(summaryBody.toLowerCase()).not.toContain(term.toLowerCase());
    });
  });
});
