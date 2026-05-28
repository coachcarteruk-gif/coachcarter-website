const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('1-hour lesson opt-in contract', () => {
  test('migration activates the seeded paid 1-hour lesson type', () => {
    const migration = read('db/migration.sql');

    expect(migration).toContain("('1-Hour Lesson', '1hr', 60, 5500, '#f59e0b', false, 4)");
    expect(migration).toContain("UPDATE lesson_types\n   SET name = '1-Hour Lesson'");
    expect(migration).toContain("active = true");
    expect(migration).toContain("WHERE slug = '1hr'");
  });

  test('shared helper keeps 1hr opt-in-only when offered_lesson_types is null', () => {
    const helpers = require('../api/_lesson-type-helpers');

    expect(helpers.OPT_IN_ONLY_LESSON_TYPE_SLUGS).toContain('1hr');
    expect(helpers.isLessonTypeOffered(null, 'standard')).toBe(true);
    expect(helpers.isLessonTypeOffered(null, '1hr')).toBe(false);
    expect(helpers.isLessonTypeOffered(['standard', '1hr'], '1hr')).toBe(true);
  });

  test('lesson type and slot APIs apply the opt-in-only helper', () => {
    const lessonTypesApi = read('api/lesson-types.js');
    const slotsApi = read('api/slots.js');

    expect(lessonTypesApi).toContain("const { isLessonTypeOffered } = require('./_lesson-type-helpers');");
    expect(lessonTypesApi).toContain('rows = rows.filter(lt => isLessonTypeOffered(instr.offered_lesson_types, lt.slug));');

    expect(slotsApi).toContain("const { isOptInOnlyLessonTypeSlug, isLessonTypeOffered } = require('./_lesson-type-helpers');");
    expect(slotsApi).toContain('const implicitOfferAllowed = !isOptInOnlyLessonTypeSlug(lessonType.slug);');
    expect(slotsApi).toContain('((${implicitOfferAllowed} AND i.offered_lesson_types IS NULL) OR i.offered_lesson_types @>');
    expect(slotsApi).toContain('} else if (!isLessonTypeOffered(offered, lt.slug)) {');
    expect(slotsApi).toContain('function rejectLessonTypeNotOffered(res)');
    expect(slotsApi).toContain('This instructor does not currently offer that lesson length.');
    expect(slotsApi).toContain('SELECT id, name, email, phone, max_travel_minutes, offered_lesson_types FROM instructors');
    expect(slotsApi).toContain('if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {');
  });

  test('instructor profile shows 1hr unchecked by default and stores explicit opt-ins', () => {
    const js = read('public/instructor/profile.js');

    expect(js).toContain("const OPT_IN_ONLY_LESSON_TYPE_SLUGS = ['1hr'];");
    expect(js).toContain('function isLessonTypeEnabledByProfile(slug)');
    expect(js).toContain('return !isOptInOnlyLessonType(slug);');
    expect(js).toContain('var isEnabled = isLessonTypeEnabledByProfile(lt.slug);');
    expect(js).toContain('var optInOnlyEnabled = enabledSlugs.some(isOptInOnlyLessonType);');
    expect(js).toContain('var offeredPayload = (enabledSlugs.length === allSlugs.length && !optInOnlyEnabled) ? null : enabledSlugs;');
  });

  test('buy credits only shows single-lesson cards offered by the selected instructor and allows 1 hour checkout', () => {
    const buyCredits = read('public/learner/buy-credits.js');
    const creditsApi = read('api/credits.js');

    expect(buyCredits).toContain("if (!currentInstructorId) {\n      lessonTypes = [];");
    expect(buyCredits).toContain("'/api/lesson-types?action=list&instructor_id=' + encodeURIComponent(currentInstructorId)");
    expect(buyCredits).toContain('await loadLessonTypes();');

    expect(creditsApi).toContain('const MIN_HOURS_PER_PURCHASE = 1;');
    expect(creditsApi).toContain('hours < MIN_HOURS_PER_PURCHASE');
    expect(creditsApi).toContain('Hours must be between ${MIN_HOURS_PER_PURCHASE} and ${MAX_HOURS_PER_PURCHASE}');
  });
});
