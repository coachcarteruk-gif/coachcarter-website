/**
 * Shared Instructor Booking Action Modals
 * Used by: instructor/index.html, instructor/dashboard.html
 *
 * Provides: cancel (with reason), reschedule (with conflict check),
 *           add/book lesson (with learner search).
 *
 * Usage:
 *   BookingActions.init({ showToast, onRefresh, onCacheUpdate })
 *   BookingActions.openCancel(booking)
 *   BookingActions.openReschedule(booking)
 *   BookingActions.openAddLesson({ defaultDate })
 *
 * All API calls ride on the cc_instructor httpOnly cookie via
 * ccAuth.fetchAuthed() - no token needs to be passed in.
 */
(function () {
  'use strict';

  let _showToast = null;
  let _onRefresh = null;
  let _onCacheUpdate = null; // optional: (bookingId, field, value) for in-memory cache

  // ─── State ──────────────────────────────────────────────────────────────────
  let cancelBookingId = null;
  let notDeliveredBooking = null;
  let rescheduleBooking = null;
  let rescheduleValidationSeq = 0;
  let addLessonLearners = [];
  let addLessonSelectedId = null;
  let addLessonSelectedBalanceMinutes = 0;

  function formatBalanceMins(mins) {
    var m = Number(mins || 0);
    var h = Math.floor(m / 60);
    var rem = m % 60;
    return rem ? h + 'h ' + rem + 'm' : h + 'h';
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  function init(opts) {
    opts = opts || {};
    _showToast = opts.showToast || function () {};
    _onRefresh = opts.onRefresh || function () {};
    _onCacheUpdate = opts.onCacheUpdate || null;
    injectModals();
  }

  // ─── Inject modal HTML into the DOM ───────────────────────────────────────────
  function injectModals() {
    if (document.getElementById('ba-cancel-modal')) return; // already injected
    const container = document.createElement('div');
    container.innerHTML = `
      <!-- Cancel Lesson Modal -->
      <div class="modal-overlay" id="ba-cancel-modal">
        <div class="modal">
          <div class="modal-title">Cancel Lesson</div>
          <div class="modal-sub" id="ba-cancel-sub">This will cancel the lesson and notify the learner.</div>
          <div>
            <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Reason (optional - shared with the learner)</div>
            <textarea id="ba-cancel-reason" placeholder="e.g. Car in for service, feeling unwell…" style="width:100%;min-height:70px;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);resize:vertical;background:var(--white);color:var(--primary)"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" id="ba-cancel-goback">Go back</button>
            <button class="btn-cancel-danger" id="ba-cancel-btn" style="background:var(--red);color:white">Cancel this lesson</button>
          </div>
        </div>
      </div>

      <!-- Not Delivered Modal -->
      <div class="modal-overlay" id="ba-not-delivered-modal">
        <div class="modal">
          <div class="modal-title">Report Lesson Issue</div>
          <div class="modal-sub" id="ba-not-delivered-sub">Use this only when a past lesson stayed on your calendar but did not happen.</div>
          <div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Reason</div>
              <select id="ba-not-delivered-reason" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);background:var(--white);color:var(--primary)">
                <option value="instructor_cancelled_privately">I cancelled privately</option>
                <option value="rearranged_privately">We rearranged privately</option>
                <option value="weather_or_vehicle">Weather or vehicle issue</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Note (optional)</div>
              <textarea id="ba-not-delivered-note" placeholder="Short internal note..." style="width:100%;min-height:70px;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);resize:vertical;background:var(--white);color:var(--primary)"></textarea>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer">
              <input type="checkbox" id="ba-not-delivered-notify" checked>
              Notify learner and return lesson credit
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" id="ba-not-delivered-goback">Go back</button>
            <button class="btn-cancel-danger" id="ba-not-delivered-btn" style="background:var(--red);color:white">Mark as not delivered</button>
          </div>
        </div>
      </div>

      <!-- Reschedule Lesson Modal -->
      <div class="modal-overlay" id="ba-reschedule-modal">
        <div class="modal">
          <div class="modal-title">Reschedule Lesson</div>
          <div class="modal-sub">Move this lesson to a new date and time.</div>
          <div style="margin:16px 0">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:0.78rem;color:var(--muted)">Learner</span><span style="font-size:0.85rem;font-weight:600" id="ba-resch-learner"> - </span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:0.78rem;color:var(--muted)">Current</span><span style="font-size:0.85rem;text-decoration:line-through;color:var(--muted)" id="ba-resch-current"> - </span></div>
            <div style="margin-top:16px">
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Instructor</div>
              <select id="ba-resch-instructor" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);margin-bottom:8px;background:var(--white);color:var(--primary)" disabled>
                <option>Loading instructors...</option>
              </select>
              <div id="ba-resch-transfer-note" style="font-size:0.78rem;color:var(--muted);margin:-2px 0 10px"></div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">New date</div>
              <input type="date" id="ba-resch-date" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;margin-bottom:8px;background:var(--white);color:var(--primary)">
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">New start time</div>
              <input type="time" id="ba-resch-time" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:16px;background:var(--white);color:var(--primary)" step="1800">
              <div id="ba-resch-end" style="font-size:0.82rem;color:var(--muted);margin-top:6px"></div>
              <div id="ba-resch-conflict" style="font-size:0.82rem;color:var(--red);margin-top:6px;display:none"></div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" id="ba-resch-cancel">Cancel</button>
            <button class="btn-modal-save" id="ba-reschedule-btn">Move lesson</button>
          </div>
        </div>
      </div>

      <!-- Add/Book Lesson Modal -->
      <div class="modal-overlay" id="ba-add-modal">
        <div class="modal" style="max-width:420px">
          <div class="modal-title">Book Lesson</div>
          <div class="modal-sub">Book a lesson on behalf of a learner.</div>
          <div style="margin:16px 0;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px">Learner</div>
              <div style="position:relative">
                <input type="text" id="ba-add-search" placeholder="Search by name, email or phone…" autocomplete="off" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-family:var(--font-body);background:var(--white);color:var(--primary)">
                <div id="ba-add-dropdown" style="position:absolute;top:100%;left:0;right:0;background:var(--white);border:1px solid var(--border);border-radius:8px;max-height:200px;overflow-y:auto;z-index:10;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>
              </div>
              <div id="ba-add-selected" style="display:none;margin-top:8px;padding:8px 12px;background:var(--surface);border-radius:8px;display:none;align-items:center;justify-content:space-between">
                <div><span id="ba-add-sel-name" style="font-weight:600"></span> <span id="ba-add-sel-detail" style="color:var(--muted);font-size:0.82rem;margin-left:4px"></span></div>
                <button id="ba-add-clear-sel" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:0.9rem">&#x2715;</button>
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
                <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer"><input type="radio" name="ba-add-pay" value="flexible_package"><span>Flexible package</span></label>
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
            <button class="btn-modal-cancel" id="ba-add-cancel">Cancel</button>
            <button class="btn-modal-save" id="ba-add-btn">Book lesson</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Wire up modal-overlay click-to-close (previously inline onclick)
    var cancelModal = document.getElementById('ba-cancel-modal');
    if (cancelModal) cancelModal.addEventListener('click', function (e) { if (e.target === cancelModal) closeCancel(); });
    var notDeliveredModal = document.getElementById('ba-not-delivered-modal');
    if (notDeliveredModal) notDeliveredModal.addEventListener('click', function (e) { if (e.target === notDeliveredModal) closeNotDelivered(); });
    var reschModal = document.getElementById('ba-reschedule-modal');
    if (reschModal) reschModal.addEventListener('click', function (e) { if (e.target === reschModal) closeReschedule(); });
    var addModal = document.getElementById('ba-add-modal');
    if (addModal) addModal.addEventListener('click', function (e) { if (e.target === addModal) closeAdd(); });

    // Wire up action buttons (previously inline onclick → BookingActions.X)
    var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('ba-cancel-goback', closeCancel);
    bind('ba-cancel-btn', confirmCancel);
    bind('ba-not-delivered-goback', closeNotDelivered);
    bind('ba-not-delivered-btn', confirmNotDelivered);
    bind('ba-resch-cancel', closeReschedule);
    bind('ba-reschedule-btn', confirmReschedule);
    bind('ba-add-cancel', closeAdd);
    bind('ba-add-btn', confirmAdd);
    bind('ba-add-clear-sel', _clearLearner);

    // Learner search input: oninput → filterLearners, onfocus → show dropdown
    var searchInput = document.getElementById('ba-add-search');
    if (searchInput) {
      searchInput.addEventListener('input', _filterLearners);
      searchInput.addEventListener('focus', function () {
        document.getElementById('ba-add-dropdown').classList.add('open');
      });
    }

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
    const rInstructor = document.getElementById('ba-resch-instructor');
    if (rDate) rDate.addEventListener('change', _checkRescheduleConflict);
    if (rTime) rTime.addEventListener('change', _checkRescheduleConflict);
    if (rInstructor) rInstructor.addEventListener('change', _checkRescheduleConflict);
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
      if (_onCacheUpdate) _onCacheUpdate(cancelBookingId, 'status', 'refunded');
      closeCancel();
      _showToast('Lesson cancelled - learner notified', 'success');
      _onRefresh();
    } catch (err) {
      _showToast(err.message || 'Failed to cancel lesson', 'error');
      btn.disabled = false;
      btn.textContent = 'Cancel this lesson';
    }
  }

  // ─── Reschedule ─────────────────────────────────────────────────────────────
  function openNotDelivered(booking) {
    notDeliveredBooking = booking || null;
    if (!notDeliveredBooking) return;
    const sub = document.getElementById('ba-not-delivered-sub');
    sub.textContent = 'Mark lesson with ' + (booking.learner_name || 'this learner') + ' as not delivered? The lesson credit will be returned and this lesson will be excluded from payout.';
    document.getElementById('ba-not-delivered-reason').value = 'instructor_cancelled_privately';
    document.getElementById('ba-not-delivered-note').value = '';
    document.getElementById('ba-not-delivered-notify').checked = true;
    document.getElementById('ba-not-delivered-btn').disabled = false;
    document.getElementById('ba-not-delivered-btn').textContent = 'Mark as not delivered';
    document.getElementById('ba-not-delivered-modal').classList.add('open');
  }

  function closeNotDelivered() {
    document.getElementById('ba-not-delivered-modal').classList.remove('open');
    notDeliveredBooking = null;
  }

  async function confirmNotDelivered() {
    if (!notDeliveredBooking) return;
    const btn = document.getElementById('ba-not-delivered-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const body = {
        booking_id: notDeliveredBooking.id,
        reason_code: document.getElementById('ba-not-delivered-reason').value,
        note: document.getElementById('ba-not-delivered-note').value.trim() || null,
        notify: !!document.getElementById('ba-not-delivered-notify').checked
      };
      const res = await ccAuth.fetchAuthed('/api/instructor?action=mark-not-delivered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to report lesson issue');
      if (_onCacheUpdate) _onCacheUpdate(notDeliveredBooking.id, 'status', 'refunded');
      closeNotDelivered();
      _showToast('Lesson marked as not delivered - credit returned and payout blocked', 'success');
      _onRefresh();
    } catch (err) {
      _showToast(err.message || 'Failed to report lesson issue', 'error');
      btn.disabled = false;
      btn.textContent = 'Mark as not delivered';
    }
  }

  function openReschedule(booking) {
    rescheduleBooking = booking;
    rescheduleValidationSeq += 1;
    document.getElementById('ba-resch-learner').textContent = booking.learner_name || ' - ';
    const dateStr = new Date(booking.scheduled_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    document.getElementById('ba-resch-current').textContent = dateStr + ' ' + (booking.start_time || '').slice(0, 5) + '–' + (booking.end_time || '').slice(0, 5);

    // Pre-fill new date to tomorrow, time to current
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('ba-resch-date').value = tomorrow.toISOString().slice(0, 10);
    document.getElementById('ba-resch-date').min = new Date().toISOString().slice(0, 10);
    document.getElementById('ba-resch-time').value = (booking.start_time || '09:00').slice(0, 5);

    document.getElementById('ba-resch-end').textContent = '';
    document.getElementById('ba-resch-conflict').textContent = 'Loading eligible instructors...';
    document.getElementById('ba-resch-conflict').style.display = 'block';
    document.getElementById('ba-resch-transfer-note').textContent = 'The learner keeps the same payment or credit entitlement and will not be charged again.';
    const instructorSelect = document.getElementById('ba-resch-instructor');
    instructorSelect.disabled = true;
    instructorSelect.innerHTML = '<option>Loading instructors...</option>';
    document.getElementById('ba-reschedule-btn').disabled = true;
    document.getElementById('ba-reschedule-btn').textContent = 'Move lesson';
    document.getElementById('ba-reschedule-modal').classList.add('open');
    _loadRescheduleInstructors();
  }

  async function _loadRescheduleInstructors() {
    if (!rescheduleBooking) return;
    const bookingId = rescheduleBooking.id;
    const select = document.getElementById('ba-resch-instructor');
    const conflictEl = document.getElementById('ba-resch-conflict');
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=reschedule-options&booking_id=' + encodeURIComponent(bookingId));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load instructors');
      if (!rescheduleBooking || rescheduleBooking.id !== bookingId) return;

      select.innerHTML = '';
      (data.instructors || []).forEach(function (candidate) {
        const option = document.createElement('option');
        option.value = String(candidate.id);
        option.textContent = candidate.name;
        select.appendChild(option);
      });
      if (!select.options.length) throw new Error('No eligible instructors are available for this lesson type and transmission.');

      rescheduleBooking.currentInstructorId = Number(data.current_instructor_id);
      select.value = String(data.current_instructor_id);
      if (!select.value) throw new Error('The current instructor is no longer active.');
      select.disabled = !!data.is_reserved_weekly_slot;
      if (data.is_reserved_weekly_slot) {
        document.getElementById('ba-resch-transfer-note').textContent = 'Reserved Weekly Slot lessons stay with their current instructor under the existing move policy.';
      }
      await _checkRescheduleConflict();
    } catch (err) {
      if (!rescheduleBooking || rescheduleBooking.id !== bookingId) return;
      select.disabled = true;
      conflictEl.textContent = err.message || 'Failed to load instructors';
      conflictEl.style.display = 'block';
      document.getElementById('ba-reschedule-btn').disabled = true;
    }
  }

  function closeReschedule() {
    rescheduleValidationSeq += 1;
    document.getElementById('ba-reschedule-modal').classList.remove('open');
    rescheduleBooking = null;
  }

  async function _checkRescheduleConflict() {
    if (!rescheduleBooking) return;
    const bookingId = rescheduleBooking.id;
    const newDate = document.getElementById('ba-resch-date').value;
    const newTime = document.getElementById('ba-resch-time').value;
    const instructorId = Number(document.getElementById('ba-resch-instructor').value);
    const endEl = document.getElementById('ba-resch-end');
    const conflictEl = document.getElementById('ba-resch-conflict');
    const btn = document.getElementById('ba-reschedule-btn');
    const note = document.getElementById('ba-resch-transfer-note');
    const sequence = ++rescheduleValidationSeq;

    btn.disabled = true;
    if (!newDate || !newTime || !Number.isInteger(instructorId) || instructorId <= 0) {
      endEl.textContent = '';
      conflictEl.textContent = 'Choose an instructor, date, and time.';
      conflictEl.style.display = 'block';
      return;
    }

    conflictEl.textContent = 'Checking availability...';
    conflictEl.style.color = 'var(--muted)';
    conflictEl.style.display = 'block';
    try {
      const query = new URLSearchParams({
        action: 'reschedule-availability',
        booking_id: String(bookingId),
        new_instructor_id: String(instructorId),
        new_date: newDate,
        new_start_time: newTime
      });
      const res = await ccAuth.fetchAuthed('/api/instructor?' + query.toString());
      const data = await res.json();
      if (sequence !== rescheduleValidationSeq || !rescheduleBooking || rescheduleBooking.id !== bookingId) return;
      if (!res.ok || !data.available) throw new Error(data.error || 'That slot is not available.');

      endEl.textContent = 'New time: ' + newTime + ' - ' + String(data.new_end_time || '').slice(0, 5);
      conflictEl.textContent = 'Available - this will be checked again when you confirm.';
      conflictEl.style.color = 'var(--green, #218739)';
      btn.disabled = false;
      const changed = instructorId !== Number(rescheduleBooking.currentInstructorId);
      note.textContent = changed
        ? 'The learner will not be charged again. Their entitlement and the eventual payout will move to ' + data.instructor.name + '.'
        : 'The learner keeps the same payment or credit entitlement and will not be charged again.';
    } catch (err) {
      if (sequence !== rescheduleValidationSeq || !rescheduleBooking || rescheduleBooking.id !== bookingId) return;
      endEl.textContent = '';
      conflictEl.textContent = err.message || 'Could not verify that slot.';
      conflictEl.style.color = 'var(--red)';
      conflictEl.style.display = 'block';
      btn.disabled = true;
    }
  }

  async function confirmReschedule() {
    if (!rescheduleBooking) return;
    const newDate = document.getElementById('ba-resch-date').value;
    const newTime = document.getElementById('ba-resch-time').value;
    const newInstructorId = Number(document.getElementById('ba-resch-instructor').value);
    if (!newDate || !newTime || !Number.isInteger(newInstructorId)) { _showToast('Please select an instructor, date and time', 'error'); return; }

    const btn = document.getElementById('ba-reschedule-btn');
    btn.disabled = true;
    btn.textContent = 'Moving…';
    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=reschedule-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: rescheduleBooking.id, new_date: newDate, new_start_time: newTime, new_instructor_id: newInstructorId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reschedule');
      if (_onCacheUpdate) _onCacheUpdate(rescheduleBooking.id, 'status', 'refunded');
      closeReschedule();
      _showToast(data.message || 'Lesson rescheduled - learner notified', 'success');
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
    addLessonSelectedBalanceMinutes = 0;
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
        ccAuth.fetchAuthed('/api/instructor?action=school-learners'),
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
      var name = (l.name || '').toLowerCase();
      return name.includes(q) || (l.email || '').toLowerCase().includes(q) || (l.phone || '').includes(q);
    });
    // "Your learner" first, then alphabetical within each group
    matches.sort(function (a, b) {
      if (!!a.is_your_learner !== !!b.is_your_learner) return a.is_your_learner ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    matches = matches.slice(0, 20);

    if (matches.length === 0) {
      dd.innerHTML = '<div style="padding:10px;font-size:0.82rem;color:var(--muted)">No learners found</div>';
      return;
    }
    dd.innerHTML = matches.map(function (l) {
      var name = l.name || '';
      var detail = l.email || l.phone || '';
      var balanceMinutes = l.balance_minutes || 0;
      var tag = l.is_your_learner
        ? '<span style="font-size:0.7rem;font-weight:600;color:var(--green,#1f8a4c);background:rgba(31,138,76,0.1);padding:1px 6px;border-radius:4px;margin-left:6px">Your learner</span>'
        : '<span style="font-size:0.7rem;font-weight:600;color:var(--muted);background:var(--surface);padding:1px 6px;border-radius:4px;margin-left:6px">New to you</span>';
      return '<div class="ba-learner-row" data-id="' + l.id + '" data-name="' + _esc(name) + '" data-detail="' + _esc(detail) + '" data-balance-minutes="' + balanceMinutes + '" style="padding:8px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--border)">' +
        '<div style="font-weight:600">' + _esc(name) + tag + '</div>' +
        '<div style="font-size:0.78rem;color:var(--muted)">' + _esc(detail) + ' · ' + formatBalanceMins(balanceMinutes) + ' with this instructor</div></div>';
    }).join('');

    // Wire up per-row click + hover (previously inline onclick / onmouseover / onmouseout)
    var rows = dd.querySelectorAll('.ba-learner-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        row.addEventListener('click', function () {
          _selectLearner(
            parseInt(row.dataset.id, 10),
            row.dataset.name,
            row.dataset.detail,
            parseInt(row.dataset.balanceMinutes, 10)
          );
        });
        row.addEventListener('mouseover', function () { row.style.background = 'var(--surface)'; });
        row.addEventListener('mouseout', function () { row.style.background = ''; });
      })(rows[i]);
    }
  }

  function _selectLearner(id, name, detail, balanceMinutes) {
    addLessonSelectedId = id;
    addLessonSelectedBalanceMinutes = balanceMinutes;
    document.getElementById('ba-add-search').value = '';
    document.getElementById('ba-add-dropdown').style.display = 'none';
    document.getElementById('ba-add-selected').style.display = 'flex';
    document.getElementById('ba-add-sel-name').textContent = name;
    document.getElementById('ba-add-sel-detail').textContent = detail;
    _updateCreditNote();
  }

  function _clearLearner() {
    addLessonSelectedId = null;
    addLessonSelectedBalanceMinutes = 0;
    document.getElementById('ba-add-selected').style.display = 'none';
    document.getElementById('ba-add-search').value = '';
    document.getElementById('ba-add-credit-note').style.display = 'none';
  }

  function _updateCreditNote() {
    const pay = document.querySelector('input[name="ba-add-pay"]:checked')?.value;
    const note = document.getElementById('ba-add-credit-note');
    if (pay === 'credit' && addLessonSelectedId) {
      note.textContent = 'Hours with this instructor: ' + formatBalanceMins(addLessonSelectedBalanceMinutes);
      note.style.display = 'block';
    } else if (pay === 'flexible_package' && addLessonSelectedId) {
      note.textContent = 'Use learner flexible package credits.';
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
      _showToast('Lesson booked for ' + learnerName + ' - they\'ve been notified', 'success');
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
    openNotDelivered: openNotDelivered,
    closeNotDelivered: closeNotDelivered,
    confirmNotDelivered: confirmNotDelivered,
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
