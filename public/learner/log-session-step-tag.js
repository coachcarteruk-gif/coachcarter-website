// Page-local glue for /learner/log-session.html.
// Extracted from an inline <script> in PR-P (audit #22) because production
// CSP blocks 'unsafe-inline'.
//
// Updates the doc-header step-tag as the log-session step changes.

(function () {
  var STEP_TAGS = { '1': 'Details', '2': 'Rate', '3': 'Notes' };
  function update() {
    var tagEl = document.getElementById('step-tag');
    if (!tagEl) return;
    // Active step
    var active = document.querySelector('.step.active');
    if (!active) return;
    var id = active.id;
    if (id === 'step-success') { tagEl.textContent = 'Done'; return; }
    var num = id.replace('step-', '');
    if (STEP_TAGS[num]) tagEl.textContent = STEP_TAGS[num];
  }
  // Observe each step's class for changes
  ['step-1', 'step-2', 'step-3', 'step-success'].forEach(function (sid) {
    var el = document.getElementById(sid);
    if (!el) return;
    new MutationObserver(update).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
  // Also catch programmatic navigation (data-goto buttons / save-btn)
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-goto], #save-btn')) {
      setTimeout(update, 50);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    update();
  }
})();
