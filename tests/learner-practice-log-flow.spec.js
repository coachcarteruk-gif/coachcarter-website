const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
const visibleText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

test.describe('learner practice and log-session flow copy', () => {
  test('practice hub promotes learner-friendly routes and keeps supervisor practice visible', () => {
    const html = read('public/learner/practice.html');

    expect(html).toContain('Log a drive');
    expect(html).toContain('Practice with a supervisor');
    expect(html).toContain('Take a mock test');
    expect(html).toContain('View my driving plan');

    expect(html.indexOf('Practice with a supervisor')).toBeLessThan(html.indexOf('Take a mock test'));
    expect(html).not.toContain('>LOG<');
    expect(html).not.toContain('>MOCK<');
    expect(html).not.toContain('>FCS<');
    expect(html).not.toContain('>TRK<');
    expect(html).not.toContain('Competency scores');
    expect(html).not.toContain('readiness');
  });

  test('log session defaults to traffic-light reflection and hides formal marks', () => {
    const html = read('public/learner/log-session.html');
    const source = read('public/learner/log-session.js');

    expect(source).toContain("let currentType = 'private';");
    expect(html).toContain('<button class="type-btn selected" id="btn-private">Private practice</button>');
    expect(html).toContain('Needs work');
    expect(html).toContain('Getting there');
    expect(html).toContain('Confident');
    expect(html).toContain('.fault-row {\n      display: none;');
    expect(html).toContain('id="advanced-instructor-panel" hidden');
    expect(html).toContain('Advanced instructor notes');
    expect(html).not.toContain('Optional fault counters');
    expect(source).toContain('function shouldUseFormalMarks()');
    expect(source).toContain("return currentType === 'instructor' && advancedMarksOpen;");
    expect(source).toContain("const f = shouldUseFormalMarks() ? (faults[skill_key] || { driving: 0, serious: 0, dangerous: 0 }) : { driving: 0, serious: 0, dangerous: 0 };");
  });

  test('successful save explains that the driving plan changed', () => {
    const html = read('public/learner/log-session.html');

    expect(html).toContain('Saved as a drive-log learner reflection.');
    expect(html).toContain('Your driving plan now uses these ratings to suggest what to practise next.');
    expect(html).toContain('href="/learner/progress.html"');
    expect(html).toContain('View my driving plan');
  });

  test('focused-practice route is framed as a private practice drive', () => {
    const html = read('public/learner/focused-practice.html');
    const source = read('public/learner/focused-practice.js');

    expect(html).toContain('<title>Practice Drive | Coach Carter</title>');
    expect(html).toContain('Practice with a supervisor');
    expect(html).toContain('<h1><em>Practice</em> drive.</h1>');
    expect(html).toContain('Pick 1 to 3 simple focus areas before you set off.');
    expect(html).toContain('Start practice drive');
    expect(html).toContain('View my driving plan');

    expect(source).toContain("var scoreText = score > 0 ? 'Suggested' : 'Pick';");
    expect(source).toContain('practice drive completed. Saved as a supervisor reflection.');
    expect(source).toContain("apiCall('POST', 'focused-practice'");
    expect(source).not.toContain('take a mock test');
    expect(html).not.toContain('Targeted drill');
    expect(html).not.toContain('weakest areas');
  });

  test('focused-practice reflection uses simple supervisor labels and prompts', () => {
    const source = read('public/learner/focused-practice.js');

    expect(source).toContain("{ key: 'nailed', label: 'Went well' }");
    expect(source).toContain("{ key: 'ok', label: 'Needs practice' }");
    expect(source).toContain("{ key: 'struggled', label: 'Tell instructor' }");
    expect(source).toContain('What happened?');
    expect(source).toContain('Where did it happen?');
    expect(source).toContain('Anything the instructor should know?');
    expect(source).toContain('Tell your instructor about');
    expect(source).toContain('buildPracticeNote(reflections[catKey])');
  });

  test('focused-practice visible copy avoids formal assessment terms', () => {
    const copy = visibleText(read('public/learner/focused-practice.html')).toLowerCase();

    ['mock test', 'dl25', 'fault', 'serious', 'dangerous', 'readiness', 'competency'].forEach((term) => {
      expect(copy).not.toContain(term);
    });
  });

  test('mock-test route stays clearly formal rather than ordinary supervisor practice', () => {
    const html = read('public/learner/mock-test.html');
    const source = read('public/learner/mock-test.js');

    expect(html).toContain('Formal mock setup');
    expect(html).toContain('Use this for a full test-style assessment.');
    expect(html).toContain('For ordinary private practice, start a Practice Drive from the practice hub.');
    expect(html).toContain('Supervisor marking a formal mock');
    expect(html).toContain('Full DL25 marking sheet');
    expect(source).toContain('This is still a formal mock test.');
    expect(source).toContain('Record assessment notes');
    expect(source).toContain('Formal mock / supervisor assessment.');
    expect(source).toContain('Formal mock / instructor assessment.');

    expect(html).not.toContain('Practising with a supervisor');
    expect(source).not.toContain('no exam jargon');
  });
});
