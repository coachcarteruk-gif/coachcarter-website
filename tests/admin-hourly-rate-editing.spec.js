const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test.describe('admin hourly-rate editing UI', () => {
  test('instructor modal contains the hourly override field and helper copy', () => {
    const html = read('public/admin/portal.html');

    expect(html).toContain('Hourly rate override');
    expect(html).toContain('id="inst-hourly-rate"');
    expect(html).toContain('placeholder="e.g. 60.00"');
    expect(html).toContain('Leave blank to use the school default rate.');
    expect(html).toContain('id="btn-reset-hourly-rate"');
    expect(html).toContain('Reset to school default');
  });

  test('edit modal populates, save converts, and blank/reset clears hourly_rate_pence', () => {
    const js = read('public/admin/portal.js');

    expect(js).toContain("document.getElementById('inst-hourly-rate').value = '';");
    expect(js).toContain("document.getElementById('inst-hourly-rate').value = i.hourly_rate_pence != null ? formatPoundsInput(i.hourly_rate_pence) : '';");
    expect(js).toContain('function formatPoundsInput(pence)');
    expect(js).toContain('return { value: Math.round(pounds * 100) };');
    expect(js).toContain('body.hourly_rate_pence = hourlyRate.value;');
    expect(js).toContain("if (!raw) return { value: null };");
    expect(js).toContain("bind('btn-reset-hourly-rate', function () { document.getElementById('inst-hourly-rate').value = ''; });");
  });

  test('client rejects invalid, zero, negative, and over-500 pound overrides', () => {
    const js = read('public/admin/portal.js');

    expect(js).toContain("if (!/^\\d+(\\.\\d{1,2})?$/.test(raw))");
    expect(js).toContain('pounds <= 0 || pounds > 500');
    expect(js).toContain('Hourly rate override must be more than £0 and no more than £500');
    expect(js).toContain("if (hourlyRate.error) { toast(hourlyRate.error, 'error'); return; }");
  });

  test('existing bulk-tier controls remain wired through the modal', () => {
    const html = read('public/admin/portal.html');
    const js = read('public/admin/portal.js');

    expect(html).toContain('id="inst-bulk-tiers-enabled"');
    expect(html).toContain('Enable bulk packages');
    expect(js).toContain("document.getElementById('inst-bulk-tiers-enabled').checked = false;");
    expect(js).toContain("document.getElementById('inst-bulk-tiers-enabled').checked = i.bulk_tiers_enabled === true;");
    expect(js).toContain("bulk_tiers_enabled: document.getElementById('inst-bulk-tiers-enabled').checked");
  });
});

test.describe('admin hourly-rate editing API contract', () => {
  test('api/instructors create accepts optional hourly_rate_pence and returns it', () => {
    const api = read('api/instructors.js');

    expect(api).toContain('parseHourlyRatePence(req.body?.hourly_rate_pence)');
    expect(api).toContain('INSERT INTO instructors (name, email, phone, bio, photo_url, buffer_minutes, bulk_tiers_enabled, hourly_rate_pence, school_id)');
    expect(api).toContain('${hourlyRate.value}');
    expect(api).toContain('RETURNING id, name, email, phone, bio, photo_url, active, created_at, buffer_minutes, hourly_rate_pence');
  });

  test('api/instructors update sets, clears, or leaves hourly_rate_pence unchanged', () => {
    const api = read('api/instructors.js');

    expect(api).toContain('const hasHourlyRate = hourlyRate.present;');
    expect(api).toContain('hourly_rate_pence = CASE WHEN ${hasHourlyRate} THEN ${hourlyRate.value}::integer ELSE hourly_rate_pence END');
    expect(api).toContain('WHERE id = ${id} AND school_id = ${schoolId}');
    expect(api).toContain('weekly_franchise_fee_pence, hourly_rate_pence');
    expect(api).toContain("if (value === null || value === '') return { present: true, value: null };");
    expect(api).toContain('return allowOmitted ? { present: false, value: undefined }');
  });

  test('API validation matches migration bounds', () => {
    const instructorsApi = read('api/instructors.js');
    const adminApi = read('api/admin.js');

    for (const api of [instructorsApi, adminApi]) {
      expect(api).toContain('function parseHourlyRatePence(value, { allowOmitted = false } = {})');
      expect(api).toContain('!Number.isInteger(rate) || rate <= 0 || rate > 50000');
      expect(api).toContain('hourly_rate_pence must be null or an integer between 1 and 50000');
    }
  });

  test('api/admin list/create/update responses include hourly_rate_pence for parallel admin consumers', () => {
    const api = read('api/admin.js');

    expect(api).toContain('i.hourly_rate_pence');
    expect(api).toContain('INSERT INTO instructors (name, email, phone, bio, photo_url, active, bulk_tiers_enabled, hourly_rate_pence, school_id)');
    expect(api).toContain('hourly_rate_pence = CASE WHEN ${hourlyRate.present} THEN ${hourlyRate.value}::integer ELSE hourly_rate_pence END');
    expect(api).toContain('WHERE id = ${id} AND school_id = ${schoolId}');
    expect(api).toContain('RETURNING id, name, email, phone, bio, photo_url, active, commission_rate, weekly_franchise_fee_pence, hourly_rate_pence');
  });
});
