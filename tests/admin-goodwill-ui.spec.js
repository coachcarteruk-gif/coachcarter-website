const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const portalJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'portal.js'), 'utf8');
const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'portal.html'), 'utf8');

test.describe('admin goodwill credit UI', () => {
  test('adds the operator affordance to the existing learner detail surface', () => {
    expect(portalHtml).toContain('id="section-learners"');
    expect(portalJs).toContain('data-action="open-goodwill-credit"');
    expect(portalJs).toContain('Grant goodwill');
    expect(portalJs).toContain('Adjust instructor balance');
    expect(portalHtml).not.toContain('data-section="credit-goodwill"');
  });

  test('submits the goodwill grant through the admin-authenticated endpoint', () => {
    expect(portalJs).toContain("fetchAdmin('/api/admin?action=credit-goodwill'");
    expect(portalJs).toContain("fetchAdmin('/api/admin?action=all-instructors'");
    expect(portalJs).toContain('learner_id: _goodwillLearnerId');
    expect(portalJs).toContain('instructor_id: instructorId');
    expect(portalJs).toContain('minutes,');
    expect(portalJs).toContain('absorbed_by: absorbed');
    expect(portalJs).toContain('reason');
    expect(portalJs).not.toContain("fetchAdmin('/api/admin?action=credit-goodwill-inspection'");
  });

  test('pins operator copy for payout consequences and visible states', () => {
    expect(portalJs).toContain('Learner gets free credit; instructor is still paid when the lesson is delivered.');
    expect(portalJs).toContain('Learner gets free credit; the matching lesson is excluded from instructor payout.');
    expect(portalJs).toContain('Granting goodwill credit...');
    expect(portalJs).toContain('Goodwill credit granted. New instructor balance: ');
    expect(portalJs).toContain('Failed to grant goodwill credit');
  });
});

test.describe('admin instructor-scoped credit adjustment UI', () => {
  test('adjust-credits modal requires an instructor and sends instructor_id', () => {
    expect(portalJs).toContain('Adjust instructor credit balance');
    expect(portalJs).toContain('Instructor balance to adjust');
    expect(portalJs).toContain('Credit is scoped per instructor. Choose the instructor whose balance should change.');
    expect(portalJs).toContain("const options = await ensureGoodwillInstructorOptions();");
    expect(portalJs).toContain("const instructorId = parseInt(document.getElementById('adj-instructor-select')?.value, 10);");
    expect(portalJs).toContain("if (!instructorId) return alert('Choose the instructor balance to adjust');");
    expect(portalJs).toContain('instructor_id: instructorId');
  });

  test('adjust-credits ambiguity response asks the admin to choose an instructor', () => {
    expect(portalJs).toContain("data.error === 'AMBIGUOUS_INSTRUCTOR'");
    expect(portalJs).toContain("data.code === 'AMBIGUOUS_INSTRUCTOR'");
    expect(portalJs).toContain("Choose the instructor balance to adjust, then try again.");
    expect(portalJs).toContain('New total across instructors: ');
  });
});
