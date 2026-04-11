(function () {
  'use strict';

  var API = '/api/offers';
  var params = new URLSearchParams(location.search);
  var isFlexible = params.get('flexible') === '1';

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
    }

    document.getElementById('s-instructor').textContent = offer.instructor_name;
    document.getElementById('s-duration').textContent = durStr;

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('success-content').classList.remove('hidden');

    // Init slot picker for flexible offers
    if (flexible && instructorId) {
      initSlotPicker();
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
        initSlotPicker();
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

    // Show confirm strip
    var d = new Date(slot.date + 'T00:00:00');
    var dayLabel = DAY_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
    var timeStr = slot.start_time.slice(0, 5) + ' \u2013 ' + slot.end_time.slice(0, 5);

    var confirmEl = document.getElementById('sp-confirm');
    confirmEl.innerHTML =
      '<div class="sp-confirm-text">Book <strong>' + esc(dayLabel) + '</strong> at <strong>' + esc(timeStr) + '</strong>?</div>' +
      '<div class="sp-confirm-actions">' +
        '<button class="sp-confirm-cancel" id="sp-cancel">Pick a different time</button>' +
        '<button class="btn-primary" id="sp-book" style="padding:10px 24px;font-size:0.9rem;">Confirm booking</button>' +
      '</div>';
    confirmEl.classList.remove('hidden');

    document.getElementById('sp-cancel').addEventListener('click', cancelSelection);
    document.getElementById('sp-book').addEventListener('click', confirmBooking);

    // Scroll into view
    confirmEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cancelSelection() {
    selectedSlot = null;
    var prev = document.querySelector('.feed-card.selected');
    if (prev) prev.classList.remove('selected');
    document.getElementById('sp-confirm').classList.add('hidden');
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
