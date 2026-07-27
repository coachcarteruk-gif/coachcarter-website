const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  areOfferedLessonTypeSlugsValid,
} = require('../api/_lesson-type-helpers');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('instructor offered lesson type validation', () => {
  test('accepts any lesson type slug configured for the school', () => {
    const schoolLessonTypeSlugs = ['standard', 'trial', '1hr', 'check'];

    expect(areOfferedLessonTypeSlugsValid(['standard', 'check'], schoolLessonTypeSlugs)).toBe(true);
    expect(areOfferedLessonTypeSlugsValid(['check'], schoolLessonTypeSlugs)).toBe(true);
  });

  test('rejects malformed and unknown lesson type slugs', () => {
    const schoolLessonTypeSlugs = ['standard', 'check'];

    expect(areOfferedLessonTypeSlugsValid(null, schoolLessonTypeSlugs)).toBe(false);
    expect(areOfferedLessonTypeSlugsValid('check', schoolLessonTypeSlugs)).toBe(false);
    expect(areOfferedLessonTypeSlugsValid([''], schoolLessonTypeSlugs)).toBe(false);
    expect(areOfferedLessonTypeSlugsValid(['another-school-type'], schoolLessonTypeSlugs)).toBe(false);
  });

  test('loads valid slugs from the tenant-scoped lesson types table', () => {
    const api = read('api/instructor.js');

    expect(api).toContain("const { isLessonTypeOffered, areOfferedLessonTypeSlugsValid } = require('./_lesson-type-helpers');");
    expect(api).toContain('SELECT slug\n        FROM lesson_types\n        WHERE school_id = ${schoolId}');
    expect(api).toContain('areOfferedLessonTypeSlugsValid(offered_lesson_types, availableSlugs)');
    expect(api).not.toContain("const validSlugs = ['standard', '2hr', '3hr', 'trial', '1hr'];");
  });
});
