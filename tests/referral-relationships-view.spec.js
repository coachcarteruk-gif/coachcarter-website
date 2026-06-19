const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin referrals include relationship view endpoint and renderer', () => {
  const adminApi = read('api/admin.js');
  const portalHtml = read('public/admin/portal.html');
  const portalJs = read('public/admin/portal.js');

  expect(adminApi).toContain("action === 'referral-relationships'");
  expect(adminApi).toContain("action === 'link-referral-relationship'");
  expect(adminApi).toContain('async function handleReferralRelationships');
  expect(adminApi).toContain('async function handleLinkReferralRelationship');
  expect(adminApi).toContain('referee.referred_by IS NOT NULL');
  expect(adminApi).toContain('pending_reward_minutes');
  expect(adminApi).toContain('referral_rewarded_at IS NOT NULL');
  expect(adminApi).toContain('SET referred_by = ${referrerId}');
  expect(adminApi).toContain("action: 'admin.link_referral_relationship'");

  expect(portalHtml).toContain('Referral Relationships');
  expect(portalHtml).toContain('Link Learners');
  expect(portalHtml).toContain('referral-relationships-body');
  expect(portalHtml).toContain('ref-link-referrer');
  expect(portalHtml).toContain('ref-link-referred');
  expect(portalJs).toContain("fetchAdmin('/api/admin?action=referral-relationships'");
  expect(portalJs).toContain("fetchAdmin('/api/admin?action=link-referral-relationship'");
  expect(portalJs).toContain('function loadReferralRelationships');
  expect(portalJs).toContain('function linkReferralRelationship');
});

test('learner referral stats expose first-name rows with earned and pending minutes', () => {
  const learnerApi = read('api/learner.js');
  const referJs = read('public/learner/refer.js');

  expect(learnerApi).toContain('first_name');
  expect(learnerApi).toContain('reward_minutes');
  expect(learnerApi).toContain('pending_reward_minutes');
  expect(learnerApi).toContain('b.referral_rewarded_at IS NOT NULL');
  expect(learnerApi).toContain('b.referral_rewarded_at IS NULL');

  expect(referJs).toContain('r.first_name || r.name');
  expect(referJs).toContain('Earned ');
  expect(referJs).toContain(' pending');
});
