// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test.describe('public marketing pricing copy', () => {
  test('lessons marketing pricing fetches use the same legacy instructor context as checkout', () => {
    const source = read('public/lessons.js');

    expect(source).toContain('const LEGACY_MARKETING_INSTRUCTOR_ID = 1;');
    expect(source).toContain('/api/lesson-types?action=list&school_id=1&instructor_id=');
    expect(source).toContain('/api/credits?action=bulk-pricing&school_id=1&instructor_id=');
    expect(source).toContain('instructor_id: LEGACY_MARKETING_INSTRUCTOR_ID');
  });

  test('lessons page avoids promising a universal fixed price or fixed bulk saving', () => {
    const html = read('public/lessons.html');
    const config = read('public/config.json');

    expect(html).toContain('From per hour');
    expect(html).toContain('final instructor-specific rate');
    expect(html).not.toContain('save up to 21%');
    expect(config).toContain('Package savings vary by instructor');
    expect(config).toContain('final instructor-specific rate');
  });

  test('learner journey labels static PAYG price as school default and points to live booking price', () => {
    const html = read('public/learner-journey.html');

    expect(html).toContain('Typical school-default lesson price');
    expect(html).toContain('school-default lesson');
    expect(html).toContain('Final instructor-specific price is shown before booking');
    expect(html).toContain('Package savings may be available by instructor');
    expect(html).not.toContain('From £82.50/lesson');
    expect(html).not.toContain('Save 25%');
  });
});
