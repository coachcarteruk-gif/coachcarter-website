// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  SCHEDULE_UNAVAILABLE,
  buildInstructorScheduleWarnings,
} = require('../api/_instructor-schedule-warnings');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

test.describe('instructor schedule warning overrides', () => {
  test('reports busy, blackout, external-calendar, and outside-hours warnings together', () => {
    const warnings = buildInstructorScheduleWarnings({
      startTime: '18:00',
      endTime: '19:30',
      weeklyWindows: [{ start_time: '09:00', end_time: '17:00' }],
      busyBlocks: [{ start_time: '17:30', end_time: '18:30' }],
      blackoutDates: [{ id: 1 }],
      externalEvents: [{ start_time: '18:45', end_time: '20:00', is_all_day: false }],
    });

    expect(warnings.map(warning => warning.code)).toEqual([
      'BUSY_BLOCK',
      'BLACKOUT_DATE',
      'EXTERNAL_CALENDAR_EVENT',
      'OUTSIDE_NORMAL_HOURS',
    ]);
  });

  test('accepts recurring and one-off coverage and lets one-off availability supersede a blackout', () => {
    expect(buildInstructorScheduleWarnings({
      startTime: '10:00',
      endTime: '11:30',
      weeklyWindows: [{ start_time: '09:00:00', end_time: '17:00:00' }],
    })).toEqual([]);

    expect(buildInstructorScheduleWarnings({
      startTime: '18:00',
      endTime: '19:30',
      weeklyWindows: [{ start_time: '09:00', end_time: '17:00' }],
      oneOffWindows: [{ start_time: '17:30', end_time: '20:00' }],
      blackoutDates: [{ id: 1 }],
    })).toEqual([]);
  });

  for (const confirm of [true, false]) {
    test(`package normal-hours warning ${confirm ? 'confirms and retries' : 'cancels without booking'}`, async ({ page }) => {
      await page.setContent('<!doctype html><html><body></body></html>');
      await page.addScriptTag({ path: path.join(root, 'public/shared/instructor-booking-actions.js') });
      const prompts = [];
      page.on('dialog', async dialog => {
        prompts.push(dialog.message());
        if (confirm) await dialog.accept(); else await dialog.dismiss();
      });
      const result = await page.evaluate(async () => {
        const calls = [];
        window.ccAuth = { fetchAuthed: async (_, options) => {
          calls.push(JSON.parse(options.body));
          return calls.length === 1
            ? { status: 409, json: async () => ({ code: 'NORMAL_HOURS_OVERRIDE_REQUIRED',
              error: 'This lesson is outside your normal availability.', normal_hours_override_token: 'reviewed-slot' }) }
            : { status: 200, json: async () => ({ ok: true }) };
        } };
        const result = await window.BookingActions.postWithScheduleCheck('/api/instructor?action=create-booking', {
          payment_method: 'flexible_package', scheduled_date: '2030-09-23', start_time: '18:00',
          client_request_id: 'same-request', learner_id: 22,
        });
        return { cancelled: result.cancelled, data: result.data, calls };
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('Override normal availability and book this lesson?');
      expect(prompts[0]).toContain('2030-09-23 at 18:00');
      expect(result.cancelled).toBe(!confirm);
      expect(result.calls).toHaveLength(confirm ? 2 : 1);
      expect(result.calls[0].normal_hours_override_token).toBeUndefined();
      if (confirm) expect(result.calls[1]).toEqual({ ...result.calls[0], normal_hours_override_token: 'reviewed-slot' });
    });
  }

  test('hard schedule conflicts never prompt or retry', async () => {
    const calls = [];
    const context = { document: { addEventListener() {} },
      window: { confirm: () => { throw new Error('Unexpected confirmation'); } },
      ccAuth: { fetchAuthed: async (_, options) => {
        calls.push(options);
        return { status: 409, json: async () => ({ code: SCHEDULE_UNAVAILABLE, error: 'Busy block' }) };
      } } };
    vm.runInNewContext(read('public/shared/instructor-booking-actions.js'), context);
    const result = await context.window.BookingActions.postWithScheduleCheck('/api/instructor?action=create-booking',
      { payment_method: 'flexible_package' });
    expect(result.data.code).toBe(SCHEDULE_UNAVAILABLE);
    expect(calls).toHaveLength(1);
  });
});
