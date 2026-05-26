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
    expect(portalJs).toContain('Legacy adjust');
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
    expect(portalJs).not.toContain('credit-reconciliation');
  });

  test('pins operator copy for payout consequences and visible states', () => {
    expect(portalJs).toContain('Learner gets free credit; instructor is still paid when the lesson is delivered.');
    expect(portalJs).toContain('Learner gets free credit; the matching lesson is excluded from instructor payout.');
    expect(portalJs).toContain('Granting goodwill credit...');
    expect(portalJs).toContain('Goodwill credit granted. New instructor balance: ');
    expect(portalJs).toContain('Failed to grant goodwill credit');
  });
});
