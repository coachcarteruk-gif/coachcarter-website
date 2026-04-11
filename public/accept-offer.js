(function () {
  'use strict';

  var API = '/api/offers';
  var offerData = null;
  var expiryInterval = null;

  // Get token from URL
  var params = new URLSearchParams(location.search);
  var token = params.get('token');
  var wasCancelled = params.get('cancelled') === '1';

  async function loadOffer() {
    if (!token) {
      showError('No offer token', 'Please use the link from your email to access this page.');
      return;
    }

    try {
      var res = await fetch(API + '?action=get-offer&token=' + encodeURIComponent(token));
      var data = await res.json();

      if (!res.ok) {
        var titles = {
          EXPIRED: 'Offer expired',
          ALREADY_ACCEPTED: 'Already accepted',
          CANCELLED: 'Offer cancelled',
          NOT_FOUND: 'Offer not found'
        };
        var messages = {
          EXPIRED: 'This lesson offer has expired. Please ask your instructor to send a new one.',
          ALREADY_ACCEPTED: 'This lesson offer has already been accepted and paid for.',
          CANCELLED: 'This lesson offer was cancelled by the instructor.',
          NOT_FOUND: 'This offer link is invalid. Please check the link from your email.'
        };
        showError(titles[data.code] || 'Unavailable', messages[data.code] || data.message || 'Something went wrong.');
        return;
      }

      offerData = data.offer;
      renderOffer();
    } catch (err) {
      console.error('Failed to load offer:', err);
      showError('Connection error', 'Failed to load the offer. Please try again.');
    }
  }

  function renderOffer() {
    var o = offerData;

    // Format duration
    var mins = o.duration_minutes;
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

    // Fill card
    document.getElementById('instructor-name').textContent = o.instructor_name;

    // Handle flexible vs slot-pinned offers
    var dateEl = document.getElementById('offer-date');
    var timeEl = document.getElementById('offer-time');
    if (o.is_flexible) {
      dateEl.textContent = 'Flexible — you choose';
      timeEl.textContent = 'Book a time that works for you';
    } else {
      var dateObj = new Date(o.scheduled_date + 'T00:00:00Z');
      var dateStr = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
      });
      dateEl.textContent = dateStr;
      timeEl.textContent = o.start_time.slice(0, 5) + ' – ' + o.end_time.slice(0, 5);
    }

    document.getElementById('offer-duration').textContent = durStr;
    document.getElementById('offer-instructor').textContent = o.instructor_name;

    // Price display — build with DOM to avoid injecting HTML via innerHTML
    var priceEl = document.getElementById('offer-price');
    priceEl.textContent = '';
    if (o.price_pence === 0) {
      var free = document.createElement('span');
      free.style.color = '#22c55e';
      free.style.fontWeight = '800';
      free.textContent = 'FREE';
      priceEl.appendChild(free);
    } else if (o.price_pence < o.original_price_pence) {
      var strike = document.createElement('span');
      strike.style.textDecoration = 'line-through';
      strike.style.color = '#999';
      strike.style.fontWeight = '400';
      strike.textContent = '\u00A3' + (o.original_price_pence / 100).toFixed(2);
      priceEl.appendChild(strike);
      priceEl.appendChild(document.createTextNode(' \u00A3' + (o.price_pence / 100).toFixed(2) + ' '));
      var saving = document.createElement('span');
      saving.style.color = '#22c55e';
      saving.style.fontSize = '0.8rem';
      saving.textContent = '(\u00A3' + ((o.original_price_pence - o.price_pence) / 100).toFixed(2) + ' off)';
      priceEl.appendChild(saving);
    } else {
      priceEl.textContent = '\u00A3' + (o.price_pence / 100).toFixed(2);
    }

    // Pre-fill form
    if (o.learner_name) document.getElementById('name').value = o.learner_name;
    if (o.learner_phone) document.getElementById('phone').value = o.learner_phone;
    if (o.learner_pickup_address) document.getElementById('pickup').value = o.learner_pickup_address;

    // Update button text for free lessons
    if (o.price_pence === 0) {
      document.getElementById('accept-btn').textContent = 'Accept free lesson →';
    }

    // Start expiry countdown
    updateExpiry();
    expiryInterval = setInterval(updateExpiry, 1000);

    // Show content
    document.getElementById('loading').classList.add('hidden');
    if (wasCancelled) {
      document.getElementById('cancelled-state').classList.remove('hidden');
    }
    document.getElementById('offer-content').classList.remove('hidden');
  }

  function updateExpiry() {
    if (!offerData) return;
    var now = Date.now();
    var exp = new Date(offerData.expires_at).getTime();
    var diff = exp - now;

    if (diff <= 0) {
      document.getElementById('expiry-text').textContent = 'This offer has expired';
      document.getElementById('expiry-bar').classList.add('expired');
      document.getElementById('accept-btn').disabled = true;
      clearInterval(expiryInterval);
      return;
    }

    var hours = Math.floor(diff / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    var seconds = Math.floor((diff % 60000) / 1000);

    var text = 'Expires in ';
    if (hours > 0) text += hours + 'h ' + minutes + 'm';
    else if (minutes > 0) text += minutes + 'm ' + seconds + 's';
    else text += seconds + 's';

    document.getElementById('expiry-text').textContent = text;
  }

  async function handleAccept() {
    var name = document.getElementById('name').value.trim();
    var phone = document.getElementById('phone').value.trim();
    var pickup = document.getElementById('pickup').value.trim();
    var errorEl = document.getElementById('form-error');

    if (!name) {
      errorEl.textContent = 'Please enter your full name.';
      errorEl.style.display = 'block';
      document.getElementById('name').focus();
      return;
    }

    errorEl.style.display = 'none';
    var btn = document.getElementById('accept-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      var res = await fetch(API + '?action=accept-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, name: name, phone: phone, pickup_address: pickup })
      });
      var data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.message || data.error || 'Something went wrong. Please try again.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Accept & pay →';
        return;
      }

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      console.error('Accept error:', err);
      errorEl.textContent = 'Connection failed. Please try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Accept & pay →';
    }
  }

  function showError(title, message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-text').textContent = message;
    document.getElementById('error-state').classList.remove('hidden');
  }

  // Wire up the accept button (previously an inline onclick handler)
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('accept-btn');
    if (btn) btn.addEventListener('click', handleAccept);
  });

  // Init
  loadOffer();
})();
