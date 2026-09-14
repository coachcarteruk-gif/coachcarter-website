/* Meta Pixel — consent-gated and limited to pages that include this loader. */
(function () {
  'use strict';

  var PIXEL_ID = '2271167423422360';
  var loaded = false;

  function loadMetaPixel() {
    if (loaded) {
      if (window.fbq) window.fbq('consent', 'grant');
      return;
    }
    loaded = true;

    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
  }

  function revokeMetaPixel() {
    if (window.fbq) window.fbq('consent', 'revoke');
  }

  function checkAndLoad() {
    if (window.ccCookieConsent && window.ccCookieConsent.marketingAllowed()) {
      loadMetaPixel();
    } else {
      revokeMetaPixel();
    }
  }

  function trackLead() {
    if (!window.ccCookieConsent || !window.ccCookieConsent.marketingAllowed()) {
      return false;
    }

    loadMetaPixel();
    window.fbq('track', 'Lead');
    return true;
  }

  window.ccMetaPixel = {
    trackLead: trackLead
  };

  checkAndLoad();

  document.addEventListener('cookie-consent-updated', function (event) {
    if (event.detail && event.detail.marketing) {
      loadMetaPixel();
    } else {
      revokeMetaPixel();
    }
  });
})();
