(function () {
  'use strict';

  var upcomingBookings = [];
  var pastBookings = [];
  var hasMorePast = false;
  var pastOffset = 0;
  var PAST_PAGE_SIZE = 20;
  var activeTab = 'upcoming';
  var pendingCancel = null;

  function init() {
    if (!ccAuth.getAuth()) { window.location.href = '/learner/login.html'; return; }

    // Static handlers previously inline
    document.getElementById('tabUpcoming').addEventListener('click', function () { switchTab('upcoming'); });
    document.getElementById('tabPast').addEventListener('click', function () { switchTab('past'); });
    document.getElementById('cancelSeriesCheck').addEventListener('change', toggleCancelSeriesInfo);
    document.getElementById('cancelAckCheck').addEventListener('change', toggleCancelBtn);

    // Event delegation for dynamically rendered buttons inside #lessonContent
    document.getElementById('lessonContent').addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.dataset.action;
      if (action === 'load-more-past') {
        loadMorePast();
      } else if (action === 'download-calendar') {
        downloadCalendar(parseInt(target.dataset.bookingId, 10));
      } else if (action === 'open-cancel-modal') {
        openCancelModal(
          parseInt(target.dataset.bookingId, 10),
          target.dataset.date,
          target.dataset.start,
          target.dataset.end,
          target.dataset.instructorName,
          parseFloat(target.dataset.hoursUntil),
          target.dataset.seriesId || null
        );
      } else if (action === 'open-reschedule-modal') {
        openRescheduleModal(
          parseInt(target.dataset.bookingId, 10),
          target.dataset.date,
          target.dataset.start,
          target.dataset.end,
          target.dataset.instructorName,
          parseInt(target.dataset.instructorId, 10),
          target.dataset.lessonTypeId ? parseInt(target.dataset.lessonTypeId, 10) : null
        );
      } else if (action === 'rebook') {
        window.location.href = target.dataset.url;
      }
    });

    document.getElementById('cancelModal').addEventListener('click', function (e) {
      if (e.target === document.getElementById('cancelModal'))
        document.getElementById('cancelModal').classList.remove('open');
    });
    document.getElementById('cancelModalClose').addEventListener('click', function () {
      document.getElementById('cancelModal').classList.remove('open');
    });
    document.getElementById('btnConfirmCancel').addEventListener('click', confirmCancel);

    document.getElementById('rescheduleModal').addEventListener('click', function (e) {
      if (e.target === document.getElementById('rescheduleModal')) closeRescheduleModal();
    });

    // Cancel button inside the reschedule modal (was inline onclick)
    var rescheduleModalCloseBtn = document.querySelector('#rescheduleModal .btn-modal-cancel');
    if (rescheduleModalCloseBtn) {
      rescheduleModalCloseBtn.addEventListener('click', closeRescheduleModal);
    }

    loadBookings();
  }

  async function loadBookings() {
    try {
      pastOffset = 0;
      var res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings&past_limit=' + PAST_PAGE_SIZE + '&past_offset=0');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      upcomingBookings = data.upcoming || [];
      pastBookings = data.past || [];
      hasMorePast = data.hasMorePast || false;

      document.getElementById('tabUpcoming').textContent = 'Upcoming' + (upcomingBookings.length ? ' (' + upcomingBookings.length + ')' : '');
      document.getElementById('tabPast').textContent = 'Past' + (pastBookings.length ? '+' : '');

      renderTab();
    } catch (err) {
      document.getElementById('lessonContent').innerHTML =
        '<div class="empty-state"><div class="empty-icon">&#x26A0;&#xFE0F;</div>' +
        '<p>' + esc(err.message || 'Failed to load lessons') + '</p></div>';
    }
  }

  async function loadMorePast() {
    var btn = document.getElementById('btnLoadMorePast');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      pastOffset += PAST_PAGE_SIZE;
      var res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings&past_limit=' + PAST_PAGE_SIZE + '&past_offset=' + pastOffset);
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      pastBookings = pastBookings.concat(data.past || []);
      hasMorePast = data.hasMorePast || false;
      renderPast();
    } catch (err) {
      showToast(err.message || 'Failed to load more', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('tabUpcoming').classList.toggle('active', tab === 'upcoming');
    document.getElementById('tabPast').classList.toggle('active', tab === 'past');
    renderTab();
  }

  function renderTab() {
    if (activeTab === 'upcoming') renderUpcoming();
    else renderPast();
  }

  function renderUpcoming() {
    var container = document.getElementById('lessonContent');
    if (upcomingBookings.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-icon">&#x1F4C5;</div>' +
        '<h3>No upcoming lessons</h3>' +
        '<p>Book your next driving lesson to get started.</p>' +
        '<a href="/learner/book.html" class="btn-book-link">Book a Lesson</a>' +
        '</div>';
      return;
    }

    // Group series bookings
    var seriesMap = {};
    var standalone = [];
    for (var i = 0; i < upcomingBookings.length; i++) {
      var b = upcomingBookings[i];
      if (b.series_id) {
        if (!seriesMap[b.series_id]) seriesMap[b.series_id] = [];
        seriesMap[b.series_id].push(b);
      } else {
        standalone.push(b);
      }
    }

    var html = '';
    var seriesIds = Object.keys(seriesMap);
    for (var s = 0; s < seriesIds.length; s++) {
      var sid = seriesIds[s];
      var bookings = seriesMap[sid];
      var first = bookings[0];
      html += '<div class="series-group">' +
        '<div class="series-header">' +
        '<span>Weekly series — ' + bookings.length + ' remaining</span>' +
        '<button data-action="open-cancel-modal"' +
        ' data-booking-id="' + first.id + '"' +
        ' data-date="' + first.scheduled_date + '"' +
        ' data-start="' + first.start_time.slice(0, 5) + '"' +
        ' data-end="' + first.end_time.slice(0, 5) + '"' +
        ' data-instructor-name="' + esc(first.instructor_name) + '"' +
        ' data-hours-until="999"' +
        ' data-series-id="' + sid + '">Cancel series</button>' +
        '</div>';
      html += groupByDate(bookings, false);
      html += '</div>';
    }

    html += groupByDate(standalone, false);
    container.innerHTML = html;
  }

  function renderPast() {
    var container = document.getElementById('lessonContent');
    if (pastBookings.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-icon">&#x1F552;</div>' +
        '<h3>No past lessons</h3>' +
        '<p>Your completed and cancelled lessons will appear here.</p>' +
        '</div>';
      return;
    }

    var html = groupByDate(pastBookings, true);
    if (hasMorePast) {
      html += '<div style="text-align:center;padding:16px 0">' +
        '<button id="btnLoadMorePast" data-action="load-more-past"' +
        ' style="padding:10px 24px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body);color:var(--primary)">Load more</button>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  function groupByDate(bookings, isPast) {
    var html = '';
    var lastDate = '';
    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i];
      if (b.scheduled_date !== lastDate) {
        lastDate = b.scheduled_date;
        var d = new Date(b.scheduled_date + 'T00:00:00Z');
        var dateStr = d.toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
        });
        var today = new Date();
        var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        if (b.scheduled_date === todayStr) dateStr = 'Today — ' + dateStr;
        html += '<div class="date-header">' + dateStr + '</div>';
      }
      html += renderLessonCard(b, isPast);
    }
    return html;
  }

  function renderLessonCard(b, isPast) {
    var start = b.start_time.slice(0, 5);
    var end = b.end_time.slice(0, 5);
    var ltColour = b.lesson_type_colour || 'var(--accent)';
    var ltName = b.lesson_type_name || '';
    var addr = b.pickup_address || '';
    var isCancelled = b.status === 'cancelled';
    var isCompleted = b.status === 'completed';
    var isAwaiting = b.status === 'awaiting_confirmation';

    var lessonMs = new Date(b.scheduled_date + 'T' + b.start_time + 'Z').getTime();
    var hoursUntil = (lessonMs - Date.now()) / 3600000;
    var canAct = !isPast && hoursUntil > 0;
    var canReschedule = canAct && hoursUntil >= 48 && (b.reschedule_count || 0) < 2;

    var cardClass = 'lesson-card';
    if (isPast) cardClass += ' past';

    var html = '<div class="' + cardClass + '">' +
      '<div class="lesson-accent" style="background:' + ltColour + '"></div>' +
      '<div class="lesson-body">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<div class="lesson-time">' + start + ' — ' + end + '</div>';

    if (isCancelled) {
      html += '<span class="lesson-status status-cancelled">Cancelled</span>';
    } else if (isCompleted) {
      html += '<span class="lesson-status status-completed">Completed</span>';
    } else if (isAwaiting) {
      html += '<span class="lesson-status status-awaiting">Pending</span>';
    }

    html += '</div>' +
      '<div class="lesson-meta">' +
      '<span>' + esc(b.instructor_name) + '</span>';

    if (ltName) {
      html += '<span class="lesson-meta-dot"></span>' +
        '<span class="lesson-type-badge" style="background:color-mix(in srgb,' + ltColour + ' 15%,var(--white));color:' + ltColour + '">' + esc(ltName) + '</span>';
    }

    if (b.duration_minutes) {
      var hrs = b.duration_minutes / 60;
      var durStr = hrs % 1 === 0 ? hrs + 'hr' : hrs.toFixed(1) + 'hr';
      html += '<span class="lesson-meta-dot"></span><span>' + durStr + '</span>';
    }

    html += '</div>';

    if (addr) {
      html += '<div class="lesson-address">' + esc(addr) + '</div>';
    }

    if (canAct) {
      html += '<div class="lesson-actions">';
      html += '<button class="btn-lesson calendar" data-action="download-calendar" data-booking-id="' + b.id + '">Add to Calendar</button>';
      var rCount = b.reschedule_count || 0;
      if (canReschedule) {
        var rLabel = rCount === 0 ? 'Reschedule' : 'Reschedule (' + rCount + ' of 2 used)';
        html += '<button class="btn-lesson reschedule" data-action="open-reschedule-modal"' +
          ' data-booking-id="' + b.id + '"' +
          ' data-date="' + b.scheduled_date + '"' +
          ' data-start="' + start + '"' +
          ' data-end="' + end + '"' +
          ' data-instructor-name="' + esc(b.instructor_name) + '"' +
          ' data-instructor-id="' + b.instructor_id + '"' +
          (b.lesson_type_id ? ' data-lesson-type-id="' + b.lesson_type_id + '"' : '') +
          '>' + rLabel + '</button>';
      } else if (canAct && hoursUntil >= 48 && rCount >= 2) {
        html += '<span style="font-size:0.75rem;color:var(--muted);padding:4px 0">Reschedule limit reached</span>';
      }
      html += '<button class="btn-lesson cancel" data-action="open-cancel-modal"' +
        ' data-booking-id="' + b.id + '"' +
        ' data-date="' + b.scheduled_date + '"' +
        ' data-start="' + start + '"' +
        ' data-end="' + end + '"' +
        ' data-instructor-name="' + esc(b.instructor_name) + '"' +
        ' data-hours-until="' + hoursUntil.toFixed(1) + '"' +
        (b.series_id ? ' data-series-id="' + b.series_id + '"' : '') +
        '>Cancel</button>';
      html += '</div>';
    }

    if (isPast && isCompleted && b.instructor_id) {
      var rebookUrl = '/learner/book.html?instructor=' + b.instructor_id;
      if (b.lesson_type_id) rebookUrl += '&type_id=' + b.lesson_type_id;
      html += '<div class="lesson-actions">';
      html += '<button class="btn-lesson reschedule" data-action="rebook" data-url="' + rebookUrl + '">Book again</button>';
      html += '</div>';
    }

    html += '</div></div>';
    return html;
  }

  async function downloadCalendar(bookingId) {
    try {
      var res = await ccAuth.fetchAuthed('/api/calendar?action=download&booking_id=' + bookingId);
      if (!res.ok) throw new Error('Failed');
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'coachcarter-lesson.ics';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Calendar file downloaded', 'success');
    } catch (e) { showToast('Could not download calendar file', 'error'); }
  }

  function openCancelModal(bookingId, date, start, end, instructorName, hoursUntil, seriesId) {
    pendingCancel = { bookingId: bookingId, date: date, start: start, end: end, instructorName: instructorName, hoursUntil: hoursUntil, seriesId: seriesId || null };
    var dateDisplay = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    document.getElementById('cmDate').textContent = dateDisplay;
    document.getElementById('cmTime').textContent = start + ' — ' + end;
    document.getElementById('cmInstructor').textContent = instructorName;

    var willGet = hoursUntil >= 48;
    var policyEl = document.getElementById('cancelPolicyNote');
    policyEl.className = 'cancel-policy' + (willGet ? ' safe' : '');
    policyEl.innerHTML = willGet
      ? '&#x2713; You are cancelling more than 48 hours before the lesson. <strong>Your lesson will be returned automatically.</strong>'
      : '&#x26A0; This lesson is within 48 hours. <strong>Your lesson will be forfeited</strong> in line with the cancellation policy.';

    var ackLabel = document.getElementById('cancelAckLabel');
    var ackCheck = document.getElementById('cancelAckCheck');
    ackCheck.checked = false;
    ackLabel.style.display = willGet ? 'none' : 'flex';

    var seriesOption = document.getElementById('cancelSeriesOption');
    var seriesCheck = document.getElementById('cancelSeriesCheck');
    seriesCheck.checked = false;
    document.getElementById('cancelSeriesInfo').style.display = 'none';
    if (seriesId) {
      seriesOption.style.display = 'block';
      if (hoursUntil === 999) {
        seriesCheck.checked = true;
        toggleCancelSeriesInfo();
        policyEl.className = 'cancel-policy safe';
        policyEl.innerHTML = '&#x2713; Each lesson in the series will be assessed individually. Lessons 48+ hours away will be refunded.';
      }
    } else {
      seriesOption.style.display = 'none';
    }

    document.getElementById('cancelBtnLabel').textContent = seriesCheck.checked ? 'Cancel series' : 'Cancel lesson';
    document.getElementById('btnConfirmCancel').disabled = !willGet && !seriesCheck.checked;
    document.getElementById('cancelModal').classList.add('open');
  }

  function toggleCancelSeriesInfo() {
    var checked = document.getElementById('cancelSeriesCheck').checked;
    document.getElementById('cancelSeriesInfo').style.display = checked ? 'block' : 'none';
    document.getElementById('cancelBtnLabel').textContent = checked ? 'Cancel series' : 'Cancel lesson';
    if (checked) {
      document.getElementById('cancelSeriesInfo').textContent = 'All remaining lessons in this weekly series will be cancelled. Refunds apply per the 48-hour policy.';
      document.getElementById('btnConfirmCancel').disabled = false;
    }
  }

  function toggleCancelBtn() {
    var ackCheck = document.getElementById('cancelAckCheck');
    document.getElementById('btnConfirmCancel').disabled = !ackCheck.checked;
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    var btn = document.getElementById('btnConfirmCancel');
    var cancelSeries = document.getElementById('cancelSeriesCheck').checked && pendingCancel.seriesId;
    btn.disabled = true;
    document.getElementById('cancelBtnLabel').textContent = cancelSeries ? 'Cancelling series...' : 'Cancelling...';

    try {
      var body = { booking_id: pendingCancel.bookingId };
      if (cancelSeries) body.cancel_series = true;
      var res = await ccAuth.fetchAuthed('/api/slots?action=cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);

      document.getElementById('cancelModal').classList.remove('open');
      showToast(data.message, data.credit_returned !== false ? 'success' : '');
      loadBookings();
    } catch (err) {
      showToast(err.message || 'Cancellation failed.', 'error');
      btn.disabled = false;
      document.getElementById('cancelBtnLabel').textContent = cancelSeries ? 'Cancel series' : 'Cancel lesson';
    }
  }

  function openRescheduleModal(bookingId, date, start, end, instructorName, instructorId, lessonTypeId) {
    var dateStr = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    document.getElementById('rmCurrentDateTime').textContent = dateStr + ' at ' + start;
    document.getElementById('rmInstructor').textContent = instructorName;
    document.getElementById('btnGoReschedule').onclick = function () {
      var url = '/learner/book.html?reschedule=' + bookingId + '&instructor=' + instructorId;
      if (lessonTypeId) url += '&type_id=' + lessonTypeId;
      window.location.href = url;
    };
    document.getElementById('rescheduleModal').classList.add('open');
  }

  function closeRescheduleModal() {
    document.getElementById('rescheduleModal').classList.remove('open');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showToast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 4000);
  }

  init();
})();
