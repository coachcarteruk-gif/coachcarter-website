const { test, expect } = require('@playwright/test');
const { questionnaireConfig } = require('./helpers/trial-funnel-fixture');
const manifest = require('../public/content/free-trial-vsl.json');

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/schools?action=public-config**', route => route.fulfill({ json: { ok: true, trial_questionnaire: questionnaireConfig, local_date: '2026-09-22' } }));
  await page.route('**/api/slots?action=trial-window-context**', route => route.fulfill({ json: { from: '2026-09-22', to: '2026-10-20', days_ahead: 28 } }));
  await page.route('**/api/slots?action=available**', route => route.fulfill({ json: { slots: {} } }));
  await page.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, marketing: false, version: 2, timestamp: new Date().toISOString() })));
});

for (const width of [375, 1365]) test('optional player and request route at width ' + width, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const streamRequests = [];
  page.on('request', request => { if (request.url().includes('.cloudflarestream.com/')) streamRequests.push(request.url()); });
  await page.goto('/free');
  await expect(page.getByRole('button', { name: 'Play free trial introduction from Fraser' })).toBeVisible();
  expect(streamRequests).toEqual([]);
  expect(await page.locator('#freeTrialVideo iframe').count()).toBe(0);
  const video = await page.locator('.trial-video-frame').boundingBox();
  const questions = await page.locator('#trialQuestionnaire').boundingBox();
  expect(video.y + video.height).toBeLessThan(questions.y);
  expect(Math.abs(video.height - video.width)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => ccTrialFunnel.context())).toMatchObject({ content_version: 'video_v1', analytics_consent_at_booking: false });
  expect(await page.evaluate(() => ccTrialFunnel.send('free_trial_page_viewed'))).toBe(false);
  await expect(page.getByRole('link', { name: 'Read the transcript' })).toHaveAttribute('href', manifest.transcript_src);
  await page.getByRole('link', { name: 'Go straight to the questions' }).click();
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Yes, I have money set aside for lessons.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request your free trial' })).toBeVisible();
  expect(streamRequests).toEqual([]);
});

test('click loads only the approved player; unavailable playback does not block booking', async ({ page }) => {
  await page.route('https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/**', route => route.abort());
  await page.goto('/free');
  await page.getByRole('button', { name: 'Play free trial introduction from Fraser' }).click();
  await expect(page.locator('#freeTrialVideo iframe')).toHaveAttribute('src', 'https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com/' + manifest.stream_id + '/iframe?autoplay=true&defaultTextTrack=en');
  await expect(page.locator('.trial-video-help')).toBeVisible();
  await page.getByLabel('Yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Practical test date').fill('2027-06-20');
  await page.getByLabel('Practical test time').fill('11:20');
  await page.getByLabel('Test centre', { exact: true }).selectOption('Reading');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Yes, I have money set aside for lessons.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#trialBookingFlow')).toBeVisible();
  await expect(page.locator('#slotPicker')).toContainText('No free trial slots');
});

for (const [name, value] of [
  ['disabled', { ...manifest, enabled: false }],
  ['invalid UID', { ...manifest, stream_id: '//example.com' }],
  ['external poster', { ...manifest, poster: 'https://example.com/image.jpg' }],
  ['invalid JSON', null],
]) test(name + ' media fails open to the questionnaire', async ({ page }) => {
  await page.route('**/content/free-trial-vsl.json', route => value ? route.fulfill({ json: value }) : route.fulfill({ contentType: 'application/json', body: '{' }));
  await page.goto('/free');
  await expect(page.getByRole('heading', { name: 'Do you have a practical driving test booked?' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.ccTrialMediaPending)).toBe(false);
  await expect(page.locator('#freeTrialVideo')).toBeHidden();
  expect(await page.evaluate(() => ccTrialFunnel.context().content_version)).toBe('text_v1');
});

test('slow media never blocks questionnaire and has a bounded timeout', async ({ page }) => {
  await page.route('**/content/free-trial-vsl.json', () => {});
  await page.goto('/free', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Do you have a practical driving test booked?' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.ccTrialMediaPending), { timeout: 5000 }).toBe(false);
  await expect(page.locator('#freeTrialVideo')).toBeHidden();
});

test('consented exposure waits for media and reports the video version once', async ({ page }) => {
  await page.route('**/static/array.js', route => route.fulfill({ contentType: 'application/javascript', body: "var c=posthog._i[0][1];window.events=[];posthog.__loaded=true;posthog.capture=function(event,properties){var e=c.before_send({event,properties});if(e)events.push(e);};posthog.opt_out_capturing=function(){};posthog.opt_in_capturing=function(){};posthog.reset=function(){};c.loaded();" }));
  await page.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: true, marketing: false, version: 2, timestamp: new Date().toISOString() })));
  await page.goto('/free');
  await expect.poll(() => page.evaluate(() => (window.events || []).filter(event => event.event === 'free_trial_page_viewed').length)).toBe(1);
  expect(await page.evaluate(() => events.find(event => event.event === 'free_trial_page_viewed').properties.content_version)).toBe('video_v1');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('cc-trial-media-ready')));
  expect(await page.evaluate(() => events.filter(event => event.event === 'free_trial_page_viewed').length)).toBe(1);
});

for (const query of ['?school=another-school', '?school_id=2']) test('other school ' + query + ' does not load CoachCarter media', async ({ page }) => {
  let requests = 0;
  await page.route('**/content/free-trial-vsl.json', route => { requests++; return route.fulfill({ json: manifest }); });
  await page.goto('/free' + query);
  await expect(page.getByRole('heading', { name: 'Do you have a practical driving test booked?' })).toBeVisible();
  await expect(page.locator('#freeTrialVideo')).toBeHidden();
  expect(requests).toBe(0);
});

