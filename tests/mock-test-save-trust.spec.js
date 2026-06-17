const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

test.describe('mock test save trust', () => {
  test('mock test creation failure does not continue with a local id', () => {
    const source = read('public/learner/mock-test.js');

    expect(source).not.toContain("mockTestId = 'local_'");
    expect(source).toContain("mockTestId = null;");
    expect(source).toContain('We could not create this mock test, so nothing has been saved yet.');
    expect(source).toContain("btn.textContent = 'Try again';");
    expect(source).toContain('return;');
  });

  test('fault and completion saves must return OK before the UI claims saved progress', () => {
    const source = read('public/learner/mock-test.js');
    const html = read('public/learner/mock-test.html');

    expect(source).toContain("if (!res.ok) throw new Error('API error ' + res.status);");
    expect(source).toContain('We could not save this round, so these ratings are not in your driving plan yet.');
    expect(source).toContain('We saved the round, but could not finish the mock test. Your results are not fully saved yet.');
    expect(source).toContain('mockTestCompleteSaved = true;');
    expect(source).toContain('mockTestCompleteSaved');
    expect(source).toContain('updateResultSaveNote();');
    expect(html).toContain('id="result-save-note"');
    expect(html).toContain('id="mock-start-status"');
    expect(html).toContain('id="mock-fault-save-status"');
  });
});
