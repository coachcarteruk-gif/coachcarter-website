// @ts-check
// Contract coverage for instructor-managed learner categories.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  let marker = `async function ${name}(`;
  let start = source.indexOf(marker);
  if (start < 0) {
    marker = `function ${name}(`;
    start = source.indexOf(marker);
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const nextPlain = source.indexOf('\nfunction ', start + 1);
  const nextCandidates = [nextAsync, nextPlain].filter(i => i >= 0);
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('learner categories', () => {
  test('migration stores a constrained instructor learner category', () => {
    const migration = read('db/migration.sql');

    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS learner_category TEXT');
    expect(migration).toContain('chk_learner_users_learner_category');
    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS primary_instructor_id INTEGER REFERENCES instructors(id)');
    expect(migration).toContain('ALTER TABLE instructor_learner_notes ADD COLUMN IF NOT EXISTS learner_category TEXT');
    expect(migration).toContain('chk_instructor_learner_notes_learner_category');
    expect(migration).toContain("learner_category IN ('regular', 'sporadic', 'inactive', 'passed')");
  });

  test('instructor learner APIs read, validate, and upsert category', () => {
    const api = read('api/instructor.js');
    const list = functionBody(api, 'handleMyLearners');
    const getNotes = functionBody(api, 'handleLearnerNotes');
    const saveNotes = functionBody(api, 'handleUpdateLearnerNotes');

    expect(api).toContain("const LEARNER_CATEGORIES = new Set(['regular', 'sporadic', 'inactive', 'passed'])");
    expect(list).toContain('iln.learner_category');
    expect(list).toContain('AND iln.school_id = ${schoolId}');
    expect(list).toContain('LEFT JOIN instructor_learner_notes iln');
    expect(list).toContain('LEFT JOIN learner_credit_balances lcb');
    expect(list).toContain('OR lu.primary_instructor_id = ${instructor.id}');
    expect(list).toContain('OR lcb.id IS NOT NULL');
    expect(list).toContain('GROUP BY lu.id, lcb.balance_minutes, iln.notes, iln.test_date, iln.custom_hourly_rate_pence, iln.learner_category');
    expect(getNotes).toContain('custom_hourly_rate_pence, learner_category');
    expect(getNotes).toContain('learner_category: row?.learner_category || null');
    expect(saveNotes).toContain('normaliseLearnerCategory(learner_category)');
    expect(saveNotes).toContain("return res.status(400).json({ error: 'Invalid learner category' })");
    expect(saveNotes).toContain('learner_category = ${category}');
  });

  test('instructor learners UI exposes category filters and detail picker', () => {
    const html = read('public/instructor/learners.html');
    const js = read('public/instructor/learners.js');
    const render = functionBody(js, 'renderLearners');
    const save = functionBody(js, 'saveLearnerNotes');

    expect(html).toContain('data-category-filter="regular"');
    expect(html).toContain('data-category-filter="sporadic"');
    expect(html).toContain('data-category-filter="inactive"');
    expect(html).toContain('data-category-filter="passed"');
    expect(render).toContain('currentCategoryFilter');
    expect(render).toContain('l.learner_category === currentCategoryFilter');
    expect(js).toContain('id="detail-learner-category"');
    expect(save).toContain('learner_category: learnerCategory');
  });

  test('admin learner APIs expose global category, assignment, hours, availability, and relationship categories', () => {
    const api = read('api/admin.js');
    const list = functionBody(api, 'handleAllLearners');
    const detail = functionBody(api, 'handleLearnerDetail');
    const save = functionBody(api, 'handleUpdateLearner');
    const saveRelationship = functionBody(api, 'handleUpdateLearnerRelationship');

    expect(api).toContain("if (action === 'update-learner-relationship') return handleUpdateLearnerRelationship(req, res);");
    expect(api).toContain("const LEARNER_CATEGORIES = new Set(['regular', 'sporadic', 'inactive', 'passed'])");
    expect(list).toContain('lu.learner_category');
    expect(list).toContain('lu.primary_instructor_id');
    expect(list).toContain('pi.name AS primary_instructor_name');
    expect(list).toContain('AS delivered_minutes');
    expect(detail).toContain('const instructorLinks = await sql`');
    expect(detail).toContain('WITH related_instructors AS');
    expect(detail).toContain('iln.learner_category AS relationship_category');
    expect(detail).toContain('FROM learner_credit_balances');
    expect(detail).toContain('const availability = await sql`');
    expect(detail).toContain('FROM learner_availability');
    expect(save).toContain('normaliseLearnerCategory(learner_category)');
    expect(save).toContain('primary_instructor_id = ${newPrimaryInstructorId}');
    expect(save).toContain('test_date = ${newTestDate}');
    expect(save).toContain('ensureInstructorLearnerLink(sql, {');
    expect(api).toContain('async function ensureInstructorLearnerLink');
    expect(saveRelationship).toContain('INSERT INTO instructor_learner_notes');
    expect(saveRelationship).toContain('learner_category = ${category}');
    expect(saveRelationship).toContain("action: 'admin.update_learner_relationship'");
  });

  test('admin learner UI has category filters, assigned instructor edit, and learner detail sections', () => {
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');
    const render = functionBody(js, 'renderLearners');
    const detail = functionBody(js, 'showLearnerDetail');
    const save = functionBody(js, 'saveEditLearner');
    const saveRelationship = functionBody(js, 'updateLearnerRelationshipCategory');

    expect(html).toContain('id="learner-category-filters"');
    expect(html).toContain('data-action="filter-learner-category" data-category="regular"');
    expect(html).toContain('id="learner-edit-category"');
    expect(html).toContain('id="learner-edit-primary-instructor"');
    expect(html).toContain('id="learner-edit-test-date"');
    expect(js).toContain('function learnerCategoryBadge(category)');
    expect(render).toContain('currentLearnerCategoryFilter');
    expect(render).toContain('learnerCategoryBadge(l.learner_category)');
    expect(detail).toContain('Instructor Relationships');
    expect(detail).toContain('Edit assignment');
    expect(detail).toContain('formatAvailability(data.availability || [])');
    expect(js).toContain('function learnerRelationshipCategorySelect(link)');
    expect(js).toContain('data-action="update-learner-relationship-category"');
    expect(js).toContain("else if (a === 'open-edit-learner') openEditLearner();");
    expect(save).toContain('learner_category: document.getElementById(\'learner-edit-category\').value || null');
    expect(save).toContain('primary_instructor_id: document.getElementById(\'learner-edit-primary-instructor\').value || null');
    expect(saveRelationship).toContain("'/api/admin?action=update-learner-relationship'");
  });
});
