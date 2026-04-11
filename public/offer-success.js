(function () {
  'use strict';

  async function loadConfirmation() {
    var params = new URLSearchParams(location.search);
    var token = params.get('token');

    if (!token) {
      showSuccess();
      return;
    }

    try {
      var res = await fetch('/api/offers?action=get-offer&token=' + encodeURIComponent(token));
      var data = await res.json();

      if (data.code === 'ALREADY_ACCEPTED' || (data.ok && data.offer)) {
        // Offer was accepted — show the details we have
        if (data.ok && data.offer) {
          renderDetails(data.offer);
        } else {
          showSuccess();
        }
      } else {
        // The offer is accepted (webhook processed) — show generic success
        showSuccess();
      }
    } catch (err) {
      // Show generic success — the webhook may still be processing
      showSuccess();
    }
  }

  function renderDetails(offer) {
    var mins = offer.duration_minutes;
    var durStr;
    if (mins >= 60) {
      if (mins % 60 === 0) {
        var hrs = mins / 60;
        durStr = hrs + ' hour' + (hrs !== 1 ? 's' : '');
      } else {
        durStr = (mins / 60).toFixed(1) + ' hours';
      }
    } else {
      durStr = mins + ' mins';
    }

    if (offer.is_flexible) {
      document.getElementById('s-date').textContent = 'Flexible — you choose';
      document.getElementById('s-time').textContent = 'Book from the slot feed';
    } else {
      var dateObj = new Date(offer.scheduled_date + 'T00:00:00Z');
      var dateStr = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
      });
      document.getElementById('s-date').textContent = dateStr;
      document.getElementById('s-time').textContent =
        offer.start_time.slice(0, 5) + ' – ' + offer.end_time.slice(0, 5);
    }
    document.getElementById('s-instructor').textContent = offer.instructor_name;
    document.getElementById('s-duration').textContent = durStr;

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('success-content').classList.remove('hidden');
  }

  function showSuccess() {
    document.getElementById('loading').classList.add('hidden');
    // Can't get details — show a generic message
    document.getElementById('error-content').classList.remove('hidden');
  }

  loadConfirmation();
})();
