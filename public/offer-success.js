(function () {
  'use strict';

  var API = '/api/offers';
  var params = new URLSearchParams(location.search);
  var isFlexible = params.get('flexible') === '1';
  var isFree = params.get('free') === '1';

  // Slot picker state (populated from URL params for flexible offers)
  var instructorId = params.get('iid');
  var lessonTypeId = params.get('ltid') || null;
  var durationMins = parseInt(params.get('dur')) || 90;
  var instructorName = params.get('iname') ? decodeURIComponent(params.get('iname')) : '';

  var CHUNK_DAYS = 14;
  var MAX_DAYS = 90;
  var slotCache = {};
  var feedTo = null;
  var selectedSlot = null;

  // Captured from the offer payload so the auth gate can show the learner's
  // own email in a readonly username field (helps password managers, and
  // confirms which account they're setting up).
  var offerLearnerEmail = '';

  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function esc(s) {
    var el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  // ── Offer loading (same as before) ────────────────────────────────────────

  async function loadConfirmation() {
    var token = params.get('token');
    if (!token) { showSuccess(); return; }

    try {
      var res = await fetch(API + '?action=get-offer&token=' + encodeURIComponent(token));
      var data = await res.json();

      // Capture learner_email when the API returns it — both the pending-offer
      // payload and the post-acceptance minimal payload include it. The auth
      // gate uses it to pre-fill the username field for password managers.
      if (data.offer && data.offer.learner_email) {
        offerLearnerEmail = data.offer.learner_email;
      }

      // Both the pending-offer payload (data.ok + data.offer) and the
      // ALREADY_ACCEPTED payload (410 + data.offer) carry the offer details
      // we need to render the confirmation card. Treat them the same.
      if (data.offer) {
        renderDetails(data.offer);
      } else {
        showSuccess();
      }
    } catch (err) {
      showSuccess();
    }
  }

  function renderDetails(offer) {
    var mins = offer.duration_minutes;
    var durStr = formatDuration(mins);
    var flexible = offer.is_flexible || isFlexible;

    if (flexible) {
      document.getElementById('s-title').textContent = 'Payment received!';
      document.getElementById('s-subtitle').textContent =
        'Your lesson credit has been added to your account. Now pick a time that suits you.';
      document.getElementById('s-date-row').classList.add('hidden');
      document.getElementById('s-time-row').classList.add('hidden');

      // Hide info box and old CTA — slot picker replaces them
      document.getElementById('s-info').classList.add('hidden');
      document.getElementById('s-cta').classList.add('hidden');

      // Use offer data to fill picker params if not already from URL
      if (!instructorName) instructorName = offer.instructor_name || '';
    } else {
      var dateObj = new Date(offer.scheduled_date + 'T00:00:00Z');
      var dateStr = dateObj.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
      });
      document.getElementById('s-date').textContent = dateStr;
      document.getElementById('s-time').textContent =
        offer.start_time.slice(0, 5) + ' \u2013 ' + offer.end_time.slice(0, 5);
      if (isFree) {
        document.getElementById('s-subtitle').textContent =
          'Your free lesson is booked. We\u2019ll see you then.';
      }
    }

    document.getElementById('s-instructor').textContent = offer.instructor_name;
    document.getElementById('s-duration').textContent = durStr;

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('success-content').classList.remove('hidden');

    // Init slot picker for flexible offers — gate on auth first if guest
    if (flexible && instructorId) {
      gateThenInitSlotPicker();
    } else if (flexible) {
      // Fallback: show the old CTA if we don't have instructor data
      document.getElementById('s-info').classList.remove('hidden');
      document.getElementById('s-info').innerHTML =
        '<strong>What\u2019s next?</strong> Browse available slots and book your ' +
        durStr + ' lesson at a time that works for you.';
      document.getElementById('s-cta').href = '/learner/book.html';
      document.getElementById('s-cta').textContent = 'Book your lesson \u2192';
      document.getElementById('s-cta').classList.remove('hidden');
    }
  }

  function showSuccess() {
    document.getElementById('loading').classList.add('hidden');

    if (isFlexible) {
      document.getElementById('s-title').textContent = 'Payment received!';
      document.getElementById('s-subtitle').textContent =
        'Your lesson credit has been added. Now pick a time that suits you.';
      document.getElementById('s-details').classList.add('hidden');

      // Try slot picker if we have params, else fallback to CTA
      if (instructorId) {
        document.getElementById('s-info').classList.add('hidden');
        document.getElementById('s-cta').classList.add('hidden');
        document.getElementById('success-content').classList.remove('hidden');
        gateThenInitSlotPicker();
      } else {
        document.getElementById('s-info').innerHTML =
          '<strong>What\u2019s next?</strong> Browse available slots and book your lesson at a time that works for you.';
        document.getElementById('s-cta').href = '/learner/book.html';
        document.getElementById('s-cta').textContent = 'Book your lesson \u2192';
        document.getElementById('success-content').classList.remove('hidden');
      }
    } else {
      document.getElementById('error-content').classList.remove('hidden');
    }
  }

  function formatDuration(mins) {
    if (mins >= 60) {
      if (mins % 60 === 0) {
        var hrs = mins / 60;
        return hrs + ' hour' + (hrs !== 1 ? 's' : '');
      }
      return (mins / 60).toFixed(1) + ' hours';
    }
    return mins + ' mins';
  }

  // ── Auth Gate ──────────────────────────────────────────────────────────────
  // Guests who paid via Stripe Checkout have no session cookie on this device.
  // The slot-booking call uses fetchAuthed and would 401, leaving them with the
  // same broken-on-Confirm experience that brought us here. We force a tiny
  // password-set or sign-in step before showing the picker; on success the
  // session cookie is set and the picker proceeds normally.

  async function gateThenInitSlotPicker() {
    // Already signed in on this device? Skip the gate.
    if (window.ccAuth && window.ccAuth.getAuth && window.ccAuth.getAuth()) {
      initSlotPicker();
      return;
    }

    // Need an email to know which flow (set-password vs sign-in). The offer
    // payload should have it; if not, fall back to sign-in form with empty email.
    var email = offerLearnerEmail || '';
    var hasPassword = false;
    if (email) {
      try {
        var probe = await fetch('/api/learner-auth?action=check-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        });
        var probeData = await probe.json();
        hasPassword = !!probeData.has_password;
      } catch (e) {
        // If the lookup fails we'll still render the gate — sign-in mode is
        // the safer default since it never overwrites a password.
        hasPassword = true;
      }
    }

    renderAuthGate({ email: email, mode: hasPassword ? 'login' : 'set' });
  }

  function renderAuthGate(opts) {
    var mode = opts.mode; // 'set' or 'login'
    var gate = document.getElementById('auth-gate');
    var heading = document.getElementById('auth-gate-heading');
    var sub = document.getElementById('auth-gate-sub');
    var emailInput = document.getElementById('auth-gate-email');
    var pwInput = document.getElementById('auth-gate-password');
    var submitBtn = document.getElementById('auth-gate-submit');
    var errEl = document.getElementById('auth-gate-error');
    var switchEl = document.getElementById('auth-gate-switch');
    var form = document.getElementById('auth-gate-form');

    if (mode === 'set') {
      heading.textContent = 'Last step — set a password';
      sub.textContent = 'Pick a password so you can manage this booking and see your lesson history.';
      pwInput.setAttribute('autocomplete', 'new-password');
      pwInput.setAttribute('placeholder', 'At least 8 characters');
      submitBtn.textContent = 'Continue to slot picker';
    } else {
      heading.textContent = 'Sign in to book your slot';
      sub.textContent = 'You already have a CoachCarter account — enter your password to continue.';
      pwInput.setAttribute('autocomplete', 'current-password');
      pwInput.setAttribute('placeholder', 'Your password');
      submitBtn.textContent = 'Sign in and continue';
      // Offer a forgot-password escape hatch
      switchEl.innerHTML = 'Forgotten your password? <a href="/learner/login.html?redirect=' +
        encodeURIComponent(window.location.pathname + window.location.search) + '">Reset it on the sign-in page</a>.';
      switchEl.classList.remove('hidden');
    }

    if (opts.email) {
      emailInput.value = opts.email;
      emailInput.removeAttribute('readonly');
      emailInput.setAttribute('readonly', 'readonly');
      emailInput.style.display = '';
    } else if (mode === 'set') {
      // 'set' uses offer_token + password and ignores any typed email — hide the
      // field rather than risk the user thinking they can choose the email here.
      emailInput.style.display = 'none';
      emailInput.value = '';
    } else {
      // 'login' fallback — no captured email, let the user type one.
      emailInput.removeAttribute('readonly');
      emailInput.value = '';
      emailInput.setAttribute('placeholder', 'Your email');
      emailInput.style.display = '';
    }

    errEl.classList.add('hidden');
    gate.classList.remove('hidden');
    pwInput.focus();

    // Idempotent — replace any previous handler
    form.onsubmit = function (e) {
      e.preventDefault();
      submitAuthGate(mode);
    };
  }

  async function submitAuthGate(mode) {
    var emailInput = document.getElementById('auth-gate-email');
    var pwInput = document.getElementById('auth-gate-password');
    var submitBtn = document.getElementById('auth-gate-submit');
    var errEl = document.getElementById('auth-gate-error');

    var email = (emailInput.value || '').trim();
    var password = pwInput.value;

    if (mode === 'set') {
      if (!password) {
        errEl.textContent = 'Please enter a password.';
        errEl.classList.remove('hidden');
        return;
      }
    } else {
      if (!email || !password) {
        errEl.textContent = 'Please enter your email and password.';
        errEl.classList.remove('hidden');
        return;
      }
    }
    if (mode === 'set' && password.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.classList.remove('hidden');
      return;
    }

    var origLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'set' ? 'Setting password…' : 'Signing in…';
    errEl.classList.add('hidden');

    try {
      var url, body;
      if (mode === 'set') {
        url = '/api/learner-auth?action=set-password-from-offer';
        body = { offer_token: params.get('token'), password: password };
      } else {
        url = '/api/learner-auth?action=login';
        body = { email: email, password: password };
      }

      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = await res.json();

      if (!res.ok || !data.success) {
        // password_already_set is a recoverable case — switch to login mode
        if (data.error === 'password_already_set') {
          renderAuthGate({ email: email, mode: 'login' });
          return;
        }
        errEl.textContent = data.message || data.error || 'Could not continue. Please try again.';
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = origLabel;
        return;
      }

      // Success — server set the session cookie. Update the localStorage
      // display blob so window.ccAuth.getAuth() returns truthy on the booking
      // call's CSRF check.
      try {
        localStorage.setItem('cc_learner', JSON.stringify({ user: data.user }));
        if (window.ccAuth && window.ccAuth.onLogin) window.ccAuth.onLogin(data);
      } catch (_) {}

      // Hide the gate, render the slot picker.
      document.getElementById('auth-gate').classList.add('hidden');
      initSlotPicker();
    } catch (err) {
      errEl.textContent = 'Connection failed. Please try again.';
      errEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = origLabel;
    }
  }

  // ── Slot Picker ────────────────────────────────────────────────────────────

  function initSlotPicker() {
    var section = document.getElementById('sp-section');
    section.classList.remove('hidden');

    var today = new Date(); today.setHours(0, 0, 0, 0);
    feedTo = addDays(today, CHUNK_DAYS - 1);
    fetchSlots(fmtDate(today), fmtDate(feedTo));

    document.getElementById('sp-more').addEventListener('click', loadMore);
  }

  async function fetchSlots(from, to) {
    var url = '/api/slots?action=available&from=' + from + '&to=' + to +
      '&instructor_id=' + instructorId;
    if (lessonTypeId) url += '&lesson_type_id=' + lessonTypeId;

    try {
      var res = await fetch(url);
      var data = await res.json();
      if (data.slots) {
        // slots is an object keyed by date: { "2026-04-13": [{...}, ...], ... }
        for (var ds in data.slots) {
          if (!slotCache[ds]) slotCache[ds] = [];
          for (var i = 0; i < data.slots[ds].length; i++) {
            slotCache[ds].push(data.slots[ds][i]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load slots:', err);
    }

    document.getElementById('sp-loading').classList.add('hidden');
    renderFeed();
  }

  function renderFeed() {
    var allSlots = [];
    for (var ds in slotCache) {
      for (var i = 0; i < slotCache[ds].length; i++) {
        allSlots.push(slotCache[ds][i]);
      }
    }
    allSlots.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start_time < b.start_time ? -1 : 1;
    });

    var feedEl = document.getElementById('sp-feed');
    var footerEl = document.getElementById('sp-footer');

    if (allSlots.length === 0) {
      feedEl.innerHTML =
        '<p style="text-align:center;color:var(--muted);padding:20px 0;">No available slots in the next ' +
        CHUNK_DAYS + ' days.</p>';
      footerEl.classList.remove('hidden');
      document.getElementById('sp-status').textContent = '';
      return;
    }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var html = '<div class="slot-feed">';
    var lastDate = '';

    for (var j = 0; j < allSlots.length; j++) {
      var s = allSlots[j];
      if (s.date !== lastDate) {
        lastDate = s.date;
        var d = new Date(s.date + 'T00:00:00');
        var label;
        if (fmtDate(d) === fmtDate(today)) label = 'Today';
        else if (fmtDate(d) === fmtDate(addDays(today, 1))) label = 'Tomorrow';
        else label = DAY_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
        html += '<div class="feed-date-header">' + esc(label) + '</div>';
      }

      var timeStr = s.start_time.slice(0, 5) + ' \u2013 ' + s.end_time.slice(0, 5);
      html += '<div class="feed-card" data-idx="' + j + '">' +
        '<div class="feed-card-accent"></div>' +
        '<div class="feed-card-body">' +
          '<div class="feed-card-time">' + esc(timeStr) + '</div>' +
          '<div class="feed-card-sub">' + esc(instructorName || 'Instructor') + '</div>' +
        '</div>' +
        '<svg class="feed-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
      '</div>';
    }
    html += '</div>';
    feedEl.innerHTML = html;

    // Wire up click handlers
    var cards = feedEl.querySelectorAll('.feed-card');
    for (var k = 0; k < cards.length; k++) {
      (function (card, slot) {
        card.addEventListener('click', function () { selectSlot(slot, card); });
      })(cards[k], allSlots[parseInt(cards[k].dataset.idx)]);
    }

    // Footer
    footerEl.classList.remove('hidden');
    document.getElementById('sp-status').textContent = allSlots.length + ' slot' + (allSlots.length !== 1 ? 's' : '') + ' available';

    var today2 = new Date(); today2.setHours(0, 0, 0, 0);
    var maxDate = addDays(today2, MAX_DAYS);
    if (feedTo >= maxDate) {
      document.getElementById('sp-more').style.display = 'none';
    }
  }

  function loadMore() {
    var btn = document.getElementById('sp-more');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    var from = addDays(feedTo, 1);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    feedTo = addDays(feedTo, CHUNK_DAYS);
    var maxDate = addDays(today, MAX_DAYS);
    if (feedTo > maxDate) feedTo = maxDate;

    fetchSlots(fmtDate(from), fmtDate(feedTo)).then(function () {
      btn.disabled = false;
      btn.textContent = 'Show more slots';
    });
  }

  function selectSlot(slot, cardEl) {
    selectedSlot = slot;

    // Highlight the selected card
    var prev = document.querySelector('.feed-card.selected');
    if (prev) prev.classList.remove('selected');
    cardEl.classList.add('selected');

    // Remove any existing inline confirm strip
    var existing = document.querySelector('.sp-confirm-inline');
    if (existing) existing.remove();

    // Build confirm strip
    var d = new Date(slot.date + 'T00:00:00');
    var dayLabel = DAY_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
    var timeStr = slot.start_time.slice(0, 5) + ' \u2013 ' + slot.end_time.slice(0, 5);

    var strip = document.createElement('div');
    strip.className = 'sp-confirm sp-confirm-inline';
    strip.innerHTML =
      '<div class="sp-confirm-text">Book <strong>' + esc(dayLabel) + '</strong> at <strong>' + esc(timeStr) + '</strong>?</div>' +
      '<div class="sp-confirm-actions">' +
        '<button class="sp-confirm-cancel" id="sp-cancel">Pick a different time</button>' +
        '<button class="btn-primary" id="sp-book" style="padding:10px 24px;font-size:0.9rem;">Confirm booking</button>' +
      '</div>';

    // Insert directly after the selected card
    cardEl.parentNode.insertBefore(strip, cardEl.nextSibling);

    document.getElementById('sp-cancel').addEventListener('click', cancelSelection);
    document.getElementById('sp-book').addEventListener('click', confirmBooking);

    strip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cancelSelection() {
    selectedSlot = null;
    var prev = document.querySelector('.feed-card.selected');
    if (prev) prev.classList.remove('selected');
    var strip = document.querySelector('.sp-confirm-inline');
    if (strip) strip.remove();
    document.getElementById('sp-error').classList.add('hidden');
  }

  async function confirmBooking() {
    if (!selectedSlot) return;

    var bookBtn = document.getElementById('sp-book');
    bookBtn.disabled = true;
    bookBtn.textContent = 'Booking...';
    document.getElementById('sp-error').classList.add('hidden');

    try {
      var res = await window.ccAuth.fetchAuthed('/api/slots?action=book', {
        method: 'POST',
        body: JSON.stringify({
          instructor_id: parseInt(instructorId),
          date: selectedSlot.date,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
          lesson_type_id: lessonTypeId ? parseInt(lessonTypeId) : undefined
        })
      });
      var data = await res.json();

      if (!res.ok) {
        var errEl = document.getElementById('sp-error');
        errEl.textContent = data.message || data.error || 'Failed to book. Please try again.';
        errEl.classList.remove('hidden');
        bookBtn.disabled = false;
        bookBtn.textContent = 'Confirm booking';
        return;
      }

      // Success — show booked state
      var d = new Date(selectedSlot.date + 'T00:00:00');
      var dayLabel = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      var timeStr = selectedSlot.start_time.slice(0, 5) + ' \u2013 ' + selectedSlot.end_time.slice(0, 5);

      document.getElementById('sp-section').classList.add('hidden');
      document.getElementById('sp-booked').classList.remove('hidden');
      document.getElementById('sp-booked-text').textContent =
        dayLabel + ' at ' + timeStr + ' with ' + (instructorName || 'your instructor');

    } catch (err) {
      console.error('Booking error:', err);
      var errEl2 = document.getElementById('sp-error');
      errEl2.textContent = 'Connection failed. Please try again.';
      errEl2.classList.remove('hidden');
      bookBtn.disabled = false;
      bookBtn.textContent = 'Confirm booking';
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  loadConfirmation();
})();
