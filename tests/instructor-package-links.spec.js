// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function asyncFunctionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('instructor package links', () => {
  test('offer modal lets an instructor choose a lesson slot or package checkout', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');

    expect(html).toContain('id="offerKindLesson"');
    expect(html).toContain('Lesson slot');
    expect(html).toContain('id="offerKindPackage"');
    expect(html).toContain('Package checkout');
    expect(html).toContain('id="offerPackageNote"');
    expect(html).toContain('id="offerLessonFields"');
    expect(js).toContain("title.textContent = packageMode ? 'Share package checkout' : 'Send an offer'");
    expect(js).toContain("lessonFields.style.display = packageMode ? 'none' : 'flex'");
    expect(js).toContain("sendBtn.textContent = (existingMode || sendEmail) ? 'Send package link' : 'Create package link'");
  });

  test('package option follows the exact school catalogue feature flag', () => {
    const api = read('api/instructor.js');
    const ui = read('public/instructor/index.js');

    expect(api).toContain("s.config->'features'->'learner_packages_enabled' = 'true'::jsonb");
    expect(api).toContain('AS learner_packages_enabled');
    expect(ui).toContain('learnerPackagesEnabled = data.instructor.learner_packages_enabled === true');
    expect(ui).toContain("row.style.display = learnerPackagesEnabled ? 'flex' : 'none'");
  });

  test('share endpoint validates instructor and learner school scope', () => {
    const api = read('api/instructor.js');
    const body = asyncFunctionBody(api, 'handleSharePackageLink');

    expect(api).toContain("if (action === 'share-package-link')   return handleSharePackageLink(req, res)");
    expect(body).toContain('const instructor = verifyInstructorAuth(req)');
    expect(body).toContain('if (!isLearnerPackagesEnabled(school.config))');
    expect(body).toContain('WHERE id = ${learnerIdClean}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('AND archived_at IS NULL');
    expect(body).toContain("return res.status(404).json({ error: 'Learner not found in your school' })");
  });

  test('share endpoint only refers to the standard catalogue and never creates money state', () => {
    const body = asyncFunctionBody(read('api/instructor.js'), 'handleSharePackageLink');

    expect(body).toContain("const packageUrl = `${baseUrl}/learner/packages.html${hasPrimaryHost ? '' : `?school_id=${schoolId}`}`");
    expect(body).toContain("purpose: 'instructor.package_link_shared_learner'");
    expect(body).toContain("action: 'instructor.package_link_shared'");
    expect(body).toContain('share_url: packageUrl');
    expect(body).not.toContain('checkout.sessions.create');
    expect(body).not.toContain('INSERT INTO package_purchase');
    expect(body).not.toContain('INSERT INTO lesson_offers');
    expect(body).not.toContain('price_pence');
  });

  test('UI posts only learner identity and keeps a copyable fallback link', () => {
    const body = asyncFunctionBody(read('public/instructor/index.js'), 'sendPackageLink');

    expect(body).toContain("ccAuth.fetchAuthed('/api/instructor?action=share-package-link'");
    expect(body).toContain('? { learner_id: selectedOfferLearnerId }');
    expect(body).toContain("{ learner_name: learnerName, learner_email: sendEmail ? learnerEmail : undefined }");
    expect(body).toContain("id=\"offerShareUrl\"");
    expect(body).toContain("id=\"offerCopyBtn\"");
    expect(body).not.toContain('product_id');
    expect(body).not.toContain('price_pence');
  });
});
