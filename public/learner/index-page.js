// Post-checkout credit verification fallback. The dashboard owns balance display.
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
      .catch(function () { /* silent - webhook likely handled it */ });
  });
})();
