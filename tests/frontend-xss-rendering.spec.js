// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const payload = '<img id="xss-probe" src="x" onerror="window.__xss=(window.__xss||0)+1">';
const repoRoot = path.resolve(__dirname, '..');

async function loadLearnerDataScript(page, responseBody) {
  await page.setContent('<div id="content"></div>');
  await page.evaluate((body) => {
    window.__xss = 0;
    window.ccAuth = {
      getAuth: () => ({ id: 7, school_id: 1 }),
      fetchAuthed: async () => new Response(JSON.stringify(body)),
    };
  }, responseBody);
  await page.addScriptTag({ path: path.join(repoRoot, 'public/learner/my-data.js') });
}

test('learner data export renders stored and API values as text', async ({ page }) => {
  await loadLearnerDataScript(page, {
        profile: { name: payload, email: payload, phone: payload, pickup_address: payload },
        onboarding: { main_concerns: payload },
        bookings: [{ instructor_name: payload, pickup_address: payload, lesson_type: payload, status: payload }],
        transactions: [{ type: payload, payment_method: payload }],
        driving_sessions: [{ session_type: payload, notes: payload }],
        skill_ratings: [{ skill_key: payload, note: payload }],
        quiz_results: [{ question_id: payload, learner_answer: payload, correct_answer: payload }],
        mock_tests: [{ result: payload, notes: payload }],
        _metadata: { exported_at: null, data_categories: [payload] },
  });
  await expect(page.locator('#content')).toContainText(payload);
  await expect(page.locator('#xss-probe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
});

test('learner data export renders an API error payload as text', async ({ page }) => {
  await loadLearnerDataScript(page, { error: payload });
  await expect(page.locator('#content')).toContainText(payload);
  await expect(page.locator('#xss-probe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
});

test('instructor profile renders stored profile and lesson-type values safely', async ({ page }) => {
  await page.setContent('<div id="profileContent"></div>');
  await page.evaluate((probe) => {
    window.__xss = 0;
    window.ccAuth = {
      getAuth: () => ({ id: 9, school_id: 1 }),
      fetchAuthed: async (url) => {
        if (url === '/api/instructor?action=profile') {
          return new Response(JSON.stringify({
          instructor: {
            id: 9,
            slug: 'safe-instructor',
            name: 'Safe Name ' + probe,
            email: 'safe@example.test',
            ical_feed_url: '\"><img id="xss-profile" src="x" onerror="window.__xss=(window.__xss||0)+1">',
            ical_sync_error: probe,
            specialisms: [],
            languages: ['English'],
            service_areas: [],
          },
          }));
        }
        if (url === '/api/lesson-types?action=list') {
          return new Response(JSON.stringify({ lesson_types: [{ slug: '\" onfocus="window.__xss=1', name: probe, colour: 'red;position:fixed' }] }));
        }
        return new Response(JSON.stringify({ url: null }));
      },
    };
  }, payload);
  await page.addScriptTag({ path: path.join(repoRoot, 'public/instructor/profile.js') });

  await expect(page.locator('#bookingLinksContainer')).toContainText(payload);
  await expect(page.locator('#profileContent')).toContainText(payload);
  await expect(page.locator('#xss-probe, #xss-profile')).toHaveCount(0);
  expect(await page.locator('#inputIcalUrl').inputValue()).toContain('<img id="xss-profile"');
  expect(await page.evaluate(() => window.__xss)).toBe(0);
});

test('instructor profile renders a rejected API error as text', async ({ page }) => {
  await page.setContent('<div id="profileContent"></div>');
  await page.evaluate((probe) => {
    window.__xss = 0;
    window.ccAuth = {
      getAuth: () => ({ id: 9, school_id: 1 }),
      fetchAuthed: async () => new Response(JSON.stringify({ error: probe }), { status: 500 }),
    };
  }, payload);
  await page.addScriptTag({ path: path.join(repoRoot, 'public/instructor/profile.js') });
  await expect(page.locator('#profileContent')).toContainText(payload);
  await expect(page.locator('#xss-probe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
});
