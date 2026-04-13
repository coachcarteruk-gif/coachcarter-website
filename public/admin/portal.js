(function () {
  'use strict';

// ── HTML-escape helper ─────────────────────────────────────────────
// User data from the API is NEVER trusted. Every ${field} interpolation
// into innerHTML MUST be wrapped in esc(). Covers element + attribute contexts.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Auth ──────────────────────────────────────────────────────────
// Authentication now lives in the httpOnly cc_admin / cc_instructor
// cookies. Session JWTs are attached automatically by the browser on
// same-origin fetches; the backend accepts either cookie for admin
// endpoints (via requireAuth({ roles: ['admin'] }) — which includes
// instructors with isAdmin=true).
//
// localStorage display blobs are read for sidebar greetings because
// they're the fastest way to populate name/email on page load without
// an extra API round-trip. They contain NO auth material — session JWTs
// live in the httpOnly cc_admin / cc_instructor cookies.
const adminData = JSON.parse(localStorage.getItem('cc_admin') || 'null');
const instrData = JSON.parse(localStorage.getItem('cc_instructor') || 'null');
const isInstructorAdmin = !adminData && instrData && instrData.instructor && instrData.instructor.is_admin;

if (!adminData && !isInstructorAdmin) window.location.href = '/admin/login.html';

const HEADERS = { 'Content-Type': 'application/json' };

// fetchAdmin: cookie-based wrapper. Use instead of fetch() for all
// admin API calls. Imports from shared/admin-auth.js.
const fetchAdmin = window.ccAdminAuth.fetchAuthed;

// Set admin info in sidebar
if (isInstructorAdmin) {
  document.getElementById('admin-name').textContent = instrData.instructor?.name || 'Admin';
  document.getElementById('admin-email').textContent = instrData.instructor?.email || '';
} else if (adminData.admin) {
  document.getElementById('admin-name').textContent = adminData.admin.name || 'Admin';
  document.getElementById('admin-email').textContent = adminData.admin.email || '';
}

function logout() {
  if (isInstructorAdmin) {
    // Instructor-admins: clear the instructor session on the server
    // (not the admin one — they authenticated via cc_instructor).
    try {
      fetchAdmin('/api/instructor?action=logout', { method: 'POST', keepalive: true })
        .catch(function () {});
    } catch (e) { /* ignore */ }
    localStorage.removeItem('cc_instructor');
    window.location.href = '/instructor/';
  } else {
    window.ccAdminAuth.logout();
  }
}

// Verify session on load (cookie rides automatically)
fetchAdmin('/api/admin?action=verify')
  .then(r => { if (!r.ok) logout(); })
  .catch(() => logout());

// Instructor-admins see "Back to Portal" instead of "Sign Out"
if (isInstructorAdmin) {
  document.getElementById('logout-btn').textContent = '← Back to Portal';
}

// ── Navigation ────────────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.section === name);
  });
  // Load data for section
  if (name === 'dashboard')    loadDashboard();
  if (name === 'instructors')  loadInstructors();
  if (name === 'availability') loadInstructorSelect();
  if (name === 'bookings')     loadBookings();
  if (name === 'videos')        loadVideos();
  if (name === 'learners')      loadLearners();
  if (name === 'lesson-types')  loadLessonTypes();
  if (name === 'payouts')       loadPayouts();
  if (name === 'referrals')     loadReferrals();
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Modal helpers ─────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Date helpers ──────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(str) {
  const d = new Date(str + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function formatTime(str) { return str ? str.slice(0, 5) : ''; }

function statusBadge(status) {
  const map = {
    confirmed: 'badge-green', completed: 'badge-blue',
    cancelled: 'badge-red', active: 'badge-green', inactive: 'badge-gray',
    awaiting_confirmation: 'badge-amber', disputed: 'badge-red', no_show: 'badge-gray',
    rescheduled: 'badge-gray'
  };
  const labels = { awaiting_confirmation: 'awaiting', no_show: 'no show' };
  return '<span class="badge ' + (map[status] || 'badge-gray') + '">' + (labels[status] || status) + '</span>';
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    const res = await fetchAdmin('/api/admin?action=dashboard-stats', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    document.getElementById('stat-upcoming').textContent = data.bookings.upcoming;
    document.getElementById('stat-today').textContent = data.today;
    document.getElementById('stat-week').textContent = data.this_week;
    document.getElementById('stat-learners').textContent = data.learners.total_learners;
    document.getElementById('stat-instructors').textContent = data.instructors.active_instructors;
    document.getElementById('stat-revenue').textContent =
      '\u00a3' + (data.revenue.total_revenue_pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });
    document.getElementById('stat-awaiting').textContent = data.bookings.awaiting_confirmation || 0;
    document.getElementById('stat-disputed').textContent = data.bookings.disputed || 0;
  } catch (err) {
    console.error('Dashboard stats error:', err);
  }

  // Load upcoming bookings
  try {
    const res = await fetchAdmin('/api/admin?action=all-bookings&status=confirmed', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = data.bookings.filter(b => b.scheduled_date >= today).slice(0, 10);

    const body = document.getElementById('dash-upcoming-body');
    if (upcoming.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No upcoming bookings</td></tr>';
      return;
    }
    body.innerHTML = upcoming.map(b =>
      '<tr>' +
        '<td>' + formatDate(b.scheduled_date) + '</td>' +
        '<td>' + formatTime(b.start_time) + ' – ' + formatTime(b.end_time) + '</td>' +
        '<td><strong>' + esc(b.learner_name) + '</strong><br><span style="font-size:0.8rem;color:var(--muted)">' + esc(b.learner_email) + '</span></td>' +
        '<td>' + esc(b.instructor_name) + '</td>' +
        '<td>' + statusBadge(b.status) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    console.error('Dashboard bookings error:', err);
  }
}

// ══════════════════════════════════════════════════════════════════
// INSTRUCTORS
// ══════════════════════════════════════════════════════════════════
let instructorsCache = [];

async function loadInstructors() {
  try {
    const res = await fetchAdmin('/api/admin?action=all-instructors', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    instructorsCache = data.instructors;
    renderInstructors();
  } catch (err) {
    document.getElementById('instructors-list').innerHTML =
      '<div class="empty-state">Failed to load instructors</div>';
  }
}

function renderInstructors() {
  const el = document.getElementById('instructors-list');
  if (instructorsCache.length === 0) {
    el.innerHTML = '<div class="empty-state">No instructors added yet</div>';
    return;
  }

  el.innerHTML = instructorsCache.map(i => {
    const availSummary = i.availability.length > 0
      ? i.availability.map(w => DAYS[w.day_of_week] + ' ' + formatTime(w.start_time) + '–' + formatTime(w.end_time)).join(', ')
      : 'No availability set';

    return '<div class="panel-card" style="margin-bottom: 16px;">' +
      '<div style="padding: 20px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">' +
        '<div style="flex: 1; min-width: 200px;">' +
          '<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">' +
            '<strong style="font-size: 1.1rem; font-family: var(--font-head);">' + esc(i.name) + '</strong>' +
            statusBadge(i.active ? 'active' : 'inactive') +
          '</div>' +
          '<div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 4px;">' + esc(i.email) + (i.phone ? ' &middot; ' + esc(i.phone) : '') + '</div>' +
          (i.bio ? '<div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 8px;">' + esc(i.bio) + '</div>' : '') +
          '<div style="font-size: 0.8rem; color: var(--muted);">' +
            '<span style="margin-right: 16px;">Upcoming: <strong>' + i.upcoming_bookings + '</strong></span>' +
            '<span>Completed: <strong>' + i.completed_lessons + '</strong></span>' +
          '</div>' +
          '<div style="font-size: 0.78rem; color: var(--muted); margin-top: 6px;">Availability: ' + esc(availSummary) + '</div>' +
        '</div>' +
        '<div style="display: flex; gap: 8px; flex-shrink: 0;">' +
          '<button class="btn btn-sm" data-action="edit-instructor" data-id="' + i.id + '">Edit</button>' +
          (i.active
            ? '<button class="btn btn-sm btn-danger" data-action="toggle-instructor" data-id="' + i.id + '" data-active="false">Deactivate</button>'
            : '<button class="btn btn-sm btn-success" data-action="toggle-instructor" data-id="' + i.id + '" data-active="true">Activate</button>') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openAddInstructor() {
  document.getElementById('instructor-modal-title').textContent = 'Add Instructor';
  document.getElementById('instructor-edit-id').value = '';
  document.getElementById('inst-name').value = '';
  document.getElementById('inst-email').value = '';
  document.getElementById('inst-phone').value = '';
  document.getElementById('inst-bio').value = '';
  document.getElementById('inst-photo').value = '';
  document.getElementById('inst-buffer').value = '30';
  document.getElementById('inst-max-travel').value = '30';
  document.getElementById('inst-commission').value = '85';
  document.getElementById('inst-fee-model').value = 'commission';
  document.getElementById('inst-franchise-fee').value = '';
  toggleFeeModelFields();
  openModal('modal-instructor');
}

function openEditInstructor(id) {
  const i = instructorsCache.find(x => x.id === id);
  if (!i) return;
  document.getElementById('instructor-modal-title').textContent = 'Edit Instructor';
  document.getElementById('instructor-edit-id').value = id;
  document.getElementById('inst-name').value = i.name || '';
  document.getElementById('inst-email').value = i.email || '';
  document.getElementById('inst-phone').value = i.phone || '';
  document.getElementById('inst-bio').value = i.bio || '';
  document.getElementById('inst-photo').value = i.photo_url || '';
  document.getElementById('inst-buffer').value = String(i.buffer_minutes ?? 30);
  document.getElementById('inst-max-travel').value = String(i.max_travel_minutes ?? 30);
  document.getElementById('inst-commission').value = String(Math.round((i.commission_rate ?? 0.85) * 100));
  // Fee model
  const hasFranchise = i.weekly_franchise_fee_pence != null;
  document.getElementById('inst-fee-model').value = hasFranchise ? 'franchise' : 'commission';
  document.getElementById('inst-franchise-fee').value = hasFranchise ? (i.weekly_franchise_fee_pence / 100).toFixed(0) : '';
  toggleFeeModelFields();
  openModal('modal-instructor');
}

function toggleFeeModelFields() {
  const model = document.getElementById('inst-fee-model').value;
  document.getElementById('commission-field').style.display = model === 'commission' ? '' : 'none';
  document.getElementById('franchise-field').style.display = model === 'franchise' ? '' : 'none';
}

async function saveInstructor() {
  const editId = document.getElementById('instructor-edit-id').value;
  const feeModel = document.getElementById('inst-fee-model').value;
  const body = {
    name: document.getElementById('inst-name').value.trim(),
    email: document.getElementById('inst-email').value.trim(),
    phone: document.getElementById('inst-phone').value.trim() || null,
    bio: document.getElementById('inst-bio').value.trim() || null,
    photo_url: document.getElementById('inst-photo').value.trim() || null,
    buffer_minutes: parseInt(document.getElementById('inst-buffer').value) || 30,
    max_travel_minutes: parseInt(document.getElementById('inst-max-travel').value) || 30,
  };
  if (feeModel === 'franchise') {
    const feeGbp = parseFloat(document.getElementById('inst-franchise-fee').value);
    if (isNaN(feeGbp) || feeGbp < 0) { toast('Enter a valid franchise fee', 'error'); return; }
    body.weekly_franchise_fee_pence = Math.round(feeGbp * 100);
    body.commission_rate = 0.85; // keep default, not used in franchise model
  } else {
    body.commission_rate = (parseFloat(document.getElementById('inst-commission').value) || 85) / 100;
    body.weekly_franchise_fee_pence = null; // clear franchise fee
  }

  if (!body.name || !body.email) { toast('Name and email are required', 'error'); return; }

  try {
    let url, payload;
    if (editId) {
      url = '/api/instructors?action=update';
      payload = { ...body, id: parseInt(editId) };
    } else {
      url = '/api/instructors?action=create';
      payload = body;
    }

    const res = await fetch(url, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    closeModal('modal-instructor');
    toast(editId ? 'Instructor updated' : 'Instructor created', 'success');
    loadInstructors();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleInstructor(id, active) {
  try {
    const res = await fetchAdmin('/api/instructors?action=update', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ id, active })
    });
    if (!res.ok) throw new Error('Failed');
    toast(active ? 'Instructor activated' : 'Instructor deactivated', 'success');
    loadInstructors();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// AVAILABILITY
// ══════════════════════════════════════════════════════════════════
let availWindows = []; // current working set

async function loadInstructorSelect() {
  try {
    const res = await fetchAdmin('/api/admin?action=all-instructors', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    instructorsCache = data.instructors;

    const select = document.getElementById('avail-instructor-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Choose an instructor...</option>';
    data.instructors.filter(i => i.active).forEach(i => {
      select.innerHTML += '<option value="' + i.id + '">' + esc(i.name) + '</option>';
    });
    if (currentVal) { select.value = currentVal; loadAvailability(); }
  } catch (err) {
    toast('Failed to load instructors', 'error');
  }
}

function loadAvailability() {
  const id = document.getElementById('avail-instructor-select').value;
  const editor = document.getElementById('availability-editor');
  const boSection = document.getElementById('blackout-section');
  if (!id) { editor.style.display = 'none'; boSection.style.display = 'none'; return; }
  editor.style.display = 'block';
  boSection.style.display = 'block';

  const instructor = instructorsCache.find(i => i.id === parseInt(id));
  availWindows = instructor ? instructor.availability.map(w => ({
    day_of_week: w.day_of_week,
    start_time: formatTime(w.start_time),
    end_time: formatTime(w.end_time)
  })) : [];

  renderAvailGrid();
  loadBlackouts(id);
}

function renderAvailGrid() {
  const grid = document.getElementById('avail-grid');
  // Show Mon-Sun (1,2,3,4,5,6,0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];

  grid.innerHTML = dayOrder.map(d => {
    const dayWindows = availWindows.filter(w => w.day_of_week === d);
    return '<div class="avail-day">' +
      '<div class="avail-day-label">' + DAY_NAMES[d] + '</div>' +
      (dayWindows.length > 0
        ? dayWindows.map((w, idx) => {
            const globalIdx = availWindows.indexOf(w);
            return '<div class="avail-slot">' +
              '<span>' + w.start_time + '–' + w.end_time + '</span>' +
              '<button class="remove-slot" data-action="remove-window" data-idx="' + globalIdx + '" title="Remove">&times;</button>' +
            '</div>';
          }).join('')
        : '<div style="font-size:0.75rem;color:var(--muted);font-style:italic;">No windows</div>') +
    '</div>';
  }).join('');
}

function openAddWindow() {
  document.getElementById('window-day').value = '1';
  document.getElementById('window-start').value = '09:00';
  document.getElementById('window-end').value = '17:00';
  openModal('modal-avail-window');
}

function addWindow() {
  const day = parseInt(document.getElementById('window-day').value);
  const start = document.getElementById('window-start').value.trim();
  const end = document.getElementById('window-end').value.trim();

  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    toast('Times must be HH:MM format', 'error'); return;
  }
  if (start >= end) { toast('Start time must be before end time', 'error'); return; }

  availWindows.push({ day_of_week: day, start_time: start, end_time: end });
  closeModal('modal-avail-window');
  renderAvailGrid();
  toast('Window added (unsaved)', '');
}

function removeWindow(idx) {
  availWindows.splice(idx, 1);
  renderAvailGrid();
}

async function saveAvailability() {
  const instructorId = parseInt(document.getElementById('avail-instructor-select').value);
  if (!instructorId) return;

  try {
    const res = await fetchAdmin('/api/instructors?action=set-availability', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        instructor_id: instructorId,
        windows: availWindows
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    toast('Availability saved', 'success');
    // Refresh instructor cache
    loadInstructorSelect();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// BLACKOUT DATES (admin management)
// ══════════════════════════════════════════════════════════════════
let blackoutRanges = [];

async function loadBlackouts(instructorId) {
  blackoutRanges = [];
  const list = document.getElementById('blackout-list');
  if (!instructorId) { list.innerHTML = ''; return; }
  try {
    const res = await fetchAdmin('/api/admin?action=instructor-blackouts&instructor_id=' + instructorId, { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    blackoutRanges = (data.blackout_dates || []).map(d => ({
      start_date: d.start_date, end_date: d.end_date, reason: d.reason || ''
    }));
    renderBlackoutList();
  } catch (err) {
    list.innerHTML = '<div style="color:var(--red);font-size:0.85rem;">Failed to load blackout dates</div>';
  }
}

function renderBlackoutList() {
  const list = document.getElementById('blackout-list');
  if (blackoutRanges.length === 0) {
    list.innerHTML = '<div style="font-size:0.85rem;color:var(--muted);font-style:italic;">No blackout dates set</div>';
    return;
  }
  list.innerHTML = blackoutRanges.map(function(r, idx) {
    var startD = new Date(r.start_date + 'T00:00:00');
    var endD = new Date(r.end_date + 'T00:00:00');
    var days = Math.round((endD - startD) / 86400000) + 1;
    var label = startD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (r.start_date !== r.end_date) {
      label += ' – ' + endD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:0.9rem">' + esc(label) +
          '<span style="background:var(--accent-lt);color:var(--accent);font-size:0.75rem;padding:2px 8px;border-radius:10px;margin-left:8px;font-weight:700">' + days + ' day' + (days !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        (r.reason ? '<div style="font-size:0.78rem;color:var(--muted);margin-top:2px">' + esc(r.reason) + '</div>' : '') +
      '</div>' +
      '<button data-action="remove-blackout" data-idx="' + idx + '" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.2rem;padding:4px 8px" title="Remove">&times;</button>' +
    '</div>';
  }).join('');
}

function addBlackout() {
  var startEl = document.getElementById('bo-start');
  var endEl = document.getElementById('bo-end');
  var reasonEl = document.getElementById('bo-reason');
  var start = startEl.value;
  var end = endEl.value || start;
  var reason = reasonEl.value.trim();

  if (!start) { toast('Select a start date', 'error'); return; }
  if (end < start) { toast('End date must be on or after start date', 'error'); return; }
  var diffMs = new Date(end) - new Date(start);
  if (diffMs > 365 * 86400000) { toast('Range cannot exceed 365 days', 'error'); return; }

  // Check for overlaps with existing ranges
  for (var i = 0; i < blackoutRanges.length; i++) {
    var r = blackoutRanges[i];
    if (start <= r.end_date && end >= r.start_date) {
      toast('This range overlaps with an existing blackout', 'error'); return;
    }
  }

  blackoutRanges.push({ start_date: start, end_date: end, reason: reason });
  blackoutRanges.sort(function(a, b) { return a.start_date.localeCompare(b.start_date); });
  renderBlackoutList();
  startEl.value = ''; endEl.value = ''; reasonEl.value = '';
}

function removeBlackout(idx) {
  blackoutRanges.splice(idx, 1);
  renderBlackoutList();
}

async function saveBlackouts() {
  var instructorId = document.getElementById('avail-instructor-select').value;
  if (!instructorId) { toast('Select an instructor first', 'error'); return; }

  try {
    var res = await fetchAdmin('/api/admin?action=set-instructor-blackouts', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ instructor_id: parseInt(instructorId), ranges: blackoutRanges })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    toast('Blackout dates saved', 'success');
    // Reload to confirm
    blackoutRanges = (data.blackout_dates || []).map(function(d) {
      return { start_date: d.start_date, end_date: d.end_date, reason: d.reason || '' };
    });
    renderBlackoutList();
  } catch (err) {
    toast(err.message || 'Failed to save blackout dates', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// BOOKINGS
// ══════════════════════════════════════════════════════════════════
let allBookings = [];
let currentBookingFilter = '';

async function loadBookings() {
  try {
    const res = await fetchAdmin('/api/admin?action=all-bookings', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    allBookings = data.bookings;
    renderBookings();
  } catch (err) {
    document.getElementById('bookings-body').innerHTML =
      '<tr><td colspan="6" class="empty-state">Failed to load bookings</td></tr>';
  }
}

function filterBookings(btn, status) {
  document.querySelectorAll('#booking-filters .filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentBookingFilter = status;
  renderBookings();
}

function renderBookings() {
  const body = document.getElementById('bookings-body');
  let filtered = allBookings;
  if (currentBookingFilter) {
    filtered = allBookings.filter(b => b.status === currentBookingFilter);
  }

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No bookings found</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(b => {
    const canEdit = b.status === 'confirmed' || b.status === 'awaiting_confirmation';
    const canComplete = b.status === 'confirmed';
    const typeLabel = b.lesson_type_name ? '<br><span style="font-size:0.78rem;color:var(--muted)">' + esc(b.lesson_type_name) + '</span>' : '';
    return '<tr>' +
      '<td>' + formatDate(b.scheduled_date) + '</td>' +
      '<td>' + formatTime(b.start_time) + ' – ' + formatTime(b.end_time) + typeLabel + '</td>' +
      '<td><strong>' + esc(b.learner_name) + '</strong><br><span style="font-size:0.8rem;color:var(--muted)">' + esc(b.learner_email) + '</span></td>' +
      '<td>' + esc(b.instructor_name) + '</td>' +
      '<td>' + statusBadge(b.status) + (b.edited_at ? ' <span style="font-size:0.7rem;color:var(--muted)">(edited)</span>' : '') + '</td>' +
      '<td style="white-space:nowrap">' +
        (canEdit ? '<button class="btn btn-sm" data-action="edit-booking" data-id="' + b.id + '" style="margin-right:4px">Edit</button>' : '') +
        (canComplete ? '<button class="btn btn-sm btn-success" data-action="mark-complete" data-id="' + b.id + '">Complete</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('');
}

async function markComplete(bookingId) {
  try {
    const res = await fetchAdmin('/api/admin?action=mark-complete', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ booking_id: bookingId })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
    toast('Booking marked as complete', 'success');
    loadBookings();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Edit Booking (Admin) ────────────────────────────────────────────────────
let adminEditBookingId = null;
let adminEditLessonTypes = [];
let adminEditOrigMinutes = 0;

async function openAdminEditBooking(bookingId) {
  const b = allBookings.find(x => x.id === bookingId);
  if (!b) return;
  adminEditBookingId = bookingId;
  adminEditOrigMinutes = parseInt(b.minutes_deducted) || 0;

  document.getElementById('adminEditDate').value = b.scheduled_date;
  document.getElementById('adminEditTime').value = b.start_time.slice(0, 5);

  // Load lesson types (include inactive for legacy corrections)
  try {
    const res = await fetchAdmin('/api/lesson-types?action=list&include_inactive=true', { headers: HEADERS });
    const data = await res.json();
    adminEditLessonTypes = data.lesson_types || [];
  } catch { adminEditLessonTypes = []; }

  const sel = document.getElementById('adminEditType');
  sel.innerHTML = adminEditLessonTypes.map(function(lt) {
    return '<option value="' + lt.id + '" data-duration="' + lt.duration_minutes + '"' +
      (lt.id === b.lesson_type_id ? ' selected' : '') + '>' +
      esc(lt.name) + ' (' + (lt.duration_minutes >= 60 ? (lt.duration_minutes/60) + 'hr' : lt.duration_minutes + 'min') + ')' +
      (lt.active === false ? ' [hidden]' : '') +
      '</option>';
  }).join('');

  updateAdminEditEnd();
  document.getElementById('adminEditSaveBtn').disabled = false;
  document.getElementById('adminEditSaveBtn').textContent = 'Save changes';
  document.getElementById('adminEditBookingModal').style.display = 'flex';
}

function updateAdminEditEnd() {
  var startVal = document.getElementById('adminEditTime').value;
  var sel = document.getElementById('adminEditType');
  var opt = sel.options[sel.selectedIndex];
  var duration = parseInt(opt && opt.dataset.duration) || 90;

  if (startVal) {
    var parts = startVal.split(':').map(Number);
    var endMins = parts[0] * 60 + parts[1] + duration;
    document.getElementById('adminEditEndTime').textContent =
      String(Math.floor(endMins / 60)).padStart(2, '0') + ':' + String(endMins % 60).padStart(2, '0');
  }

  var infoEl = document.getElementById('adminEditBalanceInfo');
  if (adminEditOrigMinutes > 0) {
    var delta = duration - adminEditOrigMinutes;
    if (delta > 0) {
      infoEl.textContent = 'Learner will be charged ' + delta + ' extra minutes.';
      infoEl.style.color = 'var(--red, #e00)';
      infoEl.style.display = 'block';
    } else if (delta < 0) {
      infoEl.textContent = Math.abs(delta) + ' minutes refunded to learner.';
      infoEl.style.color = 'var(--green, #16a34a)';
      infoEl.style.display = 'block';
    } else { infoEl.style.display = 'none'; }
  } else { infoEl.style.display = 'none'; }
}

function closeAdminEditBooking() {
  document.getElementById('adminEditBookingModal').style.display = 'none';
  adminEditBookingId = null;
}

async function confirmAdminEditBooking(forceOverride) {
  if (!adminEditBookingId) return;
  var btn = document.getElementById('adminEditSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    var res = await fetchAdmin('/api/admin?action=edit-booking', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        booking_id: adminEditBookingId,
        scheduled_date: document.getElementById('adminEditDate').value,
        start_time: document.getElementById('adminEditTime').value.slice(0, 5),
        lesson_type_id: parseInt(document.getElementById('adminEditType').value),
        force: !!forceOverride
      })
    });
    var data = await res.json();
    if (res.status === 409 && data.can_force && data.conflicts) {
      var msg = 'This time overlaps with:\n\n';
      for (var i = 0; i < data.conflicts.length; i++) {
        var c = data.conflicts[i];
        msg += '• ' + c.learner_name + ' (' + c.time + ')\n';
      }
      msg += '\nSave anyway?';
      btn.disabled = false; btn.textContent = 'Save changes';
      if (confirm(msg)) return confirmAdminEditBooking(true);
      return;
    }
    if (!res.ok) throw new Error(data.error || data.message);
    closeAdminEditBooking();
    toast('Booking updated', 'success');
    loadBookings();
  } catch (err) {
    toast(err.message || 'Failed to edit', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

// ══════════════════════════════════════════════════════════════════
// LEARNERS
// ══════════════════════════════════════════════════════════════════
let allLearners = [];
let currentLearnerTierFilter = 0;

async function loadLearners() {
  try {
    const res = await fetchAdmin('/api/admin?action=all-learners', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    allLearners = data.learners;
    renderLearners();
  } catch (err) {
    document.getElementById('learners-body').innerHTML =
      '<tr><td colspan="8" class="empty-state">Failed to load learners</td></tr>';
  }
}

function filterLearnerTier(btn, tier) {
  document.querySelectorAll('#learner-filters .filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentLearnerTierFilter = tier;
  renderLearners();
}

function renderLearners() {
  const body = document.getElementById('learners-body');
  let filtered = allLearners;
  const search = (document.getElementById('learner-search')?.value || '').toLowerCase();

  if (currentLearnerTierFilter) {
    filtered = filtered.filter(l => l.current_tier === currentLearnerTierFilter);
  }
  if (search) {
    filtered = filtered.filter(l =>
      (l.name || '').toLowerCase().includes(search) ||
      (l.email || '').toLowerCase().includes(search) ||
      (l.phone || '').toLowerCase().includes(search)
    );
  }

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">No learners found</td></tr>';
    return;
  }

  const tierLabels = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };
  const tierClasses = { 1: 'badge-green', 2: 'badge-amber', 3: 'badge-blue' };

  body.innerHTML = filtered.map(l => {
    const tier = l.current_tier || 1;
    return '<tr style="cursor:pointer;" data-action="show-learner-detail" data-id="' + l.id + '">' +
      '<td><strong>' + esc(l.name || 'Unnamed') + '</strong></td>' +
      '<td>' + esc(l.email || '-') + '</td>' +
      '<td>' + esc(l.phone || '-') + '</td>' +
      '<td><span class="badge ' + (tierClasses[tier] || 'badge-gray') + '">' + (tierLabels[tier] || 'T' + tier) + '</span></td>' +
      '<td>' + (l.credit_balance || 0) + '</td>' +
      '<td>' + (l.total_bookings || 0) + (l.upcoming_bookings ? ' <span style="color:var(--green);font-size:0.78rem;">(' + l.upcoming_bookings + ' upcoming)</span>' : '') + '</td>' +
      '<td>' + (l.last_booking_date ? formatDate(l.last_booking_date) : '-') + '</td>' +
      '<td>' + (l.created_at ? formatDate(l.created_at.slice(0, 10)) : '-') + '</td>' +
    '</tr>';
  }).join('');
}

let _detailLearnerId = null;

async function showLearnerDetail(id) {
  _detailLearnerId = id;
  const panel = document.getElementById('learner-detail-panel');
  const content = document.getElementById('learner-detail-content');
  const nameEl = document.getElementById('learner-detail-name');

  const learner = allLearners.find(l => l.id === id);
  nameEl.textContent = learner ? (learner.name || learner.email) : 'Learner Details';
  content.innerHTML = '<div class="empty-state">Loading...</div>';
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    const res = await fetchAdmin('/api/admin?action=learner-detail&learner_id=' + id, { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    const tierLabels = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };
    let html = '';

    // Learner info
    if (learner) {
      html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px;font-size:0.85rem;color:var(--muted);">';
      if (learner.email) html += '<div><strong>Email:</strong> ' + esc(learner.email) + '</div>';
      if (learner.phone) html += '<div><strong>Phone:</strong> ' + esc(learner.phone) + '</div>';
      if (learner.pickup_address) html += '<div><strong>Pickup:</strong> ' + esc(learner.pickup_address) + '</div>';
      html += '<div><strong>Contact before lesson:</strong> ' + (learner.prefer_contact_before ? 'Yes' : 'No') + '</div>';
      html += '</div>';
    }

    // Stats cards
    html += '<div class="stats-grid" style="margin-bottom: 20px;">';
    html += '<div class="stat-card"><div class="stat-value">' + (tierLabels[learner?.current_tier] || 'N/A') + '</div><div class="stat-label">Current Tier</div></div>';
    html += '<div class="stat-card" data-action="open-adjust-credits" data-learner-id="' + id + '" data-balance="' + (learner?.balance_minutes || 0) + '" style="cursor:pointer;position:relative;">' +
      '<div class="stat-value">' + fmtBalanceMins(learner?.balance_minutes || 0) + '</div>' +
      '<div class="stat-label">Hours Balance</div>' +
      '<div style="font-size:0.7rem;color:var(--accent);margin-top:4px;">Click to adjust</div>' +
      '</div>';
    html += '<div class="stat-card"><div class="stat-value">' + (data.progress?.total_sessions || 0) + '</div><div class="stat-label">Sessions Logged</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + Math.round((data.progress?.total_minutes || 0) / 60 * 10) / 10 + 'h</div><div class="stat-label">Total Hours</div></div>';
    html += '</div>';

    // Booking history
    html += '<h3 style="font-family:var(--font-head);margin-bottom:12px;">Booking History</h3>';
    if (data.bookings.length === 0) {
      html += '<div class="empty-state" style="margin-bottom:24px;">No bookings</div>';
    } else {
      html += '<div class="table-wrap" style="margin-bottom:24px;"><table class="data-table"><thead><tr><th>Date</th><th>Time</th><th>Instructor</th><th>Status</th><th>Notes</th></tr></thead><tbody>';
      html += data.bookings.map(b =>
        '<tr><td>' + formatDate(b.scheduled_date) + '</td>' +
        '<td>' + formatTime(b.start_time) + ' – ' + formatTime(b.end_time) + '</td>' +
        '<td>' + esc(b.instructor_name) + '</td>' +
        '<td>' + statusBadge(b.status) + '</td>' +
        '<td>' + esc(b.notes || '') + '</td></tr>'
      ).join('');
      html += '</tbody></table></div>';
    }

    // Credit transactions
    html += '<h3 style="font-family:var(--font-head);margin-bottom:12px;">Credit Transactions</h3>';
    if (data.transactions.length === 0) {
      html += '<div class="empty-state">No transactions</div>';
    } else {
      html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Credits</th><th>Amount</th><th>Method</th></tr></thead><tbody>';
      html += data.transactions.map(t =>
        '<tr><td>' + new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</td>' +
        '<td><span class="badge ' + (t.type === 'purchase' ? 'badge-green' : 'badge-amber') + '">' + t.type.toUpperCase() + '</span></td>' +
        '<td>' + t.credits + '</td>' +
        '<td>' + (t.amount_pence ? '\u00a3' + (t.amount_pence / 100).toFixed(2) : '-') + '</td>' +
        '<td>' + esc(t.payment_method || '-') + '</td></tr>'
      ).join('');
      html += '</tbody></table></div>';
    }

    // Delete button
    html += '<div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);">';
    html += '<button data-action="confirm-delete-learner" data-id="' + id + '" data-name="' + esc(learner?.name || learner?.email || '') + '" style="background:#e74c3c;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">🗑 Delete Learner</button>';
    html += '<span style="margin-left:12px;font-size:0.78rem;color:var(--muted);">Permanently removes this learner and all their data.</span>';
    html += '</div>';

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<div class="empty-state">Failed to load learner details</div>';
  }
}

function confirmDeleteLearner(id, name) {
  if (!confirm('Are you sure you want to permanently delete ' + (name || 'this learner') + '? This will remove all their bookings, sessions, credits and cannot be undone.')) return;
  if (!confirm('This is irreversible. Type OK to confirm you want to delete ' + (name || 'this learner') + '.')) return;
  deleteLearner(id);
}

async function deleteLearner(id) {
  try {
    const res = await fetchAdmin('/api/admin?action=delete-learner', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ learner_id: id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert('Learner deleted: ' + (data.deleted?.name || data.deleted?.email));
    closeLearnerDetail();
    loadLearners(); // refresh the list
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

function closeLearnerDetail() {
  document.getElementById('learner-detail-panel').style.display = 'none';
}

// ── Edit learner details ──

function openEditLearner() {
  if (!_detailLearnerId) return;
  const learner = allLearners.find(l => l.id === _detailLearnerId);
  if (!learner) return;
  document.getElementById('learner-edit-id').value = learner.id;
  document.getElementById('learner-edit-name').value = learner.name || '';
  document.getElementById('learner-edit-email').value = learner.email || '';
  document.getElementById('learner-edit-phone').value = learner.phone || '';
  document.getElementById('learner-edit-pickup').value = learner.pickup_address || '';
  document.getElementById('modal-edit-learner').classList.add('open');
}

async function saveEditLearner() {
  const id = parseInt(document.getElementById('learner-edit-id').value);
  if (!id) return;
  const body = {
    id,
    name: document.getElementById('learner-edit-name').value.trim(),
    email: document.getElementById('learner-edit-email').value.trim(),
    phone: document.getElementById('learner-edit-phone').value.trim(),
    pickup_address: document.getElementById('learner-edit-pickup').value.trim()
  };
  if (!body.name && !body.email) return alert('Name or email is required');
  try {
    const res = await fetchAdmin('/api/admin?action=update-learner', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    closeModal('modal-edit-learner');
    // Update local cache and refresh views
    const idx = allLearners.findIndex(l => l.id === id);
    if (idx !== -1) {
      Object.assign(allLearners[idx], data.learner);
    }
    showLearnerDetail(id);
    renderLearners();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

// ── Credit adjustment ──
let _adjustLearnerId = null;

function fmtBalanceMins(mins) {
  const m = mins || 0;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? h + 'h ' + rem + 'm' : h + 'h';
}

function openAdjustCredits(learnerId, balanceMinutes) {
  _adjustLearnerId = learnerId;
  let m = document.getElementById('adjust-credits-modal');
  if (m) m.remove();

  const modal = document.createElement('div');
  modal.id = 'adjust-credits-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
  modal.innerHTML = `
    <div style="background:var(--card);border-radius:16px;padding:32px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <h3 style="font-family:var(--font-head);margin:0 0 8px;">Adjust Hours Balance</h3>
      <p style="color:var(--muted);font-size:0.85rem;margin:0 0 20px;">Current balance: <strong>${fmtBalanceMins(balanceMinutes)}</strong></p>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button data-action="adj-type" data-type="add" id="adj-add-btn" style="flex:1;padding:10px;border-radius:8px;border:2px solid var(--accent);background:var(--accent);color:#fff;font-weight:600;cursor:pointer;">+ Add</button>
        <button data-action="adj-type" data-type="remove" id="adj-remove-btn" style="flex:1;padding:10px;border-radius:8px;border:2px solid #ef4444;background:transparent;color:#ef4444;font-weight:600;cursor:pointer;">− Remove</button>
      </div>
      <input type="number" id="adj-hours-input" min="0.5" max="100" step="0.5" value="1.5" placeholder="Hours (e.g. 1.5)"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:1rem;margin-bottom:12px;box-sizing:border-box;">
      <input type="text" id="adj-reason-input" placeholder="Reason (e.g. Free trial, Refund, Goodwill)"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.9rem;margin-bottom:20px;box-sizing:border-box;">
      <div style="display:flex;gap:8px;">
        <button data-action="close-adjust-credits" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;">Cancel</button>
        <button data-action="submit-adjust-credits" id="adj-submit-btn" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;">Add Hours</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#adj-hours-input').focus();
  window._adjustType = 'add';
}

function setAdjustType(type) {
  window._adjustType = type;
  const addBtn = document.getElementById('adj-add-btn');
  const removeBtn = document.getElementById('adj-remove-btn');
  const submitBtn = document.getElementById('adj-submit-btn');
  if (type === 'add') {
    addBtn.style.background = 'var(--accent)'; addBtn.style.color = '#fff';
    removeBtn.style.background = 'transparent'; removeBtn.style.color = '#ef4444';
    submitBtn.textContent = 'Add Hours'; submitBtn.style.background = 'var(--accent)';
  } else {
    removeBtn.style.background = '#ef4444'; removeBtn.style.color = '#fff';
    addBtn.style.background = 'transparent'; addBtn.style.color = 'var(--accent)';
    submitBtn.textContent = 'Remove Hours'; submitBtn.style.background = '#ef4444';
  }
}

function closeAdjustCredits() {
  const m = document.getElementById('adjust-credits-modal');
  if (m) m.remove();
  _adjustLearnerId = null;
}

async function submitAdjustCredits() {
  const hoursInput = parseFloat(document.getElementById('adj-hours-input').value);
  const reason = document.getElementById('adj-reason-input').value.trim();
  if (!hoursInput || hoursInput <= 0) return alert('Enter a valid number of hours');

  const hours = window._adjustType === 'add' ? hoursInput : -hoursInput;

  try {
    const res = await fetchAdmin('/api/admin?action=adjust-credits', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ learner_id: _adjustLearnerId, hours, reason: reason || undefined })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to adjust hours');

    const refreshId = _adjustLearnerId;
    const newBalance = fmtBalanceMins(data.new_balance_minutes);
    alert((hours > 0 ? 'Added ' : 'Removed ') + Math.abs(hours) + 'h. New balance: ' + newBalance);
    closeAdjustCredits();
    showLearnerDetail(refreshId);
    if (typeof loadLearners === 'function') loadLearners();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// VIDEOS
// ══════════════════════════════════════════════════════════════════
const CF_BASE = 'https://customer-qn21p6ogmlqlhcv4.cloudflarestream.com';
let videosCache = [];
let videoCategoriesCache = [];
let videoFilterCat = 'all';
let bulkSelected = new Set();
let videoHls = null;
let videoUploading = false;

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  return m + ':' + String(ss).padStart(2, '0');
}

async function loadVideos() {
  try {
    const [catRes, vidRes] = await Promise.all([
      fetchAdmin('/api/videos?action=categories', { headers: HEADERS }),
      fetchAdmin('/api/videos?action=list&learner_only=true', { headers: HEADERS })
    ]);
    videoCategoriesCache = (await catRes.json()).categories || [];
    videosCache = (await vidRes.json()).videos || [];
    renderVideoCatFilter();
    renderVideosList();
  } catch (err) {
    document.getElementById('videos-list').innerHTML = '<div class="empty-state">Failed to load videos</div>';
  }
}

function renderVideoCatFilter() {
  const el = document.getElementById('video-cat-filter');
  let html = `<button class="filter-pill ${videoFilterCat === 'all' ? 'active' : ''}" data-action="filter-video-cat" data-cat="all">All (${videosCache.length})</button>`;
  for (const c of videoCategoriesCache) {
    html += `<button class="filter-pill ${videoFilterCat === c.slug ? 'active' : ''}" data-action="filter-video-cat" data-cat="${c.slug}">${esc(c.label)} (${c.video_count || 0})</button>`;
  }
  el.innerHTML = html;
}

function filterVideoCat(slug) {
  videoFilterCat = slug;
  renderVideoCatFilter();
  renderVideosList();
}

function renderVideosList() {
  const el = document.getElementById('videos-list');
  let filtered = videoFilterCat === 'all' ? videosCache : videosCache.filter(v => v.category_slug === videoFilterCat);

  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state">No videos in this category yet. Click "+ Add Video" to get started.</div>';
    updateBulkBar();
    return;
  }

  // Select-all checkbox
  const allIds = filtered.map(v => v.id);
  const allChecked = allIds.length > 0 && allIds.every(id => bulkSelected.has(id));

  el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:4px 0;">' +
    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.78rem;color:var(--muted);text-transform:none;letter-spacing:0;">' +
      '<input type="checkbox" data-action="toggle-select-all" ' + (allChecked ? 'checked' : '') + '> Select all' +
    '</label>' +
  '</div>' +
  filtered.map(v => {
    const thumb = v.thumbnail_url || `${CF_BASE}/${v.cloudflare_uid}/thumbnails/thumbnail.jpg?time=2s&width=240`;
    const badges = [];
    if (!v.published) badges.push('<span style="background:var(--red-bg);color:var(--red);font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:12px;">Unpublished</span>');
    if (v.learner_only) badges.push('<span style="background:rgba(154,117,245,0.12);color:#7c3aed;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:12px;">Learner only</span>');
    const dur = v.duration_seconds ? '<span style="font-size:0.72rem;color:var(--muted);font-weight:600;">' + formatDuration(v.duration_seconds) + '</span>' : '';

    return '<div class="panel-card" style="margin-bottom:10px;padding:14px 16px;">' +
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">' +
        '<input type="checkbox" data-action="toggle-bulk-select" data-id="' + v.id + '" ' + (bulkSelected.has(v.id) ? 'checked' : '') + ' style="flex-shrink:0;">' +
        '<div style="position:relative;width:120px;height:68px;border-radius:8px;overflow:hidden;background:#111;flex-shrink:0;">' +
          '<img src="' + thumb + '" alt="" style="width:100%;height:100%;object-fit:cover;" data-hide-on-error>' +
          (dur ? '<span style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.75);color:#fff;font-size:0.68rem;padding:1px 5px;border-radius:4px;">' + formatDuration(v.duration_seconds) + '</span>' : '') +
        '</div>' +
        '<div style="flex:1;min-width:180px;">' +
          '<div style="font-weight:700;font-size:0.9rem;margin-bottom:3px;">' + esc(v.title) + ' ' + badges.join(' ') + '</div>' +
          '<div style="font-size:0.78rem;color:var(--muted);margin-bottom:3px;">' + esc(v.description || '') + '</div>' +
          '<div style="font-size:0.72rem;color:var(--muted);">' + esc(v.category_label || v.category_slug) + ' · Order: ' + v.sort_order + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn btn-sm" data-action="edit-video" data-id="' + v.id + '">Edit</button>' +
          '<button class="btn btn-sm btn-danger" data-action="delete-video" data-id="' + v.id + '">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  updateBulkBar();
}

// ── Bulk selection ──
function toggleBulkSelect(id, checked) {
  if (checked) bulkSelected.add(id); else bulkSelected.delete(id);
  updateBulkBar();
}

function toggleSelectAll(checked) {
  const filtered = videoFilterCat === 'all' ? videosCache : videosCache.filter(v => v.category_slug === videoFilterCat);
  for (const v of filtered) {
    if (checked) bulkSelected.add(v.id); else bulkSelected.delete(v.id);
  }
  renderVideosList();
}

function clearBulkSelection() {
  bulkSelected.clear();
  renderVideosList();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (bulkSelected.size > 0) {
    bar.style.display = 'flex';
    document.getElementById('bulk-count').textContent = bulkSelected.size + ' selected';
  } else {
    bar.style.display = 'none';
  }
}

async function bulkAction(type) {
  const ids = [...bulkSelected];
  if (ids.length === 0) return;

  if (type === 'delete') {
    if (!confirm(`Delete ${ids.length} video(s)? This cannot be undone.`)) return;
    try {
      const res = await fetchAdmin('/api/videos?action=bulk-delete', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ids }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast(`${ids.length} video(s) deleted`, 'success');
    } catch (err) { toast(err.message, 'error'); return; }
  } else {
    const updates = type === 'publish' ? { published: true } : { published: false };
    try {
      const res = await fetchAdmin('/api/videos?action=bulk-update', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ids, updates }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast(`${ids.length} video(s) ${type === 'publish' ? 'published' : 'unpublished'}`, 'success');
    } catch (err) { toast(err.message, 'error'); return; }
  }
  bulkSelected.clear();
  loadVideos();
}

// ── Upload ──
function toggleManualUid(e) {
  e.preventDefault();
  const wrap = document.getElementById('vid-manual-uid');
  const link = document.getElementById('vid-manual-toggle');
  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    link.textContent = 'Hide manual UID entry';
  } else {
    wrap.style.display = 'none';
    link.textContent = 'Or enter UID manually';
  }
}

function getVideoUid() {
  return document.getElementById('vid-uid-hidden').value || document.getElementById('vid-uid').value.trim();
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('vid-file');
  if (fileInput) fileInput.addEventListener('change', handleVideoFileSelect);
});

async function handleVideoFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 200 * 1024 * 1024) {
    toast('File too large for browser upload (max 200 MB). Use the batch-upload script for larger files.', 'error');
    e.target.value = '';
    return;
  }

  const saveBtn = document.getElementById('vid-save-btn');
  saveBtn.disabled = true;
  videoUploading = true;

  const progressWrap = document.getElementById('vid-upload-progress');
  const bar = document.getElementById('vid-upload-bar');
  const status = document.getElementById('vid-upload-status');
  progressWrap.style.display = 'block';
  bar.style.width = '0%';
  status.textContent = 'Getting upload URL...';

  try {
    // Get upload URL from our API
    const urlRes = await fetchAdmin('/api/videos?action=upload-url', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ maxDurationSeconds: 3600 })
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlData.error || 'Failed to get upload URL');

    const { uploadUrl, uid } = urlData;
    document.getElementById('vid-uid-hidden').value = uid;
    document.getElementById('vid-uid').value = uid;

    status.textContent = 'Uploading...';

    // FormData POST upload
    const formData = new FormData();
    formData.append('file', file);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl, true);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          bar.style.width = pct + '%';
          status.textContent = `Uploading... ${pct}%`;
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 400) resolve();
        else reject(new Error('Upload failed: ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('Upload network error'));
      xhr.send(formData);
    });

    bar.style.width = '100%';
    status.textContent = 'Upload complete! Processing...';

    // Show preview
    showVideoPreview(uid);

    // Poll for metadata (duration)
    pollVideoMeta(uid);

  } catch (err) {
    toast(err.message, 'error');
    status.textContent = 'Upload failed';
    bar.style.width = '0%';
  } finally {
    videoUploading = false;
    saveBtn.disabled = false;
  }
}

async function pollVideoMeta(uid) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetchAdmin(`/api/videos?action=fetch-meta&uid=${uid}`, { headers: HEADERS });
      const data = await res.json();
      if (data.ready && data.duration) {
        document.getElementById('vid-upload-status').textContent = 'Ready · Duration: ' + formatDuration(data.duration);
        // Store duration for saveVideo
        document.getElementById('vid-uid-hidden').dataset.duration = data.duration;
        return;
      }
    } catch { /* continue polling */ }
  }
}

// ── Preview ──
function showVideoPreview(uid) {
  if (!uid) { hideVideoPreview(); return; }
  const wrap = document.getElementById('vid-preview-wrap');
  const videoEl = document.getElementById('vid-preview');
  wrap.style.display = 'block';

  const src = `${CF_BASE}/${uid}/manifest/video.m3u8`;
  if (videoHls) { videoHls.destroy(); videoHls = null; }

  if (Hls.isSupported()) {
    videoHls = new Hls();
    videoHls.loadSource(src);
    videoHls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = src;
  }
}

function hideVideoPreview() {
  document.getElementById('vid-preview-wrap').style.display = 'none';
  if (videoHls) { videoHls.destroy(); videoHls = null; }
}

function openAddVideo() {
  document.getElementById('video-modal-title').textContent = 'Add Video';
  document.getElementById('video-edit-id').value = '';
  document.getElementById('vid-uid').value = '';
  document.getElementById('vid-uid-hidden').value = '';
  delete document.getElementById('vid-uid-hidden').dataset.duration;
  document.getElementById('vid-title').value = '';
  document.getElementById('vid-desc').value = '';
  document.getElementById('vid-thumb').value = '';
  document.getElementById('vid-published').checked = true;
  document.getElementById('vid-learner-only').checked = false;
  document.getElementById('vid-file').value = '';
  document.getElementById('vid-upload-progress').style.display = 'none';
  document.getElementById('vid-upload-section').style.display = '';
  document.getElementById('vid-manual-uid').style.display = 'none';
  document.getElementById('vid-manual-toggle').textContent = 'Or enter UID manually';
  hideVideoPreview();
  populateVideoCatSelect('');
  openModal('modal-video');
}

function openEditVideo(id) {
  const v = videosCache.find(x => x.id === id);
  if (!v) return;
  document.getElementById('video-modal-title').textContent = 'Edit Video';
  document.getElementById('video-edit-id').value = id;
  document.getElementById('vid-uid').value = v.cloudflare_uid || '';
  document.getElementById('vid-uid-hidden').value = v.cloudflare_uid || '';
  delete document.getElementById('vid-uid-hidden').dataset.duration;
  document.getElementById('vid-title').value = v.title || '';
  document.getElementById('vid-desc').value = v.description || '';
  document.getElementById('vid-thumb').value = v.thumbnail_url || '';
  document.getElementById('vid-published').checked = v.published !== false;
  document.getElementById('vid-learner-only').checked = v.learner_only === true;
  document.getElementById('vid-file').value = '';
  document.getElementById('vid-upload-progress').style.display = 'none';
  document.getElementById('vid-upload-section').style.display = '';
  document.getElementById('vid-manual-uid').style.display = 'none';
  document.getElementById('vid-manual-toggle').textContent = 'Or enter UID manually';
  populateVideoCatSelect(v.category_slug);
  // Show preview for existing video
  if (v.cloudflare_uid) showVideoPreview(v.cloudflare_uid);
  else hideVideoPreview();
  openModal('modal-video');
}

function populateVideoCatSelect(selected) {
  const sel = document.getElementById('vid-category');
  sel.innerHTML = videoCategoriesCache.map(c =>
    '<option value="' + c.slug + '"' + (c.slug === selected ? ' selected' : '') + '>' + esc(c.label) + '</option>'
  ).join('');
}

async function saveVideo() {
  if (videoUploading) { toast('Please wait for upload to finish', 'error'); return; }

  const editId = document.getElementById('video-edit-id').value;
  const uid = getVideoUid();
  const body = {
    cloudflare_uid: uid,
    title: document.getElementById('vid-title').value.trim(),
    description: document.getElementById('vid-desc').value.trim() || null,
    category_slug: document.getElementById('vid-category').value,
    thumbnail_url: document.getElementById('vid-thumb').value.trim() || null,
    published: document.getElementById('vid-published').checked,
    learner_only: document.getElementById('vid-learner-only').checked
  };

  // Attach duration if available from upload
  const dur = document.getElementById('vid-uid-hidden').dataset.duration;
  if (dur) body.duration_seconds = parseInt(dur);

  if (!body.cloudflare_uid || !body.title || !body.category_slug) {
    toast('Cloudflare UID, title and category are required', 'error');
    return;
  }

  try {
    let url;
    if (editId) {
      url = '/api/videos?action=update';
      body.id = parseInt(editId);
    } else {
      url = '/api/videos?action=create';
    }
    const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    toast(editId ? 'Video updated' : 'Video added', 'success');
    hideVideoPreview();
    closeModal('modal-video');
    loadVideos();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteVideo(id) {
  if (!confirm('Delete this video? This will also remove it from Cloudflare.')) return;
  try {
    const res = await fetchAdmin('/api/videos?action=delete', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ id })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
    toast('Video deleted', 'success');
    bulkSelected.delete(id);
    loadVideos();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Category management ──
function openCategoryModal() {
  renderCategoriesList();
  openModal('modal-categories');
}

function renderCategoriesList() {
  const el = document.getElementById('categories-list');
  if (videoCategoriesCache.length === 0) {
    el.innerHTML = '<div style="font-size:0.85rem;color:var(--muted);padding:12px 0;">No categories yet.</div>';
    return;
  }
  el.innerHTML = videoCategoriesCache.map(c =>
    '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
      '<span style="flex:1;font-weight:600;font-size:0.88rem;">' + esc(c.label) + '</span>' +
      '<span style="font-size:0.75rem;color:var(--muted);">' + c.slug + '</span>' +
      '<span style="font-size:0.75rem;color:var(--muted);">' + (c.video_count || 0) + ' videos</span>' +
      '<button class="btn btn-sm btn-danger" data-action="delete-category" data-slug="' + c.slug + '" style="padding:3px 10px;font-size:0.72rem;">Delete</button>' +
    '</div>'
  ).join('');
}

async function addCategory() {
  const slug = document.getElementById('new-cat-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const label = document.getElementById('new-cat-label').value.trim();
  if (!slug || !label) { toast('Slug and label are required', 'error'); return; }

  try {
    const res = await fetchAdmin('/api/videos?action=create-category', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ slug, label })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    document.getElementById('new-cat-slug').value = '';
    document.getElementById('new-cat-label').value = '';
    toast('Category added', 'success');
    await loadVideos();
    renderCategoriesList();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteCategory(slug) {
  if (!confirm('Delete this category? Only works if no videos use it.')) return;
  try {
    const res = await fetchAdmin('/api/videos?action=delete-category', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ slug })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    toast('Category deleted', 'success');
    await loadVideos();
    renderCategoriesList();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Escape HTML ───────────────────────────────────────────────────
// ── Lesson Types ─────────────────────────────────────────────────
let lessonTypesCache = [];

async function loadLessonTypes() {
  const body = document.getElementById('lesson-types-body');
  body.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
  try {
    const res = await fetchAdmin('/api/lesson-types?action=all', { headers: HEADERS });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error);
    lessonTypesCache = data.lesson_types || [];
    if (!lessonTypesCache.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">No lesson types yet. Click "+ Add Type" to create one.</td></tr>';
      return;
    }
    body.innerHTML = lessonTypesCache.map(lt => {
      const hrs = lt.duration_minutes / 60;
      const hrsStr = hrs % 1 === 0 ? `${hrs} hr${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hrs`;
      return `<tr>
        <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${esc(lt.colour)};vertical-align:middle"></span></td>
        <td><strong>${esc(lt.name)}</strong></td>
        <td style="color:var(--muted);font-size:0.82rem">${esc(lt.slug)}</td>
        <td>${hrsStr}</td>
        <td>&pound;${(lt.price_pence / 100).toFixed(2)}</td>
        <td>${lt.sort_order}</td>
        <td>${lt.active ? '<span style="color:var(--green);font-weight:600">Active</span>' : '<span style="color:var(--muted)">Inactive</span>'}</td>
        <td>
          <button class="btn btn-sm" data-action="edit-lesson-type" data-id="${lt.id}">Edit</button>
          <button class="btn btn-sm ${lt.active ? 'btn-danger' : 'btn-primary'}" data-action="toggle-lesson-type" data-id="${lt.id}" data-active="${!lt.active}">
            ${lt.active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" style="color:red">${esc(err.message)}</td></tr>`;
  }
}

function openAddLessonType() {
  document.getElementById('lt-modal-title').textContent = 'Add Lesson Type';
  document.getElementById('lt-edit-id').value = '';
  document.getElementById('lt-name').value = '';
  document.getElementById('lt-slug').value = '';
  document.getElementById('lt-duration').value = '90';
  document.getElementById('lt-price').value = '';
  document.getElementById('lt-colour').value = '#3b82f6';
  document.getElementById('lt-sort').value = '0';
  document.getElementById('modal-lesson-type').classList.add('open');
}

function openEditLessonType(id) {
  const lt = lessonTypesCache.find(t => t.id === id);
  if (!lt) return;
  document.getElementById('lt-modal-title').textContent = 'Edit Lesson Type';
  document.getElementById('lt-edit-id').value = lt.id;
  document.getElementById('lt-name').value = lt.name;
  document.getElementById('lt-slug').value = lt.slug;
  document.getElementById('lt-duration').value = String(lt.duration_minutes);
  document.getElementById('lt-price').value = lt.price_pence;
  document.getElementById('lt-colour').value = lt.colour;
  document.getElementById('lt-sort').value = lt.sort_order || 0;
  document.getElementById('modal-lesson-type').classList.add('open');
}

function closeLTModal() {
  document.getElementById('modal-lesson-type').classList.remove('open');
}

async function saveLessonType() {
  const editId = document.getElementById('lt-edit-id').value;
  const payload = {
    name: document.getElementById('lt-name').value.trim(),
    slug: document.getElementById('lt-slug').value.trim(),
    duration_minutes: parseInt(document.getElementById('lt-duration').value),
    price_pence: parseInt(document.getElementById('lt-price').value),
    colour: document.getElementById('lt-colour').value,
    sort_order: parseInt(document.getElementById('lt-sort').value) || 0
  };
  if (!payload.name || !payload.slug || !payload.duration_minutes || !payload.price_pence) {
    toast('Please fill in all required fields', 'error'); return;
  }
  const action = editId ? 'update' : 'create';
  if (editId) payload.id = parseInt(editId);
  try {
    const res = await fetchAdmin(`/api/lesson-types?action=${action}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error);
    closeLTModal();
    toast(editId ? 'Lesson type updated' : 'Lesson type created', 'success');
    loadLessonTypes();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleLessonType(id, active) {
  try {
    const res = await fetchAdmin('/api/lesson-types?action=toggle', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ id, active })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error);
    toast(active ? 'Lesson type activated' : 'Lesson type deactivated', 'success');
    loadLessonTypes();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Payouts ──────────────────────────────────────────────────────
function fmtPence(p) { return '\u00A3' + (p / 100).toFixed(2); }
function fmtDateShort(d) {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' ? d.slice(0, 10) + 'T00:00:00' : d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

async function loadPayouts() {
  try {
    const res = await fetchAdmin('/api/admin?action=payout-overview');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    // Stats
    document.getElementById('payout-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${fmtPence(data.stats.this_month_pence)}</div><div class="stat-label">Paid This Month</div></div>
      <div class="stat-card"><div class="stat-value">${fmtPence(data.stats.all_time_pence)}</div><div class="stat-label">All Time</div></div>
      <div class="stat-card"><div class="stat-value">${data.stats.total_payouts}</div><div class="stat-label">Total Payouts</div></div>
      <div class="stat-card"><div class="stat-value">${data.instructors.filter(i => i.connect_status === 'active').length}</div><div class="stat-label">Connected</div></div>
    `;

    // Instructor status table
    document.getElementById('payout-instructors-body').innerHTML = data.instructors
      .filter(i => i.active)
      .map(i => {
        const statusBadge = i.connect_status === 'active'
          ? '<span style="color:#166534;font-weight:600;">&#x2705; Active</span>'
          : i.connect_status === 'pending'
          ? '<span style="color:#b45309;font-weight:600;">&#x23f3; Pending</span>'
          : '<span style="color:#6b7280;">Not started</span>';
        const pauseBtn = i.connect_status === 'active'
          ? `<button class="btn btn-sm" data-action="toggle-payout-pause" data-id="${i.id}" data-paused="${!i.payouts_paused}">${i.payouts_paused ? 'Resume' : 'Pause'}</button>`
          : '';
        const inviteBtn = i.connect_status === 'not_started'
          ? `<button class="btn btn-sm" data-action="send-connect-invite" data-id="${i.id}">Send Invite</button>`
          : '';
        const feeLabel = i.fee_model === 'franchise'
          ? `\u00A3${(i.weekly_franchise_fee_pence / 100).toFixed(0)}/wk`
          : `${Math.round((i.commission_rate || 0.85) * 100)}%`;
        return `<tr>
          <td>${esc(i.name)}</td>
          <td>${statusBadge}</td>
          <td>${esc(feeLabel)}</td>
          <td>${i.payouts_paused ? '<span style="color:#b45309;font-weight:600;">Paused</span>' : (i.connect_status === 'active' ? 'Active' : '\u2014')}</td>
          <td>${inviteBtn}${pauseBtn}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5">No active instructors</td></tr>';

    // Upcoming estimates
    document.getElementById('payout-estimates-body').innerHTML = data.estimates.length > 0
      ? data.estimates.map(e => `<tr>
          <td>${esc(e.name)}</td>
          <td>${parseInt(e.eligible_lessons) || 0}</td>
          <td style="font-weight:700;">${fmtPence(e.estimated_pence)}</td>
          <td>${e.paused ? '<span style="color:#b45309;">Paused</span>' : 'Ready'}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" style="color:var(--muted);">No pending payouts</td></tr>';

    // Recent payouts
    document.getElementById('payout-recent-body').innerHTML = data.recent_payouts.length > 0
      ? data.recent_payouts.map(p => {
          const statusClass = p.status === 'completed' ? 'color:#166534' : p.status === 'failed' ? 'color:#991b1b' : 'color:#1e40af';
          return `<tr>
            <td>${fmtDateShort(p.created_at)}</td>
            <td>${esc(p.instructor_name)}</td>
            <td>${parseInt(p.lesson_count) || 0}</td>
            <td style="font-weight:700;">${fmtPence(p.amount_pence)}</td>
            <td><span style="${statusClass};font-weight:600;text-transform:uppercase;font-size:0.75rem;">${esc(p.status)}</span></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" style="color:var(--muted);">No payouts yet</td></tr>';

  } catch (err) {
    console.error('Failed to load payouts:', err);
    toast('Failed to load payouts', 'error');
  }
}

async function togglePayoutPause(instructorId, paused) {
  try {
    const res = await fetchAdmin('/api/admin?action=toggle-payout-pause', {
      method: 'POST',
      body: JSON.stringify({ instructor_id: instructorId, paused })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(paused ? 'Payouts paused' : 'Payouts resumed', 'success');
    loadPayouts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendConnectInvite(instructorId) {
  if (!confirm('Send a Stripe Connect onboarding email to this instructor?')) return;
  try {
    const res = await fetchAdmin('/api/connect?action=admin-send-invite', {
      method: 'POST',
      body: JSON.stringify({ instructor_id: instructorId })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || data.error);
    toast('Onboarding invite sent!', 'success');
    loadPayouts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function processPayoutsNow() {
  if (!confirm('Process payouts for all eligible instructors now? This will create Stripe transfers immediately.')) return;
  const btn = document.getElementById('btn-process-payouts');
  btn.textContent = 'Processing...';
  btn.disabled = true;
  try {
    const res = await fetchAdmin('/api/admin?action=process-payouts', {
      method: 'POST'
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const msg = `Processed: ${data.processed}, Skipped: ${data.skipped}, Failed: ${data.failed}. Total: ${fmtPence(data.total_transferred_pence)}`;
    toast(msg, data.failed > 0 ? 'error' : 'success');
    loadPayouts();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.textContent = 'Process Payouts Now';
    btn.disabled = false;
  }
}

// ── Initial load ──────────────────────────────────────────────────
loadDashboard();

// ── Delegated error listener — replaces inline onerror on dynamically
//    inserted <img data-hide-on-error>. Capture because 'error' doesn't bubble.
document.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG' && t.hasAttribute('data-hide-on-error')) t.style.display = 'none';
}, true);

// ── Event delegation (dynamically rendered handlers) ──
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'edit-instructor') openEditInstructor(parseInt(t.dataset.id, 10));
  else if (a === 'toggle-instructor') toggleInstructor(parseInt(t.dataset.id, 10), t.dataset.active === 'true');
  else if (a === 'remove-window') removeWindow(parseInt(t.dataset.idx, 10));
  else if (a === 'remove-blackout') removeBlackout(parseInt(t.dataset.idx, 10));
  else if (a === 'edit-booking') openAdminEditBooking(parseInt(t.dataset.id, 10));
  else if (a === 'mark-complete') markComplete(parseInt(t.dataset.id, 10));
  else if (a === 'show-learner-detail') showLearnerDetail(parseInt(t.dataset.id, 10));
  else if (a === 'open-adjust-credits') openAdjustCredits(t.dataset.learnerId, parseInt(t.dataset.balance, 10));
  else if (a === 'confirm-delete-learner') confirmDeleteLearner(t.dataset.id, t.dataset.name);
  else if (a === 'adj-type') setAdjustType(t.dataset.type);
  else if (a === 'close-adjust-credits') closeAdjustCredits();
  else if (a === 'submit-adjust-credits') submitAdjustCredits();
  else if (a === 'filter-video-cat') filterVideoCat(t.dataset.cat);
  else if (a === 'edit-video') openEditVideo(parseInt(t.dataset.id, 10));
  else if (a === 'delete-video') deleteVideo(parseInt(t.dataset.id, 10));
  else if (a === 'delete-category') deleteCategory(t.dataset.slug);
  else if (a === 'edit-lesson-type') openEditLessonType(parseInt(t.dataset.id, 10));
  else if (a === 'toggle-lesson-type') toggleLessonType(parseInt(t.dataset.id, 10), t.dataset.active === 'true');
  else if (a === 'toggle-payout-pause') togglePayoutPause(parseInt(t.dataset.id, 10), t.dataset.paused === 'true');
  else if (a === 'send-connect-invite') sendConnectInvite(parseInt(t.dataset.id, 10));
  else if (a === 'filter-bookings') filterBookings(t, t.dataset.status);
  else if (a === 'filter-learner-tier') filterLearnerTier(t, parseInt(t.dataset.tier, 10));
  else if (a === 'close-modal') closeModal(t.dataset.modal);
  else if (a === 'bulk-action') bulkAction(t.dataset.op);
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'toggle-select-all') toggleSelectAll(t.checked);
  else if (t.dataset.action === 'toggle-bulk-select') toggleBulkSelect(parseInt(t.dataset.id, 10), t.checked);
});
document.addEventListener('input', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'render-learners') renderLearners();
});
// ── Referrals section ──
async function loadReferrals() {
  loadReferralConfig();
  loadReferralActivity();
}

async function loadReferralConfig() {
  var form = document.getElementById('referral-settings-form');
  var loading = document.getElementById('referral-settings-loading');
  try {
    var res = await fetchAdmin('/api/admin?action=referral-config', { headers: HEADERS });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error);

    document.getElementById('ref-enabled').checked = data.referral_enabled;
    document.getElementById('ref-welcome-bonus').value = data.referral_welcome_bonus_minutes;
    document.getElementById('ref-reward').value = data.referral_reward_minutes;
    updateRefStatusBadge(data.referral_enabled);
    updateRefFieldsVisibility(data.referral_enabled);

    if (loading) loading.style.display = 'none';
    if (form) form.style.display = 'block';
  } catch (e) {
    if (loading) loading.textContent = 'Failed to load referral settings.';
    console.error('loadReferralConfig:', e);
  }
}

function updateRefStatusBadge(enabled) {
  var badge = document.getElementById('ref-status-badge');
  if (!badge) return;
  badge.textContent = enabled ? 'Active' : 'Inactive';
  badge.style.background = enabled ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.15)';
  badge.style.color = enabled ? '#16a34a' : '#6b7280';
}

function updateRefFieldsVisibility(enabled) {
  var fields = document.getElementById('ref-config-fields');
  if (fields) fields.style.opacity = enabled ? '1' : '0.5';
}

async function saveReferralConfig() {
  var btn = document.getElementById('btn-save-referral-config');
  var status = document.getElementById('ref-save-status');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  var body = {
    referral_enabled: document.getElementById('ref-enabled').checked,
    referral_welcome_bonus_minutes: parseInt(document.getElementById('ref-welcome-bonus').value, 10) || 0,
    referral_reward_minutes: parseInt(document.getElementById('ref-reward').value, 10) || 0
  };

  try {
    var res = await fetchAdmin('/api/admin?action=update-referral-config', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error);

    updateRefStatusBadge(data.referral_enabled);
    updateRefFieldsVisibility(data.referral_enabled);
    if (status) { status.textContent = 'Saved!'; status.style.display = 'inline'; setTimeout(function () { status.style.display = 'none'; }, 2500); }
  } catch (e) {
    if (status) { status.textContent = 'Failed to save'; status.style.color = '#ef4444'; status.style.display = 'inline'; setTimeout(function () { status.style.display = 'none'; status.style.color = 'var(--accent)'; }, 3000); }
    console.error('saveReferralConfig:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }
}

async function loadReferralActivity() {
  var tbody = document.getElementById('referral-activity-body');
  var empty = document.getElementById('referral-empty');
  try {
    var res = await fetchAdmin('/api/admin?action=referral-activity', { headers: HEADERS });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error);

    var rows = data.referrals || [];
    if (rows.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = rows.map(function (r) {
      var hrs = (r.total_rewards_minutes / 60).toFixed(1);
      return '<tr>' +
        '<td><strong>' + (r.referrer_name || 'Unknown') + '</strong><br><span style="font-size:0.78rem;color:#888;">' + (r.referrer_email || '') + '</span></td>' +
        '<td><code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:0.85rem;">' + r.code + '</code></td>' +
        '<td>' + r.total_referred + '</td>' +
        '<td>' + hrs + ' hrs (' + r.total_rewards_minutes + ' min)</td>' +
        '</tr>';
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444;">Failed to load activity</td></tr>';
    console.error('loadReferralActivity:', e);
  }
}

// ── Sidebar nav ──
document.querySelectorAll('.sidebar-nav a[data-section]').forEach(function (a) {
  a.addEventListener('click', function (e) { e.preventDefault(); showSection(a.dataset.section); });
});
// ── Static id-based buttons ──
(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-hamburger', toggleSidebar);
  var overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.addEventListener('click', toggleSidebar);
  bind('logout-btn', logout);
  bind('btn-refresh-dashboard', loadDashboard);
  bind('btn-add-instructor', openAddInstructor);
  var availSelect = document.getElementById('avail-instructor-select');
  if (availSelect) availSelect.addEventListener('change', loadAvailability);
  bind('btn-open-add-window', openAddWindow);
  bind('btn-save-availability', saveAvailability);
  bind('btn-add-blackout', addBlackout);
  bind('btn-save-blackouts', saveBlackouts);
  bind('btn-refresh-bookings', loadBookings);
  bind('btn-open-category-modal', openCategoryModal);
  bind('btn-open-add-video', openAddVideo);
  bind('btn-refresh-learners', loadLearners);
  bind('btn-close-learner-detail', closeLearnerDetail);
  bind('btn-edit-learner', openEditLearner);
  bind('btn-save-learner', saveEditLearner);
  bind('btn-open-add-lesson-type', openAddLessonType);
  bind('btn-process-payouts', processPayoutsNow);
  bind('btn-save-referral-config', saveReferralConfig);
  var refEnabled = document.getElementById('ref-enabled');
  if (refEnabled) refEnabled.addEventListener('change', function () { updateRefFieldsVisibility(this.checked); });
  bind('btn-close-lt-modal', closeLTModal);
  bind('btn-save-lesson-type', saveLessonType);
  var vidManual = document.getElementById('vid-manual-toggle');
  if (vidManual) vidManual.addEventListener('click', toggleManualUid);
  bind('vid-save-btn', saveVideo);
  bind('btn-add-category', addCategory);
  var feeModel = document.getElementById('inst-fee-model');
  if (feeModel) feeModel.addEventListener('change', toggleFeeModelFields);
  bind('btn-save-instructor', saveInstructor);
  bind('btn-add-window', addWindow);
  bind('btn-clear-bulk', clearBulkSelection);
  var adminModal = document.getElementById('adminEditBookingModal');
  if (adminModal) adminModal.addEventListener('click', function (e) { if (e.target === adminModal) closeAdminEditBooking(); });
  var editTime = document.getElementById('adminEditTime');
  if (editTime) editTime.addEventListener('input', updateAdminEditEnd);
  var editType = document.getElementById('adminEditType');
  if (editType) editType.addEventListener('change', updateAdminEditEnd);
  bind('btn-close-admin-edit', closeAdminEditBooking);
  bind('adminEditSaveBtn', confirmAdminEditBooking);
})();
})();
