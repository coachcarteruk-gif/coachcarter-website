(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var isFlexible = params.get('flexible') === '1';

  async function loadConfirmation() {
    var token = params.get('token');

    if (!token) {
      showSuccess();
      return;
    }

    try {
      var res = await fetch('/api/offers?action=get-offer&token=' + encodeURIComponent(token));
      var data = await res.json();

      if (data.code === 'ALREADY_ACCEPTED' || (data.ok && data.offer)) {
        if (data.ok && data.offer) {
          renderDetails(data.offer);
        } else {
          showSuccess();
        }
      } else {
        showSuccess();
      }
    } catch (err) {
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

    var flexible = offer.is_flexible || isFlexible;

    if (flexible) {
      // Flexible offer: credits added, no booking yet — direct to slot feed
      document.getElementById('s-title').textContent = 'Payment received!';
      document.getElementById('s-subtitle').textContent =
        'Your lesson credit has been added to your account. Now pick a time that suits you.';
      document.getElementById('s-date-row').classList.add('hidden');
      document.getElementById('s-time-row').classList.add('hidden');
      document.getElementById('s-info').innerHTML =
        '<strong>What\u2019s next?</strong> Browse available slots and book your ' +
        durStr + ' lesson at a time that works for you.';
      document.getElementById('s-cta').href = '/learner/book.html';
      document.getElementById('s-cta').textContent = 'Book your lesson \u2192';
    } else {
      var dateObj = new Date(offer.scheduled_date + 'T00:00:00Z');
      var dateStr = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
      });
      document.getElementById('s-date').textContent = dateStr;
      document.getElementById('s-time').textContent =
        offer.start_time.slice(0, 5) + ' \u2013 ' + offer.end_time.slice(0, 5);
    }

    document.getElementById('s-instructor').textContent = offer.instructor_name;
    document.getElementById('s-duration').textContent = durStr;

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('success-content').classList.remove('hidden');
  }

  function showSuccess() {
    document.getElementById('loading').classList.add('hidden');

    if (isFlexible) {
      // Flexible offer but can't fetch details — show flexible-specific generic message
      document.getElementById('s-title').textContent = 'Payment received!';
      document.getElementById('s-subtitle').textContent =
        'Your lesson credit has been added. Now pick a time that suits you.';
      document.getElementById('s-details').classList.add('hidden');
      document.getElementById('s-info').innerHTML =
        '<strong>What\u2019s next?</strong> Browse available slots and book your lesson at a time that works for you.';
      document.getElementById('s-cta').href = '/learner/book.html';
      document.getElementById('s-cta').textContent = 'Book your lesson \u2192';
      document.getElementById('success-content').classList.remove('hidden');
    } else {
      document.getElementById('error-content').classList.remove('hidden');
    }
  }

  loadConfirmation();
})();
