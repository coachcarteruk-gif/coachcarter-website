const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const portalHtml = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.html'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.js'), 'utf8');
const earningsJs = fs.readFileSync(path.join(root, 'public', 'instructor', 'earnings.js'), 'utf8');

function functionSource(source, name) {
  const markers = [`async function ${name}`, `function ${name}`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0);
  if (start < 0) throw new Error(`${name} missing`);
  const remainder = source.slice(start + 1);
  const next = /\n {0,2}(?:async )?function\s+[A-Za-z0-9_]+\s*\(/.exec(remainder);
  return source.slice(start, next ? start + 1 + next.index : source.length).trim();
}

test('admin browser view renders sanitized not-ready diagnostics and the inactive warning', async ({ page }) => {
  const section = portalHtml.match(/<div class="card" style="margin-bottom:24px;" aria-label="Accounts v2 readiness">[\s\S]*?<div id="connect-v2-readiness">[\s\S]*?<\/div>\s*<\/div>/);
  expect(section).not.toBeNull();
  await page.setContent(section[0]);
  await page.addScriptTag({ content: `
    function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    async function fetchAdmin() { return new Response(JSON.stringify({ version: 2, readiness: [{ instructor_id: 11, instructor_name: '<img src=x onerror=alert(1)>', ready: false, dashboard_type: 'unknown', transfers_capability_status: 'restricted', agreement_status: 'draft', blockers: ['requirements_outstanding'] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    ${functionSource(portalJs, 'loadConnectV2Readiness')}
  ` });
  await page.evaluate(() => loadConnectV2Readiness());
  await expect(page.getByText('Inactive foundation')).toBeVisible();
  await expect(page.getByText('Not ready')).toBeVisible();
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('#connect-v2-readiness img')).toHaveCount(0);
  await expect(page.getByText('requirements outstanding')).toBeVisible();
});

test('instructor browser view keeps inactive readiness separate and hides provider actions', async ({ page }) => {
  await page.setContent('<div id="target"></div>');
  await page.addScriptTag({ content: `
    ${functionSource(earningsJs, 'connectV2BlockerLabel')}
    ${functionSource(earningsJs, 'renderConnectV2Readiness')}
  ` });
  await page.evaluate(() => {
    document.getElementById('target').innerHTML = renderConnectV2Readiness({
      active: false,
      agreement_actions_active: false,
      ready: false,
      blockers: ['account_mapping_missing', 'agreement_not_accepted'],
    }, { agreements: [{ id: '11111111-1111-4111-8111-111111111111', version_number: 2, status: 'draft', agreement_fingerprint: 'sha256:' + 'a'.repeat(64), accepted_at: null }] });
  });
  await expect(page.getByText('Future automated payout readiness')).toBeVisible();
  await expect(page.getByText('This Accounts v2 flow is inactive and does not change your current payouts.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept agreement v2' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Stripe setup/ })).toHaveCount(0);
});
