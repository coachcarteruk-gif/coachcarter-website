// Page-local glue for /learner/ (dashboard).
// Previously two inline <script> blocks in learner/index.html — moved to an
// external file in PR-P (audit #22) because production CSP blocks 'unsafe-inline'.
//
// (1) Mirror legacy balance/readiness DOM into the new twin stat panels.
//     Watches #credit-balance-line and #readiness-value and copies their
//     content into #stat-balance-value / #stat-readiness-value, so the
//     existing index.js keeps working unmodified.
//
// (2) Post-checkout credit verification fallback. When the page is loaded
//     with ?hours_added=&session_id= in the URL (Stripe success redirect),
//     verify the session via /api/credits and show a toast.

(function () {
  function mirror() {
    // Balance: read the credit-balance-line text, extract the hours number.
    var line = document.getElementById('credit-balance-line');
    var balVal = document.getElementById('stat-balance-value');
    var balSub = document.getElementById('stat-balance-sub');
    if (line && balVal) {
      // The legacy markup is `<span class="credit-badge">3.5 hrs remaining</span>` or
      // `<span class="credit-badge">3 hrs remaining</span>` — pull out the number.
      var raw = (line.textContent || '').trim();
      var m = raw.match(/([\d.]+)\s*hrs?/i);
      if (m) {
        balVal.textContent = m[1];
        balSub.textContent = 'across instructors';
      } else if (raw) {
        balVal.textContent = raw;
        balSub.textContent = '';
      }
    }
    // Readiness: read #readiness-value text.
    var rv = document.getElementById('readiness-value');
    var sv = document.getElementById('stat-readiness-value');
    if (rv && sv && rv.textContent && rv.textContent !== '0%') {
      sv.innerHTML = '<em>' + rv.textContent + '</em>';
    }
  }
  // Run once after DOMContentLoaded and again after a short delay (index.js
  // populates these asynchronously after fetching auth+bookings).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mirror);
  } else {
    mirror();
  }
  setTimeout(mirror, 600);
  setTimeout(mirror, 1500);
})();

(function () {
  var params = new URLSearchParams(window.location.search);
  var hoursAdded = params.get('hours_added');
  var sessionId = params.get('session_id');
  if (!hoursAdded || !sessionId) return;

  // Clean URL immediately
  var clean = window.location.pathname;
  window.history.replaceState({}, '', clean);

  // Wait for auth to be ready, then verify
  window.addEventListener('DOMContentLoaded', function () {
    if (!window.ccAuth || !ccAuth.getAuth()) return;

    ccAuth.fetchAuthed('/api/credits?action=verify&session_id=' + encodeURIComponent(sessionId))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          var toast = document.getElementById('credit-toast');
          toast.textContent = hoursAdded + ' hours added to your account!';
          toast.classList.add('show');
          setTimeout(function () { toast.classList.remove('show'); }, 5000);
        }
      })
      .catch(function () { /* silent — webhook likely handled it */ });
  });
})();
