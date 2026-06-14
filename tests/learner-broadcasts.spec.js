// @ts-check
// Contract coverage for admin learner broadcasts.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'learner-broadcast-contract-secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_learner_broadcast_contract';

const adminHandler = require('../api/admin');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  let marker = `async function ${name}`;
  let start = source.indexOf(marker);
  if (start < 0) {
    marker = `function ${name}`;
    start = source.indexOf(marker);
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const nextAsync = source.indexOf('\nasync function ', start + 1);
  const nextPlain = source.indexOf('\nfunction ', start + 1);
  const nextCandidates = [nextAsync, nextPlain].filter(i => i >= 0);
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('admin learner broadcasts', () => {
  test('migration creates school-scoped broadcast history and recipient ledgers', () => {
    const migration = read('db/migration.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS learner_broadcasts');
    expect(migration).toContain('school_id           INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
    expect(migration).toContain('selected_categories TEXT[] NOT NULL');
    expect(migration).toContain("status IN ('sending', 'sent', 'partial_failed', 'failed')");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS learner_broadcast_recipients');
    expect(migration).toContain("status IN ('sent', 'failed', 'skipped')");
    expect(migration).toContain('FOREIGN KEY (broadcast_id, school_id) REFERENCES learner_broadcasts(id, school_id)');
    expect(migration).toContain('idx_learner_broadcasts_school_created');
    expect(migration).toContain('idx_learner_broadcast_recipients_school');
  });

  test('backend exposes preview, send, and history through admin auth and school scope', () => {
    const api = read('api/admin.js');
    const preview = functionBody(api, 'handleLearnerBroadcastPreview');
    const send = functionBody(api, 'handleSendLearnerBroadcast');
    const history = functionBody(api, 'handleLearnerBroadcastHistory');
    const resolve = functionBody(api, 'resolveLearnerBroadcastRecipients');

    expect(api).toContain("if (action === 'learner-broadcast-preview') return handleLearnerBroadcastPreview(req, res);");
    expect(api).toContain("if (action === 'send-learner-broadcast') return handleSendLearnerBroadcast(req, res);");
    expect(api).toContain("if (action === 'learner-broadcast-history') return handleLearnerBroadcastHistory(req, res);");
    expect(preview).toContain('verifyAdminJWT(req)');
    expect(send).toContain('verifyAdminJWT(req)');
    expect(history).toContain('verifyAdminJWT(req)');
    expect(resolve).toContain('WHERE school_id = ${schoolId}');
    expect(resolve).toContain('learner_category = ANY(${categories}::text[])');
    expect(send).toContain('await sendWhatsApp(learner.phone, messageBody');
    expect(send).toContain("purpose: 'admin.learner_broadcast'");
    expect(send).toContain('schoolId,');
    expect(send).toContain('INSERT INTO learner_broadcasts');
    expect(send).toContain('INSERT INTO learner_broadcast_recipients');
    expect(send).toContain("action: 'admin.send_learner_broadcast'");
    expect(history).toContain('WHERE lb.school_id = ${schoolId}');
    expect(history).toContain('WHERE school_id = ${schoolId}');
  });

  test('validation helpers dedupe categories and reject unusable phone numbers', () => {
    const { _normaliseBroadcastCategories, _normaliseBroadcastPhone } = adminHandler;

    expect(_normaliseBroadcastCategories(['Regular', 'regular', 'passed'])).toEqual({
      ok: true,
      categories: ['regular', 'passed'],
    });
    expect(_normaliseBroadcastCategories(['regular', 'vip'])).toMatchObject({
      ok: false,
      code: 'INVALID_CATEGORY',
    });
    expect(_normaliseBroadcastCategories([])).toMatchObject({
      ok: false,
      code: 'NO_CATEGORIES',
    });

    expect(_normaliseBroadcastPhone('07123 456789')).toBe('+447123456789');
    expect(_normaliseBroadcastPhone('+447123456789')).toBe('+447123456789');
    expect(_normaliseBroadcastPhone('00447123456789')).toBe('+447123456789');
    expect(_normaliseBroadcastPhone('not a phone')).toBe(null);
    expect(_normaliseBroadcastPhone('123')).toBe(null);
  });

  test('admin UI provides category selection, preview, send, and history controls', () => {
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(html).toContain('data-section="broadcasts"');
    expect(html).toContain('id="section-broadcasts"');
    expect(html).toContain('id="broadcast-label"');
    expect(html).toContain('class="broadcast-category" value="regular"');
    expect(html).toContain('class="broadcast-category" value="sporadic"');
    expect(html).toContain('class="broadcast-category" value="inactive"');
    expect(html).toContain('class="broadcast-category" value="passed"');
    expect(html).toContain('id="broadcast-preview-body"');
    expect(html).toContain('id="broadcast-history-body"');
    expect(js).toContain("if (name === 'broadcasts')    loadBroadcastHistory();");
    expect(js).toContain("'/api/admin?action=learner-broadcast-preview'");
    expect(js).toContain("'/api/admin?action=send-learner-broadcast'");
    expect(js).toContain("'/api/admin?action=learner-broadcast-history&limit=20'");
    expect(js).toContain("if (!latestBroadcastPreview) return setBroadcastStatus('Preview recipients before sending.'");
    expect(js).toContain("t.dataset.action === 'broadcast-dirty'");
  });

  test('GDPR export and deletion cover learner broadcast recipient PII', () => {
    const gdpr = read('api/_gdpr.js');
    const learner = read('api/learner.js');

    expect(gdpr).toContain('async function learnerBroadcastTablesExist');
    expect(gdpr).toContain('UPDATE learner_broadcast_recipients');
    expect(gdpr).toContain('learner_name = NULL');
    expect(gdpr).toContain('learner_email = NULL');
    expect(gdpr).toContain('phone = NULL');
    expect(learner).toContain('learnerBroadcastTablesExist');
    expect(learner).toContain('const broadcastsReceived = hasLearnerBroadcasts');
    expect(learner).toContain('FROM learner_broadcast_recipients lbr');
    expect(learner).toContain("'broadcasts_received'");
  });
});
