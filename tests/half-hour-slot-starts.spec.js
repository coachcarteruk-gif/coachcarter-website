// Static contract tests for half-hour lesson booking starts.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('half-hour slot starts', () => {
  test('slot availability advances candidate starts every 30 minutes', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('const SLOT_START_INCREMENT_MINUTES = 30;');
    expect(slots).toContain('const slotStartIncrementMinutes = SLOT_START_INCREMENT_MINUTES;');
    expect(slots).not.toContain('slotStart += slotMinutes;');
    expect(slots.match(/slotStart \+= slotStartIncrementMinutes/g)?.length || 0).toBeGreaterThanOrEqual(6);
  });

  test('manual booking time pickers use half-hour starts', () => {
    const files = [
      'public/admin/portal.html',
      'public/instructor/dashboard.html',
      'public/instructor/index.html',
      'public/shared/instructor-booking-actions.js'
    ];

    for (const file of files) {
      const content = read(file);
      expect(content).not.toContain('step="900"');
    }

    expect(read('public/instructor/index.html').match(/step="1800"/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(read('public/shared/instructor-booking-actions.js').match(/step="1800"/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });

  test('learner availability windows can be set on half-hours', () => {
    const profile = read('public/learner/profile.js');

    expect(profile).toContain("for (const m of ['00', '30'])");
    expect(profile).toContain("if (h === 21 && m === '30') continue;");
    expect(profile).not.toContain("for (const m of ['00', '15', '30', '45'])");
  });
});
