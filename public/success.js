(function () {
  'use strict';

  // Get session_id from URL
  var urlParams = new URLSearchParams(window.location.search);
  var sessionId = urlParams.get('session_id');

  if (!sessionId) {
    document.getElementById('loading-state').innerHTML =
      '<p>Invalid session. Please contact us if you completed a payment.</p>';
    return;
  }

  // Verify session with backend
  fetch('/api/verify-session?session_id=' + encodeURIComponent(sessionId))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) {
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('success-state').style.display = 'block';

        document.getElementById('ref').textContent = data.booking_ref;
        document.getElementById('package').textContent = data.package_name;
        document.getElementById('amount').textContent = '\u00A3' + data.amount;

        // Custom next steps based on package
        if (data.package_type === 'pass_guarantee') {
          var nextSteps = document.getElementById('next-steps');
          // Build via DOM to avoid innerHTML of static strings
          nextSteps.textContent = '';
          var h3 = document.createElement('h3');
          h3.textContent = 'Your 18-week programme';
          var p = document.createElement('p');
          p.textContent = "We're verifying your licence and test details. Check your email in 5 minutes for your availability form link.";
          nextSteps.appendChild(h3);
          nextSteps.appendChild(p);
        }
      } else {
        throw new Error('Verification failed');
      }
    })
    .catch(function () {
      var el = document.getElementById('loading-state');
      el.textContent = '';
      var p1 = document.createElement('p');
      p1.textContent = 'Something went wrong confirming your payment.';
      var p2 = document.createElement('p');
      p2.textContent = "Don't worry — if you completed payment, we have your details. Contact us at hello@coachcarter.com";
      el.appendChild(p1);
      el.appendChild(p2);
    });
})();
