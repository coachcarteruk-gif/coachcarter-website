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

test.describe('instructor learner teaching summary', () => {
  test('learner detail loads and prefers shared competency labels', () => {
    const html = read('public/instructor/learners.html');
    const source = read('public/instructor/learners.js');
    const helper = functionBody(source, 'getInstructorSkillLabel');
    const detail = functionBody(source, 'renderDetail');

    expect(html.indexOf('<script src="/competency-config.js"></script>')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('<script src="/competency-config.js"></script>')).toBeLessThan(html.indexOf('<script src="/instructor/learners.js"></script>'));

    expect(helper).toContain('window.CC_COMPETENCY.mapLegacySkill(skillKey)');
    expect(helper).toContain('window.CC_COMPETENCY.getSkill(mapped)');
    expect(helper.indexOf('mapLegacySkill(skillKey)')).toBeLessThan(helper.indexOf('getSkill(mapped)'));
    expect(helper.indexOf('getSkill(mapped)')).toBeLessThan(helper.indexOf('formatRawSkillLabel(skillKey)'));

    expect(detail).toContain('esc(getInstructorSkillLabel(r.skill_key))');
    expect(detail).not.toContain("r.skill_key.replace(/_/g, ' ')");
  });

  test('legacy skill labels have a local fallback for instructor detail', () => {
    const source = read('public/instructor/learners.js');

    expect(source).toContain('const INSTRUCTOR_SKILL_LABEL_FALLBACKS = {');
    expect(source).toContain("speed_choice: 'Positioning'");
    expect(source).toContain("move_off_13: 'Move Off'");
    expect(source).toContain("reverse_park_5: 'Manoeuvres'");
  });

  test('teaching summary renders mock, focus, practice, test date, and trend signals', () => {
    const source = read('public/instructor/learners.js');
    const summary = functionBody(source, 'summarizeLearnerTeachingSignals');
    const render = functionBody(source, 'renderTeachingSummary');
    const detail = functionBody(source, 'renderDetail');

    expect(summary).toContain('latestMock: mockTestTeachingSummary(mocks[0] || null)');
    expect(summary).toContain('focusAreas: collectTeachingFocusAreas(historyData, { mock_tests: mocks })');
    expect(summary).toContain('practice: summarizePracticeSignal(historyData)');
    expect(summary).toContain("testDate: notesData && notesData.test_date ? formatDate(notesData.test_date) : ''");
    expect(summary).toContain('trend: summarizeLessonTrend(historyData)');

    expect(render).toContain('Teaching summary');
    expect(render).toContain('Latest mock');
    expect(render).toContain('Current focus');
    expect(render).toContain('Practice Drive');
    expect(render).toContain("renderInstructorSourceBadge('formal-mock')");
    expect(render).toContain("renderInstructorSourceBadge('instructor-assessment')");
    expect(render).toContain("renderInstructorSourceBadge('mixed-signals')");
    expect(render).toContain("renderInstructorSourceBadge('supervisor-reflection')");
    expect(source).toContain('Tell instructor flagged');

    expect(detail.indexOf('renderTeachingSummary(summarizeLearnerTeachingSignals(data, notesData, mockData))')).toBeLessThan(detail.indexOf('renderPrivatePracticeSummaries(data.private_practice || [])'));
  });

  test('learner detail labels lesson log, Practice Drive, and mock-test signal sources distinctly', () => {
    const source = read('public/instructor/learners.js');
    const html = read('public/instructor/learners.html');
    const detail = functionBody(source, 'renderDetail');
    const practice = functionBody(source, 'renderPrivatePracticeSummaries');

    expect(html).toContain('.signal-source-badge');
    expect(source).toContain('function instructorSourceLabel(sourceKey)');
    expect(source).toContain('Lesson log');
    expect(source).toContain('Learner reflection');
    expect(source).toContain('Supervisor reflection');
    expect(source).toContain('Quiz practice');
    expect(source).toContain('Formal mock');
    expect(source).toContain('Instructor assessment');
    expect(detail).toContain("renderInstructorSourceBadge('lesson-log') + renderInstructorSourceBadge('learner-reflection')");
    expect(detail).toContain("renderInstructorSourceBadge('formal-mock')");
    expect(detail).toContain("renderInstructorSourceBadge('instructor-assessment')");
    expect(practice).toContain("renderInstructorSourceBadge('supervisor-reflection')");
  });

  test('summary uses existing learner detail endpoints only', () => {
    const source = read('public/instructor/learners.js');
    const openLearner = functionBody(source, 'openLearner');

    expect(openLearner).toContain("ccAuth.fetchAuthed('/api/instructor?action=learner-history&learner_id=' + id)");
    expect(openLearner).toContain("ccAuth.fetchAuthed('/api/instructor?action=learner-notes&learner_id=' + id)");
    expect(openLearner).toContain("ccAuth.fetchAuthed('/api/instructor?action=learner-mock-tests&learner_id=' + id)");
    expect((openLearner.match(/ccAuth\.fetchAuthed\('/g) || []).length).toBe(3);
  });

  test('instructor alerts render from existing learner detail data only', () => {
    const source = read('public/instructor/learners.js');
    const detail = functionBody(source, 'renderDetail');
    const builder = functionBody(source, 'buildInstructorAlerts');
    const render = functionBody(source, 'renderInstructorAlerts');

    expect(source).toContain('function buildInstructorAlerts(historyData, notesData, mockData)');
    expect(source).toContain('function renderInstructorAlerts(alerts)');
    expect(detail).toContain('renderInstructorAlerts(buildInstructorAlerts(data, notesData, mockData))');
    expect(detail.indexOf('renderTeachingSummary(summarizeLearnerTeachingSignals(data, notesData, mockData))')).toBeLessThan(detail.indexOf('renderInstructorAlerts(buildInstructorAlerts(data, notesData, mockData))'));
    expect(detail.indexOf('renderInstructorAlerts(buildInstructorAlerts(data, notesData, mockData))')).toBeLessThan(detail.indexOf('renderPrivatePracticeSummaries(data.private_practice || [])'));

    expect(builder).toContain('historyData && historyData.private_practice');
    expect(builder).toContain('notesData && notesData.test_date');
    expect(source).toContain('function latestInstructorActivityDate(historyData)');
    expect(functionBody(source, 'latestInstructorActivityDate')).toContain('historyData && historyData.bookings');
    expect(builder).toContain('latestFormalInstructorMock(mockData)');
    expect(builder).toContain('collectInstructorAlertFocus(historyData, mockData)');
    expect(source).not.toContain("ccAuth.fetchAuthed('/api/instructor?action=learner-alerts");

    expect(render).toContain('Instructor alerts');
    expect(render).toContain('renderInstructorSourceBadge');
  });

  test('instructor alerts keep source labels separate and non-automated', () => {
    const source = read('public/instructor/learners.js');
    const builder = functionBody(source, 'buildInstructorAlerts');
    const render = functionBody(source, 'renderInstructorAlerts');
    const alertText = (builder + '\n' + render).toLowerCase();

    expect(builder).toContain("sources: ['practice-drive', 'supervisor-reflection']");
    expect(builder).toContain("sources: ['formal-mock', 'instructor-assessment']");
    expect(builder).toContain("sources: ['learner-reflection', 'practice-drive']");
    expect(builder).toContain('sourceKeys.map(instructorSourceLabel)');
    expect(builder).toContain('Worth asking about');
    expect(builder).toContain('Consider a formal mock');
    expect(builder).toContain('No recent saved practice');
    expect(builder).toContain('Repeated focus: ');

    ['email', 'sms', 'whatsapp', 'notification', 'notify', 'automation', 'background job'].forEach((term) => {
      expect(alertText).not.toContain(term);
    });
  });

  test('Practice Drive alerts avoid formal assessment wording', () => {
    const source = read('public/instructor/learners.js');
    const builder = functionBody(source, 'buildInstructorAlerts');
    const practiceStart = builder.indexOf("title: 'Practice Drive flagged '");
    const practiceEnd = builder.indexOf('const testDate', practiceStart);
    const practiceBlock = builder.slice(practiceStart, practiceEnd).toLowerCase();

    expect(practiceBlock).toContain('tell instructor');
    expect(practiceBlock).toContain('practice drive reflections');
    ['fault', 'serious', 'dangerous', 'pass', 'fail'].forEach((term) => {
      expect(practiceBlock).not.toContain(term);
    });
  });
});
