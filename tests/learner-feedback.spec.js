// @ts-check
// Contract coverage for learner feedback submissions and the admin queue.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('learner feedback', () => {
  test('migration creates a tenant-scoped feedback queue', () => {
    const migration = read('db/migration.sql');
    const step = read('db/migrations/030_learner_feedback.sql');

    for (const sql of [migration, step]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS learner_feedback');
      expect(sql).toContain('school_id   INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(sql).toContain('learner_id  INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE');
      expect(sql).toContain("type IN ('issue', 'suggestion')");
      expect(sql).toContain("status IN ('open', 'reviewed', 'closed')");
      expect(sql).toContain('idx_learner_feedback_school_status');
      expect(sql).toContain('idx_learner_feedback_learner');
    }
  });

  test('learner API stores feedback with auth, rate limit, school scope, and issue alerting', () => {
    const api = read('api/learner.js');
    const handler = functionBody(api, 'handleSubmitFeedback');

    expect(api).toContain("if (action === 'submit-feedback')       return handleSubmitFeedback(req, res);");
    expect(handler).toContain('verifyAuth(req)');
    expect(handler).toContain('key: `learner_feedback:${user.id}`');
    expect(handler).toContain('WHERE id = ${user.id} AND school_id = ${schoolId}');
    expect(handler).toContain('INSERT INTO learner_feedback');
    expect(handler).toContain('VALUES (${schoolId}, ${user.id}, ${type}, ${title}, ${message}, ${cleanPageUrl}, ${userAgent})');
    expect(handler).toContain("if (type === 'issue')");
    expect(handler).toContain("purpose: 'learner.feedback_issue'");
    expect(handler).toContain('await mailer.sendMail');
  });

  test('admin API exposes school-scoped list and audited status updates', () => {
    const api = read('api/admin.js');
    const list = functionBody(api, 'handleLearnerFeedback');
    const update = functionBody(api, 'handleUpdateLearnerFeedback');

    expect(api).toContain("if (action === 'learner-feedback') return handleLearnerFeedback(req, res);");
    expect(api).toContain("if (action === 'update-learner-feedback') return handleUpdateLearnerFeedback(req, res);");
    expect(list).toContain('verifyAdminJWT(req)');
    expect(list).toContain('WHERE lf.school_id = ${schoolId}');
    expect(list).toContain('JOIN learner_users lu');
    expect(list).toContain('lf.status = ${status}');
    expect(list).toContain('lf.type = ${type}');
    expect(update).toContain('verifyAdminJWT(req)');
    expect(update).toContain('WHERE id = ${id} AND school_id = ${schoolId}');
    expect(update).toContain("action: 'learner_feedback.update_status'");
    expect(update).toContain("targetType: 'learner_feedback'");
  });

  test('learner navigation keeps feedback hidden while admin exposes the queue', () => {
    const sidebar = read('public/sidebar.js');
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(sidebar).not.toContain("label: 'Feedback'");
    expect(sidebar).not.toContain("action: 'feedback'");
    expect(html).toContain('data-section="feedback"');
    expect(html).toContain('id="section-feedback"');
    expect(html).toContain('id="feedback-body"');
    expect(js).toContain("if (name === 'feedback')      loadLearnerFeedback();");
    expect(js).toContain("'/api/admin?action=learner-feedback&'");
    expect(js).toContain("'/api/admin?action=update-learner-feedback'");
    expect(js).toContain("else if (a === 'update-feedback-status')");
  });

  test('GDPR export and deletion cover learner feedback', () => {
    const gdpr = read('api/_gdpr.js');
    const learner = read('api/learner.js');

    expect(gdpr).toContain('DELETE FROM learner_feedback WHERE learner_id = ${learnerId}');
    expect(learner).toContain('const feedbackSubmitted = await sql`');
    expect(learner).toContain('FROM learner_feedback');
    expect(learner).toContain("'feedback_submitted'");
    expect(learner).toContain('feedback_submitted: feedbackSubmitted');
  });
});
