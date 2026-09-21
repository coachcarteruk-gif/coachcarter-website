(function () {
  'use strict';
  var path = location.pathname;
  var campaignPage = /^\/test-booked(?:\.html)?\/?$/.test(path);
  var generalPage = /^\/(?:freetrial|free-lesson\.html)\/?$/.test(path);
  var bookingPage = /^\/(?:free|free-trial\.html)\/?$/.test(path);
  var qs = new URLSearchParams(location.search);
  var viewed = false;
  var started = false;
  function allowed() { return !!(window.ccCookieConsent && window.ccCookieConsent.analyticsAllowed()); }
  function context() {
    var campaign = campaignPage || qs.get('campaign') === 'test_booked_v1';
    return { entry_page: campaign ? 'test_booked' : generalPage || qs.get('entry') === 'freetrial' ? 'freetrial' : qs.has('campaign') || qs.has('entry') ? 'unknown' : 'free_direct',
      campaign_key: campaign ? 'test_booked_v1' : null, content_version: (campaignPage ? window.ccTrialMediaVersion === 'video_v1' : qs.get('content') === 'video_v1') ? 'video_v1' : 'text_v1',
      form_version: window.ccTrialQuestionnaireEnabled ? 'qualification_v1' : 'test_details_v1', analytics_consent_at_booking: allowed() };
  }
  function send(event, placement) {
    if (!['trial_landing_viewed','free_trial_page_viewed','free_trial_booking_started','free_trial_submitted','free_trial_confirmed','trial_booking_cta_clicked',
      'trial_questionnaire_started','trial_questionnaire_step_1_completed','trial_questionnaire_step_2_completed','trial_questionnaire_step_3_completed',
      'trial_questionnaire_booking_route','trial_questionnaire_request_route','trial_request_submitted'].includes(event)) return false;
    if (!allowed() || !window.posthog || !window.posthog.__loaded) return false;
    var props = context(); delete props.analytics_consent_at_booking;
    if (['hero','no_test','after_intro','closing','sticky','general'].includes(placement)) props.placement = placement;
    try { window.posthog.capture(event, props); return true; }
    catch (e) { return false; } // Analytics must never interrupt a booking.
  }
  function exposure() {
    if (campaignPage && !window.ccTrialMediaReady) return;
    if (viewed || document.visibilityState === 'hidden') return;
    if (campaignPage || generalPage) viewed = send('trial_landing_viewed');
    else if (bookingPage) viewed = send('free_trial_page_viewed');
  }
  function start() {
    if (started || !allowed()) return;
    try { if (sessionStorage.getItem('cc_trial_started') === '1') { started = true; return; } } catch (e) {}
    started = send('free_trial_booking_started');
    if (started) { try { sessionStorage.setItem('cc_trial_started', '1'); } catch (e) {} }
  }
  window.ccTrialFunnel = { context: context, start: start, send: send };
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-trial-placement]');
    if (a) send('trial_booking_cta_clicked', a.dataset.trialPlacement);
  });
  document.addEventListener('cookie-consent-updated', function () {
    if (!allowed()) { started = false; try { sessionStorage.removeItem('cc_trial_started'); } catch (e) {} }
    else exposure();
  });
  document.addEventListener('cc-posthog-ready', exposure);
  document.addEventListener('cc-trial-media-ready', exposure);
  document.addEventListener('visibilitychange', exposure);
  exposure();
}());
