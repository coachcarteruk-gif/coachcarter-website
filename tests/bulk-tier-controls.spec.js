const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('Slice C1 bulk-tier admin controls', () => {
  test('admin instructor endpoints accept, persist, validate, and return bulk_tiers_enabled', () => {
    const instructorsApi = read('api/instructors.js');
    const adminApi = read('api/admin.js');

    expect(instructorsApi).toContain('bulk_tiers_enabled !== undefined && typeof bulk_tiers_enabled !== \'boolean\'');
    expect(instructorsApi).toContain('INSERT INTO instructors (name, email, phone, bio, photo_url, buffer_minutes, bulk_tiers_enabled, hourly_rate_pence, school_id)');
    expect(instructorsApi).toContain('${bulk_tiers_enabled === true}');
    expect(instructorsApi).toContain('bulk_tiers_enabled = CASE WHEN ${hasBulkTiers}');
    expect(instructorsApi).toContain('WHERE id = ${id} AND school_id = ${schoolId}');
    expect(instructorsApi).toContain('COALESCE(bulk_tiers_enabled, false) AS bulk_tiers_enabled');

    expect(adminApi).toContain('COALESCE(i.bulk_tiers_enabled, FALSE) AS bulk_tiers_enabled');
    expect(adminApi).toContain('bulk_tiers_enabled !== undefined && typeof bulk_tiers_enabled !== \'boolean\'');
    expect(adminApi).toContain('typeof body.bulk_tiers_enabled !== \'boolean\'');
    expect(adminApi).toContain('bulk_tiers_enabled = CASE WHEN ${hasBulkTiers}');
    expect(adminApi).toContain('WHERE id = ${id} AND school_id = ${schoolId}');
  });

  test('admin instructor modal includes and posts the bulk package toggle', () => {
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(html).toContain('id="inst-bulk-tiers-enabled"');
    expect(html).toContain('Enable bulk packages');
    expect(html).toContain('Enabling bulk packages means this instructor absorbs the school-defined bulk discounts.');
    expect(js).toContain("document.getElementById('inst-bulk-tiers-enabled').checked = false;");
    expect(js).toContain("document.getElementById('inst-bulk-tiers-enabled').checked = i.bulk_tiers_enabled === true;");
    expect(js).toContain("bulk_tiers_enabled: document.getElementById('inst-bulk-tiers-enabled').checked");
    expect(js).toContain("fetchAdmin(url, {");
  });
});

test.describe('Slice C1 bulk-tier instructor controls', () => {
  test('instructor profile API returns bulk opt-in and server-computed hourly rate', () => {
    const api = read('api/instructor.js');

    expect(api).toContain("const { getEffectiveHourlyPence, calcOfferLessonPrice } = require('./_pricing-helpers');");
    expect(api).toContain('COALESCE(bulk_tiers_enabled, false) AS bulk_tiers_enabled');
    expect(api).toContain('profile.effective_hourly_rate_pence = await getEffectiveHourlyPence(sql, {');
    expect(api).toContain('schoolId,');
    expect(api).toContain('instructorId: instructor.id');
    expect(api).toContain('WHERE id = ${instructor.id}\n        AND school_id = ${schoolId}');
  });

  test('instructor update-profile accepts boolean bulk opt-in and rejects non-boolean values', () => {
    const api = read('api/instructor.js');

    expect(api).toContain('broadcast_offers_enabled, bulk_tiers_enabled');
    expect(api).toContain('typeof bulk_tiers_enabled !== \'boolean\'');
    expect(api).toContain('bulk_tiers_enabled must be true or false');
    expect(api).toContain('bulk_tiers_enabled = COALESCE(${bulkVal}, bulk_tiers_enabled)');
    expect(api).toContain('COALESCE(bulk_tiers_enabled, false) AS bulk_tiers_enabled');
  });

  test('instructor profile UI shows read-only hourly rate and posts bulk_tiers_enabled', () => {
    const js = read('public/instructor/profile.js');

    expect(js).toContain('Your hourly rate: ${formatPence(hourlyRatePence)}/hr');
    expect(js).toContain('id="inputBulkTiersEnabled"');
    expect(js).toContain('Apply school bulk discounts to my credit purchases');
    expect(js).toContain('Existing credits keep their original rate.');
    expect(js).toContain("const bulk_tiers_enabled = document.getElementById('inputBulkTiersEnabled').checked;");
    expect(js).toContain('broadcast_offers_enabled, bulk_tiers_enabled');
  });
});
