const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test.describe('admin learner controls', () => {
  test('admin API exposes school-scoped learner controls and audited updates', () => {
    const api = read('api/admin.js');

    expect(api).toContain("if (action === 'learner-controls')  return handleLearnerControls(req, res);");
    expect(api).toContain("if (action === 'update-learner-controls') return handleUpdateLearnerControls(req, res);");
    expect(api).toContain('async function handleLearnerControls');
    expect(api).toContain('async function handleUpdateLearnerControls');
    expect(api).toContain('WHERE lu.school_id = ${schoolId}');
    expect(api).toContain('custom_hourly_rate_pence');
    expect(api).toContain("action: 'admin.update_learner_controls'");
    expect(api).toContain('targetType: \'learner\'');
    expect(api).not.toContain('::text FILTER');
    expect(api).toContain("lu.test_date::text ~ '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'");
  });

  test('migration and GDPR export include learner control fields', () => {
    const migration = read('db/migration.sql');
    const learnerApi = read('api/learner.js');

    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS free_trial_allowed BOOLEAN NOT NULL DEFAULT TRUE;');
    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS free_trial_completed_at TIMESTAMPTZ;');
    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS test_instructor_booked BOOLEAN NOT NULL DEFAULT FALSE;');
    expect(migration).toContain('ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS admin_control_notes TEXT;');
    expect(learnerApi).toContain('free_trial_allowed, free_trial_completed_at, admin_control_notes');
    expect(learnerApi).toContain('test_date, test_time, test_centre, test_instructor_booked');
  });

  test('admin page and free-trial flow are wired to the controls', () => {
    const html = read('public/admin/learner-controls.html');
    const js = read('public/admin/learner-controls.js');
    const portal = read('public/admin/portal.html');
    const slots = read('api/slots.js');
    const cron = read('api/cron-auto-complete.js');

    expect(portal).toContain('/admin/learner-controls.html');
    expect(html).toContain('Can have a free trial');
    expect(html).toContain('id="field-trial-allowed"');
    expect(html).toContain('id="field-test-instructor-booked"');
    expect(js).toContain("fetchAdmin('/api/admin?action=learner-controls'");
    expect(js).toContain("fetchAdmin('/api/admin?action=update-learner-controls'");
    expect(slots).toContain('COALESCE(free_trial_allowed, TRUE) AS free_trial_allowed');
    expect(slots).toContain('const learnerTrialOverrideOn = existingLearner');
    expect(slots).toContain("error: 'trial_not_allowed'");
    expect(cron).toContain('free_trial_allowed = FALSE');
    expect(cron).toContain('free_trial_completed_at = COALESCE');
  });
});
