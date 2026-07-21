const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test.describe('admin bookings list query', () => {
  test('returns every booking with the newest lessons first', () => {
    const adminSource = read('api/admin.js');
    const allBookingsQuery = section(
      section(
        adminSource,
        'async function handleAllBookings(req, res) {',
        'async function handleEditBooking(req, res) {'
      ),
      'const bookings = await sql`',
      'return res.json({ bookings });'
    );

    expect(allBookingsQuery).toContain(
      'ORDER BY lb.scheduled_date DESC, lb.start_time DESC, lb.id DESC'
    );
    expect(allBookingsQuery).not.toMatch(/\bLIMIT\s+\d+\b/i);
  });
});
