// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test.describe('public marketing pricing copy', () => {
  test('lessons marketing no longer starts self-serve credit checkout', () => {
    const source = read('public/lessons.js');

    expect(source).toContain('const LEGACY_MARKETING_INSTRUCTOR_ID = 1;');
    expect(source).toContain('/api/lesson-types?action=list&school_id=1&instructor_id=');
    expect(source).toContain('/api/credits?action=bulk-pricing&school_id=1&instructor_id=');
    expect(source).toContain('async function startBulkCheckout(pkgIndex) {\n  bookFreeTrial();\n}');
    expect(source).not.toContain("fetch('/api/credits?action=checkout'");
  });

  test('lessons page avoids promising self-serve credit packages', () => {
    const html = read('public/lessons.html');
    const home = read('public/index.html');
    const config = read('public/config.json');

    expect(html).toContain('From per hour');
    expect(html).toContain('New self-serve credit packages are retired');
    expect(html).toContain('Book a lesson');
    expect(html).not.toContain('Buy this package');
    expect(home).toContain('No new self-serve top-ups');
    expect(home).not.toContain('Save 5–25%');
    expect(html).not.toContain('save up to 21%');
    expect(config).toContain('New self-serve credit packages are retired');
    expect(config).toContain('Book a lesson');
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
