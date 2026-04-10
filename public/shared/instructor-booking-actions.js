/**
 * Shared Instructor Booking Action Modals
 * Used by: instructor/index.html, instructor/dashboard.html
 *
 * Provides: cancel (with reason), reschedule (with conflict check),
 *           add/book lesson (with learner search).
 *
 * Usage:
 *   BookingActions.init({ token, showToast, onRefresh })
 *   BookingActions.openCancel(booking)
 *   BookingActions.openReschedule(booking)
 *   BookingActions.openAddLesson({ defaultDate, token })
 */
(function () {
  'use strict';

  let _token = null;
  let _showToast = null;
  let _onRefresh = null;
  let _onCacheUpdate = null; // optional: (bookingId, field, value) for in-memory cache

  // ─── State ──────────────────────────────────────────────────────────────────
  let cancelBookingId = null;
  let rescheduleBooking = null;
  let addLessonLearners = [];
  let addLessonSelectedId = null;
  let addLessonSelectedCredits = 0;

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init(opts) {
    _token = opts.token;
    _showToast = opts.showToast || function () {};
    _onRefresh = opts.onRefresh || function () {};
    _onCacheUpdate = opts.onCacheUpdate || null;
    injectModals();
  }

  // ─── Inject modal HTML into the DOM ─────────────────────────────���───────────
  function injectModals() {
    if (document.getElementById('ba-cancel-modal')) return; // already injected
    const container = document.createElement('div');
    container.innerHTML = `
      <!-- Cancel Lesson Modal -->
      <div class="modal-overlay" id="ba-cancel-modal" onclick="if(event.target===this)BookingActions.closeCancel()">
        <div class="modal">
          <div class="modal-title">Cancel Lesson</div>
          <div class="modal-sub" id="ba-cancel-sub">This will cancel the lesson and notify the learner.</div>
          <div>
            <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Reason (optional — shared with the learner)</div>
            <textarea id="ba-cancel-reason" placeholder="e.g. Car in for service, feeling unwell…" style="width:100%;min-height:70px;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);resize:vertical;background:var(--white);color:var(--primary)"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" onclick="BookingActions.closeCancel()">Go back</button>
            <button class="btn-cancel-danger" id="ba-cancel-btn" onclick="BookingActions.confirmCancel()" style="background:var(--red);color:white">Cancel this lesson</button>
          </div>
        </div>
      </div>

      <!-- Reschedule Lesson Modal -->
      <div class="modal-overlay" id="ba-reschedule-modal" onclick="if(event.target===this)BookingActions.closeReschedule()">
        <div class="modal">
          <div class="modal-title">Reschedule Lesson</div>
          <div class="modal-sub">Move this lesson to a new date and time.</div>
          <div style="margin:16px 0">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:0.78rem;color:var(--muted)">Learner</span><span style="font-size:0.85rem;font-weight:600" id="ba-resch-learner">—</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:0.78rem;color:var(--muted)">Current</span><span style="font-size:0.85rem;text-decoration:line-through;color:var(--muted)" id="ba-resch-current">—</span></div>
            <div style="margin-top:16px">
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">New date</div>
              <input type="date" id="ba-resch-date" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;margin-bottom:8px;background:var(--white);color:var(--primary)">
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">New start time</div>
              <input type="time" id="ba-resch-time" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;background:var(--white);color:var(--primary)" step="1800">
              <div id="ba-resch-end" style="font-size:0.82rem;color:var(--muted);margin-top:6px"></div>
              <div id="ba-resch-conflict" style="font-size:0.82rem;color:var(--red);margin-top:6px;display:none"></div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" onclick="BookingActions.closeReschedule()">Cancel</button>
            <button class="btn-modal-save" id="ba-reschedule-btn" onclick="BookingActions.confirmReschedule()">Move lesson</button>
          </div>
        </div>
      </div>

      <!-- Add/Book Lesson Modal -->
      <div class="modal-overlay" id="ba-add-modal" onclick="if(event.target===this)BookingActions.closeAdd()">
        <div class="modal" style="max-width:420px">
          <div class="modal-title">Book Lesson</div>
          <div class="modal-sub">Book a lesson on behalf of a learner.</div>
          <div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Learner</div>
              <div style="position:relative">
                <input type="text" id="ba-add-search" placeholder="Search by name, email or phone…" oninput="BookingActions._filterLearners()" onfocus="document.getElementById('ba-add-dropdown').classList.add('open')" autocomplete="off" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);background:var(--white);color:var(--primary)">
                <div id="ba-add-dropdown" style="position:absolute;top:100%;left:0;right:0;background:var(--white);border:1px solid var(--border);border-radius:8px;max-height:200px;overflow-y:auto;z-index:10;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>
              </div>
              <div id="ba-add-selected" style="display:none;margin-top:8px;padding:8px 12px;background:var(--surface);border-radius:8px;display:none;align-items:center;justify-content:space-between">
                <div><span id="ba-add-sel-name" style="font-weight:600"></span> <span id="ba-add-sel-detail" style="color:var(--muted);font-size:0.82rem;margin-left:4px"></span></div>
                <button onclick="BookingActions._clearLearner()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:0.9rem">&#x2715;</button>
              </div>
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Date</div>
              <input type="date" id="ba-add-date" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;background:var(--white);color:var(--primary)">
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Start time</div>
              <input type="time" id="ba-add-time" step="1800" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;background:var(--white);color:var(--primary)">
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Lesson type</div>
              <select id="ba-add-type" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);background:var(--white);color:var(--primary)"></select>
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Payment</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer"><input type="radio" name="ba-add-pay" value="cash" checked><span>Cash</span></label>
                <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer"><input type="radio" name="ba-add-pay" value="credit"><span>Deduct credit</span></label>
                <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer"><input type="radio" name="ba-add-pay" value="free"><span>Free</span></label>
              </div>
              <div id="ba-add-credit-note" style="display:none;font-size:0.78rem;color:var(--muted);margin-top:4px"></div>
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Drop-off (optional)</div>
              <input type="text" id="ba-add-dropoff" placeholder="e.g. School, work, test centre…" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);background:var(--white);color:var(--primary)">
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Notes (optional)</div>
              <textarea id="ba-add-notes" rows="2" placeholder="e.g. Test prep, phone booking…" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);resize:vertical;background:var(--white);color:var(--primary)"></textarea>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" onclick="BookingActions.closeAdd()">Cancel</button>
            <button class="btn-modal-save" id="ba-add-btn" onclick="BookingActions.confirmAdd()">Book lesson</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      const dd = document.getElementById('ba-add-dropdown');
      if (dd && !dd.contains(e.target) && e.target.id !== 'ba-add-search') {
        dd.classList.remove('open');
        dd.style.display = 'none';
      }
    });

    // Reschedule: show end time and check conflicts on date/time change
    const rDate = document.getElementById('ba-resch-date');
    const rTime = document.getElementById('ba-resch-time');
    if (rDate) rDate.addEventListener('change', _checkRescheduleConflict);
    if (rTime) rTime.addEventListener('change', _checkRescheduleConflict);
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────────
  function openCancel(booking) {
    cancelBookingId = booking.id;
    const sub = document.getElementById('ba-cancel-sub');
    sub.textContent = 'Cancel lesson with ' + (booking.learner_name || 'this learner') + '? This will notify them.';
    document.getElementById('ba-cancel-reason').value = '';
    document.getElementById('ba-cancel-btn').disabled = false;
    document.getElementById('ba-cancel-btn').textContent = 'Cancel this lesson';
    document.getElementById('ba-cancel-modal').classList.add('open');
  }

  function closeCancel() {
    document.getElementById('ba-cancel-modal').classList.remove('open');
    cancelBookingId = null;
  }

  async function confirmCancel() {
    if (!cancelBookingId) return;
    const btn = document.getElementById('ba-cancel-btn');
    const reason = document.getElementById('ba-cancel-reason').value.trim();
    btn.disabled = true;
    btn.textContent = 'Cancelling…';
    try {
      const body = { booking_id: cancelBookingId };
      if (reason) body.reason = reason;
      const res = await ccAuth.fetchAuthed('/api/instructor?action=cancel-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel');
      if (_onCacheUpdate) _onCacheUpdate(cancelBookingId, 'status', 'cancelled');
      closeCancel();
      _showToast('Lesson cancelled — learner notified', 'success');
      _onRefresh();
    } catch (err) {
      _showToast(err.message || 'Failed to cancel lesson', 'error');
      btn.disabled = false;
      btn.textContent = 'Cancel this lesson';
    }
  }

  // ─── Reschedule ─────────────────────────────────────────────────────────────
  function openReschedule(booking) {
    rescheduleBooking = booking;
    document.getElementById('ba-resch-learner').textContent = booking.learner_name || '—';
    const dateStr = new Date(booking.scheduled_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    document.getElementById('ba-resch-current').textContent = dateStr + ' ' + (booking.start_time || '').slice(0, 5) + '–' + (booking.end_time || '').slice(0, 5);

    // Pre-fill new date to tomorrow, time to current
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('ba-resch-date').value = tomorrow.toISOString().slice(0, 10);
    document.getElementById('ba-resch-date').min = new Date().toISOString().slice(0, 10);
    document.getElementById('ba-resch-time').value = (booking.start_time || '09:00').slice(0, 5);

    document.getElementById('ba-resch-end').textContent = '';
    document.getElementById('ba-resch-conflict').style.display = 'none';
    document.getElementById('ba-reschedule-btn').disabled = false;
    document.getElementById('ba-reschedule-btn').textContent = 'Move lesson';
    document.getElementById('ba-reschedule-modal').classList.add('open');
    _checkRescheduleConflict();
  }

  function closeReschedule() {
    document.getElementById('ba-reschedule-modal').classList.remove('open');
    rescheduleBooking = null;
  }

  async function _checkRescheduleConflict() {
    if (!rescheduleBooking) return;
    const newDate = document.getElementById('ba-resch-date').value;
    const newTime = document.getElementById('ba-resch-time').value;
    const endEl = document.getElementById('ba-resch-end');
    const conflictEl = document.getElementById('ba-resch-conflict');
    const btn = document.getElementById('ba-reschedule-btn');

    if (!newDate || !newTime) { endEl.textContent = ''; conflictEl.style.display = 'none'; return; }

    // Calculate and show end time
    const durMins = rescheduleBooking.duration_minutes || 60;
    const [h, m] = newTime.split(':').map(Number);
    const endMins = h * 60 + m + durMins;
    const endStr = String(Math.floor(endMins / 60)).padStart(2, '0') + ':' + String(endMins % 60).padStart(2, '0');
    endEl.textContent = 'New time: ' + newTime + ' – ' + endStr;

    // Check conflicts
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=schedule&start=' + newDate + '&end=' + newDate);
      const data = await res.json();
      const bookings = data.bookings || [];
      const conflict = bookings.find(function (b) {
        if (b.id === rescheduleBooking.id) return false;
        if (b.status === 'cancelled') return false;
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return newTime < bEnd && endStr > bStart;
      });
      if (conflict) {
        conflictEl.textContent = 'Conflicts with ' + (conflict.learner_name || 'a lesson') + ' at ' + conflict.start_time.slice(0, 5) + '–' + conflict.end_time.slice(0, 5);
        conflictEl.style.display = 'block';
        btn.disabled = true;
      } else {
        conflictEl.style.display = 'none';
        btn.disabled = false;
      }
    } catch (e) {
      // Silently fail conflict check — don't block reschedule
      conflictEl.style.display = 'none';
      btn.disabled = false;
    }
  }

  async function confirmReschedule() {
    if (!rescheduleBooking) return;
    const newDate = document.getElementById('ba-resch-date').value;
    const newTime = document.getElementById('ba-resch-time').value;
    if (!newDate || !newTime) { _showToast('Please select a date and time', 'error'); return; }

    const btn = document.getElementById('ba-reschedule-btn');
    btn.disabled = true;
    btn.textContent = 'Moving…';
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=reschedule-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: rescheduleBooking.id, new_date: newDate, new_start_time: newTime })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reschedule');
      if (_onCacheUpdate) _onCacheUpdate(rescheduleBooking.id, 'status', 'rescheduled');
      closeReschedule();
      _showToast('Lesson rescheduled — learner notified', 'success');
      _onRefresh();
    } catch (err) {
      _showToast(err.message || 'Failed to reschedule', 'error');
      btn.disabled = false;
      btn.textContent = 'Move lesson';
    }
  }

  // ─── Add/Book Lesson ────────────────────────────────────────────────────────
  async function openAdd(opts) {
    opts = opts || {};
    addLessonSelectedId = null;
    addLessonSelectedCredits = 0;
    document.getElementById('ba-add-search').value = '';
    document.getElementById('ba-add-selected').style.display = 'none';
    document.getElementById('ba-add-notes').value = '';
    document.getElementById('ba-add-dropoff').value = '';
    document.getElementById('ba-add-credit-note').style.display = 'none';
    document.getElementById('ba-add-btn').disabled = false;
    document.getElementById('ba-add-btn').textContent = 'Book lesson';
    document.querySelector('input[name="ba-add-pay"][value="cash"]').checked = true;

    // Default date and time
    const d = opts.defaultDate || new Date();
    const dateVal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    document.getElementById('ba-add-date').value = dateVal;
    document.getElementById('ba-add-date').min = new Date().toISOString().slice(0, 10);

    // Next half-hour
    const now = new Date();
    const mins = now.getMinutes();
    now.setMinutes(mins < 30 ? 30 : 0);
    if (mins >= 30) now.setHours(now.getHours() + 1);
    document.getElementById('ba-add-time').value = now.toTimeString().slice(0, 5);

    // Fetch learners + lesson types
    try {
      const [lRes, tRes] = await Promise.all([
        ccAuth.fetchAuthed('/api/instructor?action=my-learners'),
        ccAuth.fetchAuthed('/api/lesson-types?action=list')
      ]);
      const lData = await lRes.json();
      const tData = await tRes.json();
      addLessonLearners = Array.isArray(lData) ? lData : (lData.learners || []);
      const types = tData.lesson_types || [];
      const sel = document.getElementById('ba-add-type');
      sel.innerHTML = types.map(function (lt) {
        var hrs = lt.duration_minutes / 60;
        var hrsStr = hrs % 1 === 0 ? hrs + 'hr' : hrs.toFixed(1) + 'hrs';
        return '<option value="' + lt.id + '">' + _esc(lt.name) + ' (' + hrsStr + ')</option>';
      }).join('');
    } catch (e) {
      _showToast('Failed to load data', 'error');
    }

    document.getElementById('ba-add-modal').classList.add('open');
    _filterLearners();
  }

  function closeAdd() {
    document.getElementById('ba-add-modal').classList.remove('open');
  }

  function _filterLearners() {
    const q = (document.getElementById('ba-add-search').value || '').toLowerCase();
    const dd = document.getElementById('ba-add-dropdown');
    if (!q || q.length < 1) { dd.style.display = 'none'; return; }
    dd.style.display = 'block';
    dd.classList.add('open');
    var matches = addLessonLearners.filter(function (l) {
      var name = ((l.first_name || '') + ' ' + (l.last_name || '')).toLowerCase();
      return name.includes(q) || (l.email || '').toLowerCase().includes(q) || (l.phone || '').includes(q);
    }).slice(0, 20);

    if (matches.length === 0) {
      dd.innerHTML = '<div style="padding:10px;font-size:0.82rem;color:var(--muted)">No learners found</div>';
      return;
    }
    dd.innerHTML = matches.map(function (l) {
      var name = (l.first_name || '') + ' ' + (l.last_name || '');
      var detail = l.email || l.phone || '';
      var credits = l.credit_balance_pence || 0;
      return '<div style="padding:8px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--border)" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\'" onclick="BookingActions._selectLearner(' + l.id + ',\'' + _esc(name).replace(/'/g, "\\'") + '\',\'' + _esc(detail).replace(/'/g, "\\'") + '\',' + credits + ')">' +
        '<div style="font-weight:600">' + _esc(name) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--muted)">' + _esc(detail) + '</div></div>';
    }).join('');
  }

  function _selectLearner(id, name, detail, credits) {
    addLessonSelectedId = id;
    addLessonSelectedCredits = credits;
    document.getElementById('ba-add-search').value = '';
    document.getElementById('ba-add-dropdown').style.display = 'none';
    document.getElementById('ba-add-selected').style.display = 'flex';
    document.getElementById('ba-add-sel-name').textContent = name;
    document.getElementById('ba-add-sel-detail').textContent = detail;
    _updateCreditNote();
  }

  function _clearLearner() {
    addLessonSelectedId = null;
    addLessonSelectedCredits = 0;
    document.getElementById('ba-add-selected').style.display = 'none';
    document.getElementById('ba-add-search').value = '';
    document.getElementById('ba-add-credit-note').style.display = 'none';
  }

  function _updateCreditNote() {
    const pay = document.querySelector('input[name="ba-add-pay"]:checked')?.value;
    const note = document.getElementById('ba-add-credit-note');
    if (pay === 'credit' && addLessonSelectedId) {
      var bal = (addLessonSelectedCredits / 100).toFixed(2);
      note.textContent = 'Credit balance: £' + bal;
      note.style.display = 'block';
    } else {
      note.style.display = 'none';
    }
  }

  async function confirmAdd() {
    if (!addLessonSelectedId) { _showToast('Please select a learner', 'error'); return; }
    const date = document.getElementById('ba-add-date').value;
    const time = document.getElementById('ba-add-time').value;
    if (!date || !time) { _showToast('Please select a date and time', 'error'); return; }

    const btn = document.getElementById('ba-add-btn');
    btn.disabled = true;
    btn.textContent = 'Booking…';

    const pay = document.querySelector('input[name="ba-add-pay"]:checked')?.value || 'cash';
    const typeId = document.getElementById('ba-add-type').value;
    const notes = document.getElementById('ba-add-notes').value.trim();
    const dropoff = document.getElementById('ba-add-dropoff').value.trim();

    try {
      const body = {
        learner_id: addLessonSelectedId,
        scheduled_date: date,
        start_time: time,
        payment_method: pay
      };
      if (typeId) body.lesson_type_id = parseInt(typeId);
      if (notes) body.notes = notes;
      if (dropoff) body.dropoff_address = dropoff;

      const res = await ccAuth.fetchAuthed('/api/instructor?action=create-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to book');
      var learnerName = document.getElementById('ba-add-sel-name').textContent;
      closeAdd();
      _showToast('Lesson booked for ' + learnerName + ' — they\'ve been notified', 'success');
      _onRefresh();
    } catch (err) {
      _showToast(err.message || 'Failed to book lesson', 'error');
      btn.disabled = false;
      btn.textContent = 'Book lesson';
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  window.BookingActions = {
    init: init,
    openCancel: openCancel,
    closeCancel: closeCancel,
    confirmCancel: confirmCancel,
    openReschedule: openReschedule,
    closeReschedule: closeReschedule,
    confirmReschedule: confirmReschedule,
    openAdd: openAdd,
    closeAdd: closeAdd,
    confirmAdd: confirmAdd,
    _filterLearners: _filterLearners,
    _selectLearner: _selectLearner,
    _clearLearner: _clearLearner
  };

  // Update credit note when payment option changes
  document.addEventListener('change', function (e) {
    if (e.target.name === 'ba-add-pay') _updateCreditNote();
  });
})();
