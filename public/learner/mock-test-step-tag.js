// Page-local glue for /learner/mock-test.html.
// Extracted from an inline <script> in PR-P (audit #22) because production
// CSP blocks 'unsafe-inline'.
//
// Updates the flow step tag as the mock-test screens change and
// stamps the date onto the results screen when it appears.

(function () {
  var SCREEN_TAGS = {
    'screen-mode': 'Mode',
    'screen-start': 'Brief',
    'screen-route': 'Route',
    'screen-part': 'Driving',
    'screen-faults': 'Faults',
    'screen-results': 'Verdict',
    'screen-map': 'Map'
  };
  function stampDate() {
    var el = document.getElementById('results-stamp-date');
    if (!el) return;
    var d = new Date();
    el.textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  function update() {
    var tagEl = document.getElementById('step-tag');
    if (!tagEl) return;
    var sids = Object.keys(SCREEN_TAGS);
    for (var i = 0; i < sids.length; i++) {
      var el = document.getElementById(sids[i]);
      if (el && !el.classList.contains('hidden')) {
        tagEl.textContent = SCREEN_TAGS[sids[i]];
        if (sids[i] === 'screen-results') stampDate();
        return;
      }
    }
  }
  Object.keys(SCREEN_TAGS).forEach(function (sid) {
    var el = document.getElementById(sid);
    if (!el) return;
    new MutationObserver(update).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  // Also catch any click that might trigger a screen change before the observer
  // wires up (first interaction after page load).
  document.addEventListener('click', function () { setTimeout(update, 50); }, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    update();
  }
})();
