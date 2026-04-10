(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var bookingId = params.get('booking_id');
  var token = null;

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatTime(timeStr) {
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return h12 + ':' + m + ampm;
  }

  async function init() {
    if (window.ccAuth && !window.ccAuth.requireAuth()) return;

    var stored = localStorage.getItem('cc_learner');
    if (!stored) {
      window.location.href = '/learner/login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    var parsed = JSON.parse(stored);
    token = parsed.token;

    if (!bookingId) {
      // No booking_id — show list of pending confirmations
      await loadPendingList();
      return;
    }

    await loadBooking();
  }

  async function loadPendingList() {
    try {
      var res = await ccAuth.fetchAuthed('/api/learner?action=pending-confirmations');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.bookings.length === 0) {
        document.getElementById('content').innerHTML =
          '<div class="success-card">' +
          '<h2>All caught up!</h2>' +
          '<p>You have no lessons to confirm right now.</p>' +
          '<a href="/learner/book.html">Back to dashboard</a>' +
          '</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < data.bookings.length; i++) {
        var b = data.bookings[i];
        html += '<div class="lesson-info-card" style="cursor:pointer" data-booking-id="' + b.id + '">' +
          '<div class="lesson-info-row">' +
          '<span class="lesson-info-label">Date</span>' +
          '<span class="lesson-info-val">' + formatDate(b.scheduled_date) + '</span>' +
          '</div>' +
          '<div class="lesson-info-row">' +
          '<span class="lesson-info-label">Time</span>' +
          '<span class="lesson-info-val">' + formatTime(b.start_time) + ' - ' + formatTime(b.end_time) + '</span>' +
          '</div>' +
          '<div class="lesson-info-row">' +
          '<span class="lesson-info-label">Instructor</span>' +
          '<span class="lesson-info-val">' + b.instructor_name + '</span>' +
          '</div>' +
          '<div style="text-align:right;margin-top:8px;">' +
          '<span style="color:var(--accent);font-weight:700;font-size:0.85rem;">Confirm \u2192</span>' +
          '</div>' +
          '</div>';
      }
      var container = document.getElementById('content');
      container.innerHTML = html;

      // Wire up click handlers (previously inline onclick)
      var cards = container.querySelectorAll('.lesson-info-card[data-booking-id]');
      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          window.location.href = '?booking_id=' + card.dataset.bookingId;
        });
      });
    } catch (err) {
      document.getElementById('content').innerHTML =
        '<p style="color:red;">Failed to load: ' + err.message + '</p>';
    }
  }

  async function loadBooking() {
    try {
      var res = await ccAuth.fetchAuthed('/api/learner?action=pending-confirmations');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      var booking = data.bookings.find(function (b) { return b.id === parseInt(bookingId, 10); });

      if (!booking) {
        document.getElementById('content').innerHTML =
          '<div class="success-card">' +
          '<h2>Already confirmed</h2>' +
          '<p>This lesson has already been confirmed or is no longer pending.</p>' +
          '<a href="/learner/book.html">Back to dashboard</a>' +
          '</div>';
        return;
      }

      document.getElementById('content').innerHTML =
        '<div class="lesson-info-card">' +
        '<div class="lesson-info-row">' +
        '<span class="lesson-info-label">Date</span>' +
        '<span class="lesson-info-val">' + formatDate(booking.scheduled_date) + '</span>' +
        '</div>' +
        '<div class="lesson-info-row">' +
        '<span class="lesson-info-label">Time</span>' +
        '<span class="lesson-info-val">' + formatTime(booking.start_time) + ' - ' + formatTime(booking.end_time) + '</span>' +
        '</div>' +
        '<div class="lesson-info-row">' +
        '<span class="lesson-info-label">Instructor</span>' +
        '<span class="lesson-info-val">' + booking.instructor_name + '</span>' +
        '</div>' +
        '</div>' +
        '<div class="confirm-card">' +
        '<div class="confirm-card-title">Your confirmation</div>' +
        '<div class="form-group">' +
        '<label>Did this lesson take place?</label>' +
        '<select id="cf-happened">' +
        '<option value="true">Yes, it happened</option>' +
        '<option value="false">No, it didn\'t happen</option>' +
        '</select>' +
        '</div>' +
        '<div class="form-group">' +
        '<label>Was anyone late?</label>' +
        '<select id="cf-late">' +
        '<option value="">No one was late</option>' +
        '<option value="instructor">My instructor was late</option>' +
        '<option value="learner">I was late</option>' +
        '</select>' +
        '</div>' +
        '<div class="form-group" id="cf-mins-row" style="display:none">' +
        '<label>How many minutes late?</label>' +
        '<select id="cf-mins">' +
        '<option value="5">5 minutes</option>' +
        '<option value="10">10 minutes</option>' +
        '<option value="15">15 minutes</option>' +
        '<option value="20">20 minutes</option>' +
        '<option value="30">30 minutes</option>' +
        '<option value="45">45 minutes</option>' +
        '<option value="60">60 minutes</option>' +
        '</select>' +
        '</div>' +
        '<div class="form-group">' +
        '<label>Any notes about the lesson? (optional)</label>' +
        '<textarea id="cf-notes" placeholder="Anything you\'d like to share about the lesson..."></textarea>' +
        '</div>' +
        '<button class="btn-submit" id="btn-submit">Submit confirmation</button>' +
        '</div>';

      // Wire up the Was anyone late? onchange behaviour
      var lateSel = document.getElementById('cf-late');
      var minsRow = document.getElementById('cf-mins-row');
      lateSel.addEventListener('change', function () {
        minsRow.style.display = lateSel.value ? 'block' : 'none';
      });

      // Wire up submit
      document.getElementById('btn-submit').addEventListener('click', submitConfirmation);
    } catch (err) {
      document.getElementById('content').innerHTML =
        '<p style="color:red;">Failed to load: ' + err.message + '</p>';
    }
  }

  async function submitConfirmation() {
    var btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    var happened = document.getElementById('cf-happened').value === 'true';
    var lateParty = document.getElementById('cf-late').value || null;
    var lateMinutes = lateParty ? parseInt(document.getElementById('cf-mins').value, 10) : null;
    var notes = document.getElementById('cf-notes').value.trim() || null;

    try {
      var res = await ccAuth.fetchAuthed('/api/learner?action=confirm-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: parseInt(bookingId, 10),
          lesson_happened: happened,
          late_party: lateParty,
          late_minutes: lateMinutes,
          notes: notes
        })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      document.getElementById('content').innerHTML =
        '<div class="success-card">' +
        '<div style="font-size:3rem;margin-bottom:12px;">\u2713</div>' +
        '<h2>Lesson confirmed!</h2>' +
        '<p>Thanks for confirming. Your feedback helps us keep things running smoothly.</p>' +
        '<a href="/learner/book.html">Back to dashboard</a>' +
        '</div>';
    } catch (err) {
      alert('Failed to submit: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Submit confirmation';
    }
  }

  init();
})();
