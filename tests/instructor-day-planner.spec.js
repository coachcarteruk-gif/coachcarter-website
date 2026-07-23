// @ts-check
// Static UI contract for the simplified instructor calendar and dashboard.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test.describe('unified instructor day planner', () => {
  test('calendar uses one date selector and one chronological selected-day view', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');

    expect(html).toContain('/instructor/day-planner.css');
    expect(html).toContain('id="plannerDateGrid"');
    expect(html).toContain('id="plannerDayTitle"');
    expect(html).not.toContain('data-view="monthly"');
    expect(html).not.toContain('data-view="weekly"');
    expect(html).not.toContain('data-view="agenda"');

    expect(js).toContain("ccAuth.fetchAuthed('/api/instructor?action=list-requests')");
    expect(js).toContain("_kind: 'request'");
    expect(js).toContain("_kind: 'recurring-availability'");
    expect(js).toContain("_kind: 'availability'");
    expect(js).toContain("_kind: 'busy'");
    expect(js).toContain("data-action=\"accept-planner-request\"");
    expect(js).toContain("data-action=\"decline-planner-request\"");
  });

  test('dashboard merges today and collapses future requests into one calendar link', () => {
    const html = read('public/instructor/dashboard.html');
    const js = read('public/instructor/dashboard.js');

    expect(html).toContain('/instructor/day-planner.css');
    expect(html).toContain('id="dashRequestAttention"');
    expect(html).toContain('id="dashDaySummary"');
    expect(html).not.toContain('id="dashRequests"');
    expect(html).not.toContain('id="dashBroadcasts"');
    expect(html).not.toContain('id="dashBookingLink"');

    expect(js).toContain("ccAuth.fetchAuthed('/api/instructor?action=availability')");
    expect(js).toContain("ccAuth.fetchAuthed('/api/instructor?action=list-requests')");
    expect(js).toContain('todayOffers = schedData.pending_offers || []');
    expect(js).toContain('todayAvailability = schedData.availability_overrides || []');
    expect(js).toContain('todayBusyBlocks = schedData.busy_blocks || []');
    expect(js).toContain("alert.href = '/instructor/?date='");
  });

  test('shared controls retain phone-sized touch targets', () => {
    const css = read('public/instructor/day-planner.css');

    expect(css).toContain('.planner-btn');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.planner-date');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
