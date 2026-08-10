const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { normaliseSocialVideoConsent } = require('../api/_pricing-helpers');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('unticked filming consent is treated as a normal non-filmed booking', () => {
  expect(normaliseSocialVideoConsent(false)).toBe(false);
  expect(normaliseSocialVideoConsent(undefined)).toBe(false);
  expect(normaliseSocialVideoConsent('false')).toBe(false);
});

test('social video discount is instructor opt-in and booking-snapshotted', () => {
  const migration = read('db/migration.sql');
  const slots = read('api/slots.js');
  const pricing = read('api/_pricing-helpers.js');
  const profile = read('api/instructor.js');
  const webhook = read('api/webhook.js');

  expect(migration).toContain('ALTER TABLE instructors ADD COLUMN IF NOT EXISTS social_video_opt_in BOOLEAN NOT NULL DEFAULT FALSE');
  expect(migration).toContain('ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_consent BOOLEAN NOT NULL DEFAULT FALSE');
  expect(migration).toContain('ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_age_confirmed BOOLEAN NOT NULL DEFAULT FALSE');
  expect(migration).toContain('ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS social_video_discount_pct INTEGER NOT NULL DEFAULT 0');

  expect(pricing).toContain('const SOCIAL_VIDEO_DISCOUNT_PCT = 5;');
  expect(pricing).toContain('function applySocialVideoDiscount(pricePence, enabled)');
  expect(pricing).not.toContain('function calcSocialVideoChargeMinutes');

  const book = functionBody(slots, 'handleBook');
  expect(book).toContain('social_video_consent');
  expect(book).toContain('social_video_age_confirmed');
  expect(book).toContain('ageConfirmed: social_video_age_confirmed');
  expect(book).toContain("return res.status(400).json({ error: 'This instructor is not offering social media filming discounts.' });");
  expect(book).toContain("return res.status(400).json({ error: 'Social media filming consent is only available when the learner confirms they are 18 or over.' });");
  expect(book).toContain('const chargeMins = durationMins;');
  expect(book).toContain('socialVideoAgeConfirmed: socialVideo.ageConfirmed');

  const checkout = functionBody(slots, 'handleCheckoutSlot');
  expect(checkout).toContain('const priced = applySocialVideoDiscount(directPrice.pricePence, socialVideo.selected);');
  expect(checkout).toContain('const chargeMins = durationMins;');
  expect(checkout).toContain('charge_minutes:   String(chargeMins)');
  expect(checkout).toContain("social_video_consent: socialVideo.selected ? 'true' : 'false'");
  expect(checkout).toContain("social_video_age_confirmed: socialVideo.ageConfirmed ? 'true' : 'false'");

  const guestCheckout = functionBody(slots, 'handleCheckoutSlotGuest');
  expect(guestCheckout).toContain('ageConfirmed: social_video_age_confirmed');
  expect(guestCheckout).toContain('const chargeMins = durationMins;');
  expect(guestCheckout).toContain('charge_minutes:   String(chargeMins)');
  expect(guestCheckout).toContain("social_video_age_confirmed: socialVideo.ageConfirmed ? 'true' : 'false'");

  const durations = functionBody(slots, 'handleDurationsForSlot');
  expect(durations).toContain("COALESCE((to_jsonb(i)->>'social_video_opt_in')::boolean, false) AS social_video_opt_in");

  const webhookSlot = functionBody(webhook, 'handleSlotBooking');
  expect(webhookSlot).toContain('const socialVideoRequested = normaliseSocialVideoConsent(metadata.social_video_consent);');
  expect(webhookSlot).toContain('const socialVideoAgeConfirmed = socialVideoRequested && normaliseSocialVideoConsent(metadata.social_video_age_confirmed);');
  expect(webhookSlot).toContain('social_video_consent, social_video_age_confirmed, social_video_discount_pct');

  const learnerReschedule = functionBody(slots, 'handleReschedule');
  expect(learnerReschedule).toContain('social_video_consent, social_video_age_confirmed, social_video_discount_pct');
  expect(learnerReschedule).toContain('${!!booking.social_video_consent}');
  expect(learnerReschedule).toContain('${!!booking.social_video_age_confirmed}');

  expect(profile).toContain('COALESCE(social_video_opt_in, false) AS social_video_opt_in');
  expect(profile).toContain('social_video_opt_in = COALESCE(${socialVideoVal}, social_video_opt_in)');
  const instructorRescheduleRead = functionBody(profile, 'loadManagedInstructorRescheduleBooking');
  expect(instructorRescheduleRead).toContain('COALESCE(lb.social_video_consent, false) AS social_video_consent');
  expect(instructorRescheduleRead).toContain('COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed');
  const instructorReschedule = functionBody(profile, 'handleRescheduleBooking');
  expect(instructorReschedule).toContain('social_video_consent, social_video_age_confirmed, social_video_discount_pct');
  expect(instructorReschedule).toContain('!!booking.social_video_consent');
  expect(instructorReschedule).toContain('!!booking.social_video_age_confirmed');
});

test('learner modal exposes social video consent without sending prices', () => {
  const html = read('public/learner/book.html');
  const js = read('public/learner/book.js');
  const checkoutBody = functionBody(js, 'confirmPayAndBook');
  const creditBody = functionBody(js, 'confirmBookWithCredit');

  expect(html).toContain('id="socialVideoOption"');
  expect(html).toContain('id="mdSocialVideoConsent"');
  expect(html).toContain('Filmed lesson discount');
  expect(html).toContain('Optional');
  expect(html).toContain('Leave this unticked to book the lesson normally without social media filming.');
  expect(html).toContain('I am 18 or over and agree to social media filming to save 5%');
  const consentInput = html.match(/<input[^>]+id="mdSocialVideoConsent"[^>]*>/)?.[0] || '';
  expect(consentInput).not.toMatch(/\srequired(?:\s|=|>)/);
  expect(html).not.toContain('id="mdSocialVideoAgeConfirmed"');
  expect(html).toContain('id="socialVideoInfoModal"');
  expect(html).toContain('used by your driving school for social media');
  expect(html).not.toContain('used by CoachCarter for social media');

  expect(js).toContain('socialVideoOption = {');
  expect(js).toContain('function socialVideoConsentChecked()');
  expect(js).toContain('function socialVideoAgeConfirmed()');
  expect(js).toContain('return socialVideoConsentChecked();');
  expect(js).toContain('Tick this box to make');
  expect(js).not.toContain('validateSocialVideoEligibility');
  expect(js).toContain('updateDeductDisplay();');
  expect(js).toContain('updateBookButtonState();');
  expect(js).toContain('function lessonCreditMinutes(durationMinutes)');
  expect(js).not.toContain('socialVideoChargeMinutes');
  expect(js).toContain('socialVideoPrice');
  expect(creditBody).toContain('bookBody.social_video_consent = socialVideoConsentChecked();');
  expect(creditBody).toContain('bookBody.social_video_age_confirmed = socialVideoAgeConfirmed();');
  expect(checkoutBody).toContain('social_video_consent: socialVideoConsentChecked()');
  expect(checkoutBody).toContain('social_video_age_confirmed: socialVideoAgeConfirmed()');
  expect(checkoutBody).not.toContain('price_pence:');
  expect(checkoutBody).not.toContain('amount_pence:');
});

test('learner upcoming lesson surfaces remind learners when filming was agreed', () => {
  const slots = read('api/slots.js');
  const bookJs = read('public/learner/book.js');
  const indexHtml = read('public/learner/index.html');
  const indexJs = read('public/learner/index.js');
  const lessonsHtml = read('public/learner/lessons.html');
  const lessonsJs = read('public/learner/lessons.js');
  const myBookings = functionBody(slots, 'handleMyBookings');

  expect(myBookings).toContain('COALESCE(lb.social_video_consent, false) AS social_video_consent');
  expect(myBookings).toContain('COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed');
  expect(myBookings).toContain('COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct');

  expect(bookJs).toContain("next.social_video_consent === true ? ' - filmed lesson' : ''");
  expect(indexHtml).toContain('id="nl-filming"');
  expect(indexJs).toContain("filming.style.display = b.social_video_consent === true ? 'block' : 'none';");
  expect(lessonsHtml).toContain('.filmed-lesson-note');
  expect(lessonsJs).toContain('b.social_video_consent === true');
  expect(lessonsJs).toContain('Filmed lesson: you agreed for this session to be filmed for social media.');
});

test('GDPR export includes social video consent snapshots', () => {
  const learner = read('api/learner.js');
  const exportBody = functionBody(learner, 'handleExportData');

  expect(exportBody).toContain('COALESCE(lb.social_video_consent, false) AS social_video_consent');
  expect(exportBody).toContain('COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed');
  expect(exportBody).toContain('COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct');
  expect(exportBody).toContain('WHERE lb.learner_id = ${user.id} AND lb.school_id = ${schoolId}');
});
