(function () {
  'use strict';

  var META_LEAD_PENDING_KEY = 'cc_meta_lead_pending';
  var pending = false;

  try {
    pending = sessionStorage.getItem(META_LEAD_PENDING_KEY) === '1';
  } catch (e) { /* sessionStorage unavailable */ }

  if (!pending || !window.ccMetaPixel) return;
  if (!window.ccMetaPixel.trackLead()) return;

  try {
    sessionStorage.removeItem(META_LEAD_PENDING_KEY);
  } catch (e) { /* sessionStorage unavailable */ }
})();
