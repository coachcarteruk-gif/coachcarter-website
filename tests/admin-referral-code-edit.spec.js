const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { normaliseReferralCode, updateReferralCodeForLearner } = require('../api/_referral-code');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function createSqlHarness(results) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    return results.shift() || [];
  };
  return { sql, calls };
}

test.describe('admin referral-code validation', () => {
  test('normalises personalised URL-safe codes to uppercase', () => {
    expect(normaliseReferralCode('  sarah-drives_26  ')).toEqual({
      ok: true,
      code: 'SARAH-DRIVES_26',
    });
  });

  test('rejects codes that cannot safely be used in referral links', () => {
    expect(normaliseReferralCode('')).toMatchObject({ ok: false });
    expect(normaliseReferralCode('AB')).toMatchObject({ ok: false });
    expect(normaliseReferralCode('-SARAH')).toMatchObject({ ok: false });
    expect(normaliseReferralCode('SARAH!')).toMatchObject({ ok: false });
    expect(normaliseReferralCode('A'.repeat(33))).toMatchObject({ ok: false });
  });
});

test.describe('admin referral-code mutation', () => {
  test('updates only the selected learner code within the selected school', async () => {
    const existing = {
      id: 11,
      code: 'SARAH-1111',
      learner_id: 42,
      learner_name: 'Sarah Carter',
      learner_email: 'sarah@example.com',
    };
    const harness = createSqlHarness([[existing], [], [{ learner_id: 42, code: 'SARAH-DRIVES' }]]);

    const result = await updateReferralCodeForLearner(harness.sql, {
      learnerId: 42,
      schoolId: 7,
      code: 'SARAH-DRIVES',
    });

    expect(result).toMatchObject({
      status: 'updated',
      previous: { code: 'SARAH-1111' },
      referral: { learner_id: 42, code: 'SARAH-DRIVES' },
    });
    expect(harness.calls).toHaveLength(3);
    expect(harness.calls[0].query).toContain('lu.school_id = ?');
    expect(harness.calls[0].query).toContain('r.school_id = ?');
    expect(harness.calls[0].values).toEqual([7, 42, 7]);
    expect(harness.calls[1].query).toContain('learner_id <> ?');
    expect(harness.calls[1].values).toEqual(['SARAH-DRIVES', 7, 42]);
    expect(harness.calls[2].query).toContain('WHERE id = ?');
    expect(harness.calls[2].values).toEqual(['SARAH-DRIVES', 11, 7]);
  });

  test('does not update when the code belongs to another learner in the school', async () => {
    const harness = createSqlHarness([
      [{ id: 11, code: 'SARAH-1111', learner_id: 42 }],
      [{ learner_id: 99 }],
    ]);

    const result = await updateReferralCodeForLearner(harness.sql, {
      learnerId: 42,
      schoolId: 7,
      code: 'TAKEN-CODE',
    });

    expect(result).toEqual({ status: 'conflict' });
    expect(harness.calls).toHaveLength(2);
  });

  test('does not create a code when the learner has not generated one yet', async () => {
    const harness = createSqlHarness([[]]);
    const result = await updateReferralCodeForLearner(harness.sql, {
      learnerId: 42,
      schoolId: 7,
      code: 'NEW-CODE',
    });

    expect(result).toEqual({ status: 'not_found' });
    expect(harness.calls).toHaveLength(1);
  });
});

test('admin referral-code edit is tenant-scoped, audited, and wired into the UI', () => {
  const adminApi = read('api/admin.js');
  const referralCodeApi = read('api/_referral-code.js');
  const portalHtml = read('public/admin/portal.html');
  const portalJs = read('public/admin/portal.js');

  expect(adminApi).toContain("action === 'update-referral-code'");
  expect(adminApi).toContain('async function handleUpdateReferralCode');
  expect(referralCodeApi).toContain('AND lu.school_id = ${schoolId}');
  expect(referralCodeApi).toContain('AND r.school_id = ${schoolId}');
  expect(referralCodeApi).toContain('AND learner_id <> ${learnerId}');
  expect(adminApi).toContain("action: 'admin.update_referral_code'");
  expect(adminApi).toContain("err?.code === '23505'");

  expect(portalHtml).toContain('modal-edit-referral-code');
  expect(portalHtml).toContain('for="referral-code-input"');
  expect(portalHtml).toContain('aria-live="polite"');
  expect(portalHtml).toContain("old shared link from working");
  expect(portalJs).toContain('data-action="edit-referral-code"');
  expect(portalJs).toContain("fetchAdmin('/api/admin?action=update-referral-code'");
  expect(portalJs).toContain('function validateReferralCodeInput');
});

test('referral-code dialog is labelled and touch-friendly on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setContent(read('public/admin/portal.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#modal-edit-referral-code').evaluate((element) => element.classList.add('open'));

  const dialog = page.locator('#modal-edit-referral-code');
  const input = page.locator('#referral-code-input');
  await expect(dialog).toBeVisible();
  await expect(input).toHaveAttribute('aria-describedby', /referral-code-help/);

  const dialogBox = await dialog.locator('.modal').boundingBox();
  const inputBox = await input.boundingBox();
  const buttonBoxes = await dialog.locator('.modal-actions button').evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height)
  );

  expect(dialogBox.width).toBeLessThanOrEqual(375);
  expect(inputBox.height).toBeGreaterThanOrEqual(44);
  expect(buttonBoxes.every((height) => height >= 44)).toBe(true);
});
