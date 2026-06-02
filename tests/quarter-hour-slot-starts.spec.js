// Static contract tests for quarter-hour lesson booking starts.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('quarter-hour slot starts', () => {
  test('slot availability advances candidate starts every 15 minutes', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('const SLOT_START_INCREMENT_MINUTES = 15;');
    expect(slots).toContain('const slotStartIncrementMinutes = SLOT_START_INCREMENT_MINUTES;');
    expect(slots).not.toContain('slotStart += slotMinutes;');
    expect(slots.match(/slotStart \+= slotStartIncrementMinutes/g)?.length || 0).toBeGreaterThanOrEqual(6);
  });

  test('manual booking time pickers allow quarter-hour starts', () => {
    const files = [
      'public/admin/portal.html',
      'public/instructor/dashboard.html',
      'public/instructor/index.html',
      'public/shared/instructor-booking-actions.js'
    ];

    for (const file of files) {
      const content = read(file);
      expect(content).not.toContain('step="1800"');
    }

    expect(read('public/instructor/index.html').match(/step="900"/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(read('public/shared/instructor-booking-actions.js').match(/step="900"/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });

  test('learner availability windows can be set on quarter-hours', () => {
    const profile = read('public/learner/profile.js');

    expect(profile).toContain("for (const m of ['00', '15', '30', '45'])");
    expect(profile).toContain("if (h === 21 && m !== '00') continue;");
    expect(profile).not.toContain("for (const m of ['00', '30'])");
  });
});
