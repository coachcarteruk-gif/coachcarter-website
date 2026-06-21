// @ts-check
// Contract coverage for Test Swaps Marketplace v1.

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

test.describe('test swaps marketplace', () => {
  test('migration adds tenant-scoped test swap schema and learner test centre', () => {
    const migration = read('db/migration.sql');
    const step = read('db/migrations/032_test_swaps_marketplace.sql');

    for (const sql of [migration, step]) {
      expect(sql).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_centre TEXT');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS test_swap_listings');
      expect(sql).toContain('school_id    INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(sql).toContain('learner_id   INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE');
      expect(sql).toContain("status IN ('active', 'accepted_in_principle', 'completed', 'cancelled')");
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS test_swap_requests');
      expect(sql).toContain("status IN ('pending', 'accepted', 'declined', 'withdrawn', 'completed')");
      expect(sql).toContain('uq_test_swap_one_open_listing_per_learner');
      expect(sql).toContain('uq_test_swap_one_accepted_request_per_listing');
      expect(sql).toContain('idx_test_swap_requests_requester');
    }
  });

  test('learner profile stores official test date, time and centre', () => {
    const learner = read('api/learner.js');
    const profile = read('public/learner/profile.html');
    const profileJs = read('public/learner/profile.js');
    const update = functionBody(learner, 'handleUpdateProfile');

    expect(learner).toContain('test_date::text AS test_date, test_time, test_centre');
    expect(update).toContain('const { phone, pickup_address, test_date, test_time, test_centre } = req.body || {};');
    expect(update).toContain('test_centre    = ${nextTestCentre}');
    expect(profile).toContain('id="officialTestSummary"');
    expect(profile).toContain('id="testCentre"');
    expect(profileJs).toContain('renderOfficialTestSummary');
    expect(profileJs).toContain('test_centre: testCentre');
  });

  test('learner API hides other learner identity while admin queue exposes contacts', () => {
    const api = read('api/test-swaps.js');
    const summary = functionBody(api, 'handleLearnerSummary');
    const request = functionBody(api, 'handleRequestListing');
    const admin = functionBody(api, 'handleAdminAccepted');

    expect(api).toContain("requireAuth(req, { roles: ['learner'] })");
    expect(api).toContain("requireAuth(req, { roles: ['admin'] })");
    expect(request).toContain('assertMatches({');
    expect(request).toContain('notifyListingOwner');
    expect(summary).toContain('AND l.learner_id <> ${user.id}');
    expect(summary).not.toContain('owner.email');
    expect(summary).not.toContain('requester.email');
    expect(admin).toContain('owner.email AS owner_email');
    expect(admin).toContain('owner.phone AS owner_phone');
    expect(admin).toContain('requester.email AS requester_email');
    expect(admin).toContain('requester.phone AS requester_phone');
  });

  test('UI exposes learner page, sidebar badge, and admin accepted queue', () => {
    const sidebar = read('public/sidebar.js');
    const learnerHtml = read('public/learner/test-swaps.html');
    const learnerJs = read('public/learner/test-swaps.js');
    const adminHtml = read('public/admin/portal.html');
    const adminJs = read('public/admin/portal.js');

    expect(sidebar).toContain("label: 'Test Swaps'");
    expect(sidebar).toContain('cc-test-swaps-badge');
    expect(sidebar).toContain('/api/test-swaps?action=notification-count');
    expect(learnerHtml).toContain('/learner/test-swaps.js');
    expect(learnerHtml).toContain('id="inlineTestDate"');
    expect(learnerHtml).toContain('id="inlineTestTime"');
    expect(learnerHtml).toContain('id="inlineTestCentre"');
    expect(learnerHtml).toContain('id="btnSaveInlineTest"');
    expect(learnerJs).toContain("'/api/test-swaps?action=summary'");
    expect(learnerJs).toContain("'/api/learner?action=update-profile'");
    expect(learnerJs).toContain('saveInlineTestDetails');
    expect(learnerJs).toContain("post('request-listing'");
    expect(learnerJs).toContain("post('accept-request'");
    expect(adminHtml).toContain('data-section="test-swaps"');
    expect(adminHtml).toContain('id="test-swaps-body"');
    expect(adminJs).toContain("if (name === 'test-swaps')   loadTestSwaps();");
    expect(adminJs).toContain("'/api/test-swaps?action=admin-accepted'");
    expect(adminJs).toContain("'/api/test-swaps?action=admin-complete'");
  });

  test('matching helper enforces same centre, date windows, unavailable dates and reverse checks', () => {
    const { _private } = require('../api/test-swaps.js');
    const requesterProfile = {
      test_date: '2026-08-10',
      test_time: '10:14',
      test_centre: 'Sidcup',
    };
    const listing = {
      test_date: '2026-09-15',
      test_time: '09:07',
      test_centre: ' sidcup ',
    };
    const listingWindows = [{ start_date: '2026-08-01', end_date: '2026-08-31' }];
    const listingUnavailable = ['2026-08-20'];

    expect(() => _private.assertMatches({
      requesterProfile,
      listing,
      listingWindows,
      listingUnavailable,
      reverseListing: null,
      reverseWindows: [],
      reverseUnavailable: [],
    })).not.toThrow();

    expect(() => _private.assertMatches({
      requesterProfile: { ...requesterProfile, test_centre: 'Bromley' },
      listing,
      listingWindows,
      listingUnavailable,
      reverseListing: null,
      reverseWindows: [],
      reverseUnavailable: [],
    })).toThrow(/same test centre/);

    expect(() => _private.assertMatches({
      requesterProfile: { ...requesterProfile, test_date: '2026-07-31' },
      listing,
      listingWindows,
      listingUnavailable,
      reverseListing: null,
      reverseWindows: [],
      reverseUnavailable: [],
    })).toThrow(/outside/);

    expect(() => _private.assertMatches({
      requesterProfile: { ...requesterProfile, test_date: '2026-08-20' },
      listing,
      listingWindows,
      listingUnavailable,
      reverseListing: null,
      reverseWindows: [],
      reverseUnavailable: [],
    })).toThrow(/unavailable/);

    expect(() => _private.assertMatches({
      requesterProfile,
      listing,
      listingWindows,
      listingUnavailable,
      reverseListing: { id: 99 },
      reverseWindows: [{ start_date: '2026-10-01', end_date: '2026-10-31' }],
      reverseUnavailable: [],
    })).toThrow(/outside your acceptable/);
  });

  test('GDPR export and deletion include test swaps', () => {
    const learner = read('api/learner.js');
    const gdpr = read('api/_gdpr.js');

    expect(learner).toContain('const testSwapListings = await sql`');
    expect(learner).toContain('FROM test_swap_listings');
    expect(learner).toContain('const testSwapRequests = await sql`');
    expect(learner).toContain("'test_swap_listings', 'test_swap_requests'");
    expect(learner).toContain('test_swap_requests: testSwapRequests');
    expect(gdpr).toContain('DELETE FROM test_swap_requests WHERE requester_learner_id = ${learnerId}');
    expect(gdpr).toContain('DELETE FROM test_swap_listings WHERE learner_id = ${learnerId}');
  });
});
