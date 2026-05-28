// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('existing learner lesson offers', () => {
  test('create-offer accepts learner_id and stores it on lesson_offers', () => {
    const source = read('api/instructor.js');
    const body = functionBody(source, 'handleCreateOffer');

    expect(body).toContain('const { learner_id, learner_email, learner_name');
    expect(body).toContain('const learnerIdClean = learner_id != null');
    expect(body).toContain('WHERE id = ${learnerIdClean}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('AND archived_at IS NULL');
    expect(body).toContain('return res.status(404).json({ error: \'Learner not found in your school\' })');
    expect(body).toContain('(token, instructor_id, learner_email, learner_name, learner_id, scheduled_date, start_time, end_time,');
    expect(body).toContain('${resolvedEmail}, ${offerName}, ${existingLearner?.id || null}');
    expect(body).toContain('expires_at, school_id)');
  });

  test('new learner offer creation path remains supported', () => {
    const body = functionBody(read('api/instructor.js'), 'handleCreateOffer');

    expect(body).toContain('if (!learnerIdClean && !learner_email && !learner_name)');
    expect(body).toContain('} else if (learner_email) {');
    expect(body).toContain('const offerName = existingLearner?.name || learner_name || null');
    expect(body).toContain('if (resolvedEmail) {');
    expect(body).toContain('email_sent: emailSent');
    expect(body).toContain('accept_url: acceptUrl');
  });

  test('offer creation conflict checks stay school scoped and keep pending offers blocking the slot', () => {
    const body = functionBody(read('api/instructor.js'), 'handleCreateOffer');

    expect(body).toContain('FROM lesson_bookings');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('FROM lesson_offers');
    expect(body).toContain('AND status = \'pending\'');
    expect(body).toContain('AND expires_at > NOW()');
    expect(body).toContain('Someone is currently booking that slot');
  });

  test('accept-offer sends bound learner_id through Stripe metadata and still snapshots effective price', () => {
    const body = functionBody(read('api/offers.js'), 'handleAcceptOffer');

    expect(body).toContain('if (offer.learner_id) {');
    expect(body).toContain('WHERE id = ${offer.learner_id}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('learner_id:        boundLearner?.id ? String(boundLearner.id) : \'\'');
    expect(body).toContain('amount_pence:      String(pricePence)');
    expect(body).toContain('effective_rate_pence_per_minute: String(durationMins > 0 ? Math.round(pricePence / durationMins) : 0)');
  });

  test('webhook prefers the bound learner and rejects cross-school learner ids', () => {
    const body = functionBody(read('api/webhook.js'), 'handleOfferBooking');

    expect(body).toContain('const metadataLearnerId = parseInt(metadata.learner_id, 10) || null');
    expect(body).toContain('SELECT id, status, booking_id, learner_id, school_id FROM lesson_offers');
    expect(body).toContain('const schoolId = offer.school_id');
    expect(body).toContain('const boundLearnerId = offer.learner_id');
    expect(body).toContain('WHERE id = ${boundLearnerId}');
    expect(body).toContain('AND school_id = ${schoolId}');
    expect(body).toContain('bound learner ${boundLearnerId} not found in school ${schoolId}');
    expect(body).toContain('WHERE LOWER(email) = LOWER(${learnerEmail})');
  });

  test('webhook rejects Stripe metadata offer_id and school_id mismatches before processing', () => {
    const body = functionBody(read('api/webhook.js'), 'handleOfferBooking');

    expect(body).not.toContain('const schoolId = await resolveSchoolId(sql, metadata, session.id)');
    expect(body).toContain('WHERE token = ${offerToken}');
    expect(body).not.toContain('WHERE token = ${offerToken}\n        AND school_id = ${schoolId}');
    expect(body).toContain('if (metadata.school_id && metadataSchoolId !== schoolId) {');
    expect(body).toContain('metadata school_id ${metadata.school_id} does not match offer.school_id ${schoolId}');
    expect(body).toContain('if (metadata.offer_id && offerId !== offer.id) {');
    expect(body).toContain('metadata offer_id ${metadata.offer_id} does not match offer.id ${offer.id}');
    expect(body).toContain("reportError('/api/webhook (lesson_offer metadata mismatch)', err)");
  });

  test('webhook uses the DB offer id for all offer mutations and sibling supersede calls', () => {
    const body = functionBody(read('api/webhook.js'), 'handleOfferBooking');

    expect(body).toContain('WHERE id = ${offer.id}');
    expect(body).toContain('UPDATE lesson_offers SET status = \'cancelled\' WHERE id = ${offer.id} AND school_id = ${schoolId}');
    expect(body).toContain('winnerOfferId: offer.id');
    expect(body).toContain("metadata: { offer_id: String(offer.id), unused_weeks: String(unused) }");
    expect(body).not.toContain('WHERE id = ${offerId}');
    expect(body).not.toContain('winnerOfferId: offerId');
  });

  test('webhook rejects unexpected or conflicting learner_id metadata but allows a DB match', () => {
    const body = functionBody(read('api/webhook.js'), 'handleOfferBooking');

    const learnerGuard = body.indexOf('if (metadata.learner_id) {');
    const learnerResolution = body.indexOf('// 1. Find or create learner');
    expect(learnerGuard).toBeGreaterThanOrEqual(0);
    expect(learnerResolution).toBeGreaterThan(learnerGuard);

    expect(body).toContain('metadata learner_id ${metadataLearnerId} was supplied for unbound offer ${offer.id}');
    expect(body).toContain('metadata learner_id ${metadataLearnerId} does not match offer.learner_id ${offer.learner_id}');
    expect(body).toContain('if (metadataLearnerId !== offer.learner_id) {');
    expect(body).toContain('const boundLearnerId = offer.learner_id');
    expect(body).toContain('} else {\n      [existingLearner] = await sql`');
  });

  test('instructor UI exposes existing/new learner modes and posts learner_id for existing learners', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');
    const sendOffer = functionBody(js, 'sendOffer');

    expect(html).toContain('id="offerModeExisting"');
    expect(html).toContain('id="offerModeNew"');
    expect(html).toContain('id="offerLearnerSearch"');
    expect(js).toContain("ccAuth.fetchAuthed('/api/instructor?action=school-learners')");
    expect(js).toContain('function filterOfferLearners()');
    expect(js).toContain('function selectOfferLearner(id, name, detail)');
    expect(sendOffer).toContain('const existingMode = document.getElementById(\'offerModeExisting\').checked');
    expect(sendOffer).toContain('payload.learner_id = selectedOfferLearnerId');
    expect(sendOffer).toContain('payload.learner_name = offerName');
  });
});
