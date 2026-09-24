// Synthetic reads only. Every API request is intercepted; mutations are recorded
// so visual/interaction tests cannot accidentally book, pay, or edit a learner.
const date = offset => new Date(Date.UTC(2026, 8, 23 + offset)).toISOString().slice(0, 10);
const profile = {
  id: 901, school_id: 1, name: 'Alex Morgan', email: 'alex@example.test',
  phone: '07700900000', pickup_address: '12 Example Road, London SE1 1AA',
  test_booked: true, test_date: date(45), test_time: '10:14', test_centre: 'Sidcup',
  stats: { total_sessions: 12, total_minutes: 1080, instructor_sessions: 10, private_sessions: 2 }
};
const lessonTypes = [
  { id: 1, name: 'One hour lesson', slug: '1hr', duration_minutes: 60, price_pence: 5500 },
  { id: 2, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: 8250 },
  { id: 3, name: 'Driving Ability Check', slug: 'driving-check', duration_minutes: 90, price_pence: 9000 },
  { id: 4, name: 'Two hour lesson', slug: '2hr', duration_minutes: 120, price_pence: 11000 },
  { id: 5, name: 'Three hour lesson', slug: '3hr', duration_minutes: 180, price_pence: 16500 }
];
const bookings = [3, 10, 17].map((offset, i) => ({
  id: 100 + i, scheduled_date: date(offset), start_time: '10:00:00', end_time: '11:30:00',
  instructor_id: 1, instructor_name: 'Fraser', lesson_type_name: 'Standard Lesson',
  lesson_type_id: 2, duration_minutes: 90, status: 'scheduled',
  pickup_address: profile.pickup_address, reschedule_count: 0
}));
const competency = {
  lesson_ratings: ['control', 'move_off', 'junctions'].map((skill_key, i) => ({
    skill_key, rating: ['nailed', 'ok', 'struggled'][i], created_at: date(-1) + 'T12:00:00Z'
  })), quiz_accuracy: [], mock_faults: [],
  session_stats: { total_sessions: 12, total_minutes: 1080 }, mock_summary: { total_tests: 0 },
  recent_sessions: [{ id: 1, session_date: date(-1), duration_minutes: 90, session_type: 'instructor' }],
  recent_focused_practice: []
};

async function setupLearner(page, options = {}) {
  const requests = [];
  await page.clock.setFixedTime(new Date('2026-09-23T12:00:00Z'));
  await page.addInitScript(({ profile, guest, consent }) => {
    if (!guest) localStorage.setItem('cc_learner', JSON.stringify({ user: profile }));
    if (consent) localStorage.setItem('cc_cookie_consent', JSON.stringify({ version: 2, analytics: false, marketing: false }));
  }, { profile, guest: options.guest === true, consent: options.consent !== false });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const a = url.searchParams.get('action');
    const p = url.pathname;
    requests.push({ path: p, action: a, method: request.method(), params: Object.fromEntries(url.searchParams), body: request.postDataJSON() });
    let data = { ok: true, enabled: false };
    if (request.method() !== 'GET') return route.fulfill({ json: { ok: true } });
    if (p === '/api/instructors') data = { instructors: [{ id: 1, name: 'Fraser', max_booking_days_ahead: 84, transmission_type: 'manual' }] };
    else if (p === '/api/lesson-types') data = { lesson_types: lessonTypes };
    else if (a === 'feature-state') data = { enabled: true, learner_packages_enabled: true };
    else if (a === 'my-bookings') data = { upcoming: options.empty ? [] : bookings, past: [], hasMorePast: false };
    else if (a === 'my-pencilled-offers') data = { offers: [] };
    else if (a === 'my-requests') data = { requests: [] };
    else if (a === 'balance') data = p.includes('flexible') ? { remaining_minutes: 300 } : {
      balance_minutes: 180, selected_instructor_balance_minutes: 180, payments_enabled: true,
      balances: [{ instructor_id: 1, instructor_name: 'Fraser', balance_minutes: 180 }]
    };
    else if (a === 'profile') data = { profile, trial_intake: null };
    else if (a === 'progress') data = p.includes('curriculum') ? { enabled: false } : profile;
    else if (a === 'reflection-due') data = options.reflection ? { enabled: true, reviews: [{ booking_id: 99, instructor_name: 'Fraser', skill_count: 3 }] } : { enabled: false };
    else if (a === 'competency') data = options.empty ? {} : competency;
    else if (a === 'profile-completeness') data = { steps: { prior_experience: true, initial_assessment: false } };
    else if (a === 'unlogged-bookings') data = { bookings: options.empty ? [] : [{ id: 99 }] };
    else if (a === 'referral-code') data = { enabled: true };
    else if (a === 'referral-stats') data = { total_referred: 1, total_reward_minutes: 30 };
    else if (a === 'my-availability') data = { availability: [] };
    else if (a === 'notification-count') data = { count: 0 };
    else if (a === 'test-date-availability') data = {
      instructor_id: 1, price_pence: 8250, can_use_credit: true,
      options: [{ start_time: '09:30', end_time: '11:00', recommended: true, fits: true }]
    };
    else if (a === 'available') {
      const slots = {};
      for (let i = 1; i <= 84; i++) {
        const d = date(i);
        if (d < url.searchParams.get('from') || d > url.searchParams.get('to')) continue;
        slots[d] = [{ date: d, start_time: '10:00', end_time: '11:30', instructor_id: 1, instructor_name: 'Fraser', transmission_type: 'manual' }];
      }
      data = { slots };
    } else if (a === 'durations-for-slot') data = {
      durations: lessonTypes.map(t => ({ ...t, lesson_type_id: t.id, fits: true, end_time: '11:30' }))
    };
    return route.fulfill({ json: data });
  });
  return requests;
}

module.exports = { setupLearner, date };
