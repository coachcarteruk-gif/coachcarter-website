// Page-local glue for /learner/focused-practice.html.
// Extracted from an inline <script> in PR-P (audit #22) because production
// CSP blocks 'unsafe-inline'.
//
// Updates the flow step tag and stamps the results date when screens change.

(function () {
  var STEPS = {
    'screen-setup': 'Setup',
    'screen-drive': 'Driving',
    'screen-reflect': 'Reflect',
    'screen-results': 'Results'
  };
  function stampDate() {
    var el = document.getElementById('results-stamp-date');
    if (!el) return;
    var d = new Date();
    el.textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  function updateStepTag() {
    var tagEl = document.getElementById('step-tag');
    if (!tagEl) return;
    var sids = Object.keys(STEPS);
    for (var i = 0; i < sids.length; i++) {
      var el = document.getElementById(sids[i]);
      if (el && !el.classList.contains('hidden')) {
        tagEl.textContent = STEPS[sids[i]];
        if (sids[i] === 'screen-results') stampDate();
        return;
      }
    }
  }
  ['screen-setup', 'screen-drive', 'screen-reflect', 'screen-results'].forEach(function (sid) {
    var el = document.getElementById(sid);
    if (!el) return;
    new MutationObserver(updateStepTag).observe(el, {
      attributes: true, attributeFilter: ['class']
    });
  });
  // Initial run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateStepTag);
  } else {
    updateStepTag();
  }
})();
