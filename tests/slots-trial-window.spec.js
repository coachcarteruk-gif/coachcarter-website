const { test, expect } = require('@playwright/test');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_slots_trial_window';

const {
  _FREE_TRIAL_MAX_DAYS_AHEAD,
  _effectiveBookingWindowDays,
  _handleAvailable,
  _handleTrialWindowContext,
  _isDateWithinBookingWindow,
  _meetsMinimumBookingNotice,
  _operationalDateAt,
  _slotStartInstant,
} = require('../api/slots');

function utcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.describe('free-trial operational-date window', () => {
  test('London BST midnight advances the school date while UTC is still on the prior day', () => {
    const instant = new Date('2026-07-01T23:30:00.000Z');
    expect(_operationalDateAt(instant, 'Europe/London').toISOString().slice(0, 10)).toBe('2026-07-02');
  });

  test('London date remains stable across both DST clock transitions', () => {
    expect(_operationalDateAt(new Date('2026-03-29T00:30:00.000Z'), 'Europe/London').toISOString().slice(0, 10))
      .toBe('2026-03-29');
    expect(_operationalDateAt(new Date('2026-03-29T01:30:00.000Z'), 'Europe/London').toISOString().slice(0, 10))
      .toBe('2026-03-29');
    expect(_operationalDateAt(new Date('2026-10-25T00:30:00.000Z'), 'Europe/London').toISOString().slice(0, 10))
      .toBe('2026-10-25');
    expect(_operationalDateAt(new Date('2026-10-25T01:30:00.000Z'), 'Europe/London').toISOString().slice(0, 10))
      .toBe('2026-10-25');
  });

  test('day 28 is inclusive and day 29 is rejected from the London operational date', () => {
    const londonToday = _operationalDateAt(new Date('2026-07-01T23:30:00.000Z'), 'Europe/London');
    expect(_isDateWithinBookingWindow(
      addDays(londonToday, 28),
      84,
      _FREE_TRIAL_MAX_DAYS_AHEAD,
      londonToday
    )).toBe(true);
    expect(_isDateWithinBookingWindow(
      addDays(londonToday, 29),
      84,
      _FREE_TRIAL_MAX_DAYS_AHEAD,
      londonToday
    )).toBe(false);
  });

  test('a shorter instructor horizon remains the effective trial limit', () => {
    const londonToday = utcDate('2026-07-02');
    expect(_effectiveBookingWindowDays(14, _FREE_TRIAL_MAX_DAYS_AHEAD)).toBe(14);
    expect(_isDateWithinBookingWindow(addDays(londonToday, 14), 14, _FREE_TRIAL_MAX_DAYS_AHEAD, londonToday)).toBe(true);
    expect(_isDateWithinBookingWindow(addDays(londonToday, 15), 14, _FREE_TRIAL_MAX_DAYS_AHEAD, londonToday)).toBe(false);
  });

  test('ordinary paid windows retain their existing UTC/default 84-day behavior', () => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    expect(_isDateWithinBookingWindow(addDays(today, 84), 84)).toBe(true);
    expect(_isDateWithinBookingWindow(addDays(today, 85), 84)).toBe(false);
  });

  test('host-resolved non-default tenant returns its own timezone, date, and shorter instructor window', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();
      calls.push({ query, values });
      if (query.includes('LOWER(primary_host)')) {
        expect(values).toContain('tenant-nine.example');
        return [{ id: 9, slug: 'tenant-nine' }];
      }
      if (query.includes('SELECT config') && query.includes('FROM schools')) {
        expect(values).toContain(9);
        return [{ config: { timezone: 'Pacific/Auckland' } }];
      }
      if (query.includes('FROM instructors')) {
        expect(values).toEqual(expect.arrayContaining([44, 9]));
        return [{ max_booking_days_ahead: 5 }];
      }
      return [];
    };
    const res = responseRecorder();

    await _handleTrialWindowContext({
      method: 'GET',
      query: { instructor_id: '44' },
      headers: { host: 'tenant-nine.example' },
    }, res, {
      sql,
      now: new Date('2026-12-31T11:30:00.000Z'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      school_id: 9,
      operational_timezone: 'Pacific/Auckland',
      operational_date: '2027-01-01',
      from: '2027-01-01',
      to: '2027-01-06',
      days_ahead: 5,
    });
    expect(calls.some(call => call.query.includes('LOWER(primary_host)'))).toBe(true);
  });

  test('trial availability accepts the canonical local date for a tenant west of UTC', async () => {
    const sql = async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').trim();
      if (query.includes('LOWER(primary_host)')) {
        expect(values).toContain('new-york-school.example');
        return [{ id: 12, slug: 'new-york-school' }];
      }
      if (query.includes('SELECT config') && query.includes('FROM schools')) {
        return [{ config: { timezone: 'America/New_York' } }];
      }
      if (query.includes('FROM lesson_types')) {
        return [{ id: 37, slug: 'trial', name: 'Free trial', duration_minutes: 60, price_pence: 0, colour: '#000000' }];
      }
      return [];
    };
    const res = responseRecorder();

    await _handleAvailable({
      method: 'GET',
      query: {
        from: '2027-01-01',
        to: '2027-01-29',
        lesson_type_slug: 'trial',
      },
      headers: { host: 'new-york-school.example' },
    }, res, {
      sql,
      now: new Date('2027-01-02T00:30:00.000Z'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      from: '2027-01-01',
      to: '2027-01-29',
      slots: {},
    });
  });

  test('BST minimum notice uses the local slot instant rather than treating wall time as UTC', () => {
    const now = new Date('2026-07-01T22:30:00.000Z'); // 23:30 BST
    expect(_slotStartInstant('2026-07-02', '00:30', 'Europe/London').toISOString())
      .toBe('2026-07-01T23:30:00.000Z');
    expect(_meetsMinimumBookingNotice({
      date: '2026-07-02', startTime: '00:30', minNoticeHours: 1, now, operationalTimezone: 'Europe/London'
    })).toBe(true);
    expect(_meetsMinimumBookingNotice({
      date: '2026-07-02', startTime: '00:30', minNoticeHours: 1.01, now, operationalTimezone: 'Europe/London'
    })).toBe(false);
  });

  test('minimum notice remains elapsed-time correct across both DST transitions', () => {
    const springNow = new Date('2026-03-29T00:30:00.000Z');
    expect(_slotStartInstant('2026-03-29', '02:30', 'Europe/London').toISOString())
      .toBe('2026-03-29T01:30:00.000Z');
    expect(_meetsMinimumBookingNotice({
      date: '2026-03-29', startTime: '02:30', minNoticeHours: 1, now: springNow, operationalTimezone: 'Europe/London'
    })).toBe(true);
    expect(_meetsMinimumBookingNotice({
      date: '2026-03-29', startTime: '02:30', minNoticeHours: 1.01, now: springNow, operationalTimezone: 'Europe/London'
    })).toBe(false);

    const autumnNow = new Date('2026-10-25T00:30:00.000Z');
    expect(_slotStartInstant('2026-10-25', '02:30', 'Europe/London').toISOString())
      .toBe('2026-10-25T02:30:00.000Z');
    expect(_meetsMinimumBookingNotice({
      date: '2026-10-25', startTime: '02:30', minNoticeHours: 2, now: autumnNow, operationalTimezone: 'Europe/London'
    })).toBe(true);
    expect(_meetsMinimumBookingNotice({
      date: '2026-10-25', startTime: '02:30', minNoticeHours: 2.01, now: autumnNow, operationalTimezone: 'Europe/London'
    })).toBe(false);
  });
});
