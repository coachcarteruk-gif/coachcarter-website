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
  if (name === 'refund-preview') {
    resetRefundPreviewMessages();
    loadRefundEvents();
  }
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
    scheduled: 'badge-blue', chargeable: 'badge-green', refunded: 'badge-gray',
    active: 'badge-green', inactive: 'badge-gray'
  };
  return '<span class="badge ' + (map[status] || 'badge-gray') + '">' + status + '</span>';
}

// At-a-glance Stripe Connect status for an instructor row.
// DB-only — three columns from all-instructors. Live Stripe state
// (charges_enabled / requirements) is not fetched here to avoid N+1 round-
// trips on admin pageload; instructors see their own live status on their
// earnings page, which writes stripe_onboarding_complete back to the DB.
function paymentsBadge(i) {
  if (!i.connect_has_account) {
    return '<span class="badge badge-gray" title="No Stripe Connect account">Payments: ❌</span>';
  }
  if (!i.connect_onboarding_complete) {
    return '<span class="badge badge-amber" title="Connect account started, onboarding incomplete">Payments: ⚠️</span>';
  }
  if (i.connect_payouts_paused) {
    return '<span class="badge badge-amber" title="Payouts paused (admin or instructor dismiss)">Payments: paused</span>';
  }
  return '<span class="badge badge-green" title="Payouts active">Payments: ✅</span>';
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
          '<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap;">' +
            '<strong style="font-size: 1.1rem; font-family: var(--font-head);">' + esc(i.name) + '</strong>' +
            statusBadge(i.active ? 'active' : 'inactive') +
            paymentsBadge(i) +
          '</div>' +
          '<div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 4px;">' + esc(i.email) + (i.phone ? ' &middot; ' + esc(i.phone) : '') + '</div>' +
          (i.bio ? '<div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 8px;">' + esc(i.bio) + '</div>' : '') +
          '<div style="font-size: 0.8rem; color: var(--muted);">' +
            '<span style="margin-right: 16px;">Upcoming: <strong>' + i.upcoming_bookings + '</strong></span>' +
            '<span>Completed: <strong>' + i.completed_lessons + '</strong></span>' +
          '</div>' +
          '<div style="font-size: 0.78rem; color: var(--muted); margin-top: 6px;">Availability: ' + esc(availSummary) + '</div>' +
        '</div>' +
        '<div style="display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">' +
          '<button class="btn btn-sm" data-action="edit-instructor" data-id="' + i.id + '">Edit</button>' +
          '<button class="btn btn-sm" data-action="set-password" data-id="' + i.id + '" data-name="' + esc(i.name) + '" data-has-password="' + (i.has_password ? 1 : 0) + '">' + (i.has_password ? 'Reset password' : 'Set password') + '</button>' +
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
  document.getElementById('inst-hourly-rate').value = '';
  document.getElementById('inst-bulk-tiers-enabled').checked = false;
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
  document.getElementById('inst-hourly-rate').value = i.hourly_rate_pence != null ? formatPoundsInput(i.hourly_rate_pence) : '';
  document.getElementById('inst-bulk-tiers-enabled').checked = i.bulk_tiers_enabled === true;
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
    bulk_tiers_enabled: document.getElementById('inst-bulk-tiers-enabled').checked,
  };
  const hourlyRate = parseHourlyRateOverride();
  if (hourlyRate.error) { toast(hourlyRate.error, 'error'); return; }
  body.hourly_rate_pence = hourlyRate.value;

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

    const res = await fetchAdmin(url, {
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

function formatPoundsInput(pence) {
  const pounds = Number(pence) / 100;
  return Number.isFinite(pounds) ? pounds.toFixed(2).replace(/\.00$/, '') : '';
}

function parseHourlyRateOverride() {
  const raw = document.getElementById('inst-hourly-rate').value.trim();
  if (!raw) return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Hourly rate must be a valid pounds amount, e.g. 60 or 60.00' };
  }
  const pounds = Number(raw);
  if (!Number.isFinite(pounds) || pounds <= 0 || pounds > 500) {
    return { error: 'Hourly rate override must be more than £0 and no more than £500' };
  }
  return { value: Math.round(pounds * 100) };
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

// ── Set/reset instructor password ───────────────────────────────────────────
// Opens a small modal asking the admin to type a temporary password for the
// instructor. After save, the instructor is forced to change it on next sign-in.
function openInstructorPasswordModal(instructorId, instructorName, hasPassword) {
  var existing = document.getElementById('instrPwModal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'instrPwModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;max-width:420px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.18);font-family:Lato,sans-serif;">' +
      '<h2 style="font-family:\'Bricolage Grotesque\',sans-serif;font-size:1.2rem;margin:0 0 6px;color:#262626;">' + (hasPassword ? 'Reset' : 'Set') + ' password</h2>' +
      '<p style="font-size:0.88rem;color:#666;margin:0 0 18px;line-height:1.5;">' +
        'For <strong>' + esc(instructorName) + '</strong>. They will be required to change it on next sign-in.' +
      '</p>' +
      '<div id="instrPwError" style="display:none;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:0.85rem;color:#991b1b;"></div>' +
      '<label style="display:block;font-size:0.78rem;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">New password</label>' +
      '<input type="text" id="instrPwInput" autocomplete="off" placeholder="Type a temporary password" style="width:100%;padding:11px 13px;border:1px solid #ddd;border-radius:8px;font-size:0.95rem;font-family:inherit;box-sizing:border-box;">' +
      '<div style="font-size:0.8rem;color:#888;margin-top:6px;line-height:1.4;">' +
        'At least 8 characters. Share this with the instructor — they\'ll change it on first sign-in.' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button id="instrPwCancel" style="flex:1;padding:11px;background:#f1f1f1;border:none;border-radius:8px;font-family:inherit;font-weight:600;cursor:pointer;color:#444;">Cancel</button>' +
        '<button id="instrPwSave" style="flex:2;padding:11px;background:#f58321;color:#fff;border:none;border-radius:8px;font-family:inherit;font-weight:600;cursor:pointer;">' + (hasPassword ? 'Reset' : 'Save') + ' password</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var input = document.getElementById('instrPwInput');
  var errEl = document.getElementById('instrPwError');
  setTimeout(function () { input.focus(); }, 50);

  function close() { overlay.remove(); }
  document.getElementById('instrPwCancel').onclick = close;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  async function save() {
    errEl.style.display = 'none';
    var pw = input.value;
    if (!pw || pw.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.style.display = 'block';
      return;
    }
    var saveBtn = document.getElementById('instrPwSave');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      var res = await fetchAdmin('/api/instructors?action=set-password', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ id: instructorId, password: pw })
      });
      var data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.message || data.error || 'Could not set password.';
        errEl.style.display = 'block';
        saveBtn.disabled = false; saveBtn.textContent = (hasPassword ? 'Reset' : 'Save') + ' password';
        return;
      }
      close();
      toast('Password ' + (hasPassword ? 'reset' : 'set') + ' for ' + instructorName + '. They\'ll change it on next sign-in.', 'success');
      loadInstructors();
    } catch (ex) {
      errEl.textContent = 'Network error. Please try again.';
      errEl.style.display = 'block';
      saveBtn.disabled = false; saveBtn.textContent = (hasPassword ? 'Reset' : 'Save') + ' password';
    }
  }

  document.getElementById('instrPwSave').onclick = save;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') close();
  });
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
let reservedGoodwillBookingId = null;

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

function bookingReservedLabel(b) {
  if (!b.is_reserved_weekly_slot) return '';
  return '<br><span class="badge badge-amber" title="Confirmed Reserved Weekly Slot occurrence" style="margin-top:5px;">Reserved weekly slot</span>';
}

function reservedPolicyCopy(b) {
  if (!b.is_reserved_weekly_slot) return '';
  if (b.reserved_goodwill_move_open) return 'Under 48 hours: admin exception only';
  if (b.reserved_move_policy_open) return '48+ hours: learner self-serve move available';
  return 'Reserved weekly slot';
}

function bookingActionHtml(b) {
  if (b.status !== 'scheduled') {
    return '<button class="btn btn-sm" data-action="open-refund-preview" data-id="' + b.id + '">Refund preview</button>';
  }

  if (b.is_reserved_weekly_slot) {
    var policyCopy = reservedPolicyCopy(b);
    if (b.reserved_goodwill_move_open) {
      return '<button class="btn btn-sm btn-primary" data-action="open-reserved-goodwill-move" data-id="' + b.id + '" style="margin-right:4px">Goodwill move</button>' +
        '<button class="btn btn-sm" data-action="open-refund-preview" data-id="' + b.id + '">Refund preview</button>' +
        '<div style="font-size:0.72rem;color:var(--muted);margin-top:5px;">' + esc(policyCopy) + '</div>';
    }
    return '<button class="btn btn-sm" disabled title="' + esc(policyCopy) + '" style="margin-right:4px;opacity:0.62;cursor:not-allowed;">Move reserved lesson</button>' +
      '<button class="btn btn-sm" data-action="open-refund-preview" data-id="' + b.id + '">Refund preview</button>' +
      '<div style="font-size:0.72rem;color:var(--muted);margin-top:5px;">' + esc(policyCopy) + '</div>';
  }

  return '<button class="btn btn-sm" data-action="edit-booking" data-id="' + b.id + '" title="Edit booking details" style="margin-right:4px">Reschedule lesson</button>' +
    '<button class="btn btn-sm btn-success" data-action="mark-complete" data-id="' + b.id + '" style="margin-right:4px">Complete</button>' +
    '<button class="btn btn-sm" data-action="open-refund-preview" data-id="' + b.id + '">Refund preview</button>';
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
    const typeLabel = b.lesson_type_name ? '<br><span style="font-size:0.78rem;color:var(--muted)">' + esc(b.lesson_type_name) + '</span>' : '';
    return '<tr>' +
      '<td>' + formatDate(b.scheduled_date) + '</td>' +
      '<td>' + formatTime(b.start_time) + ' – ' + formatTime(b.end_time) + typeLabel + '</td>' +
      '<td><strong>' + esc(b.learner_name) + '</strong><br><span style="font-size:0.8rem;color:var(--muted)">' + esc(b.learner_email) + '</span></td>' +
      '<td>' + esc(b.instructor_name) + '</td>' +
      '<td>' + statusBadge(b.status) + (b.edited_at ? ' <span style="font-size:0.7rem;color:var(--muted)">(edited)</span>' : '') + bookingReservedLabel(b) + '</td>' +
      '<td style="white-space:nowrap">' +
        bookingActionHtml(b) +
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
        msg += '"¢ ' + c.learner_name + ' (' + c.time + ')\n';
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

function setReservedGoodwillStatus(message, type) {
  var el = document.getElementById('reservedGoodwillStatus');
  if (!el) return;
  if (!message) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.style.display = 'block';
  el.style.background = type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)';
  el.style.color = type === 'success' ? '#166534' : '#991b1b';
}

function openReservedGoodwillMove(bookingId) {
  var b = allBookings.find(function(x) { return x.id === bookingId; });
  if (!b || !b.is_reserved_weekly_slot || !b.reserved_goodwill_move_open) {
    toast('Goodwill move is only available for reserved weekly lessons under 48 hours', 'error');
    return;
  }
  reservedGoodwillBookingId = bookingId;
  document.getElementById('reservedGoodwillSummary').innerHTML =
    '<strong>' + esc(b.learner_name) + '</strong> with ' + esc(b.instructor_name) +
    '<br>' + formatDate(b.scheduled_date) + ', ' + formatTime(b.start_time) + '-' + formatTime(b.end_time) +
    '<br><span style="color:var(--muted);">Same learner, instructor, lesson type, and duration only.</span>';
  document.getElementById('reservedGoodwillDate').value = '';
  document.getElementById('reservedGoodwillStartTime').value = '';
  document.getElementById('reservedGoodwillReason').value = '';
  setReservedGoodwillStatus('', '');
  openModal('modal-reserved-goodwill-move');
}

function closeReservedGoodwillMove() {
  reservedGoodwillBookingId = null;
  closeModal('modal-reserved-goodwill-move');
}

async function submitReservedGoodwillMove() {
  if (!reservedGoodwillBookingId) return setReservedGoodwillStatus('Select a reserved booking first.', 'error');
  var newDate = document.getElementById('reservedGoodwillDate').value;
  var newStartTime = document.getElementById('reservedGoodwillStartTime').value.slice(0, 5);
  var reason = document.getElementById('reservedGoodwillReason').value.trim();
  if (!newDate) return setReservedGoodwillStatus('Choose a replacement date.', 'error');
  if (!newStartTime) return setReservedGoodwillStatus('Choose a replacement start time.', 'error');
  if (!reason) return setReservedGoodwillStatus('Enter a reason for the audit log.', 'error');

  var btn = document.getElementById('reservedGoodwillSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Moving...';
  setReservedGoodwillStatus('', '');
  try {
    var res = await fetchAdmin('/api/admin?action=reserved-goodwill-move', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        booking_id: reservedGoodwillBookingId,
        new_date: newDate,
        new_start_time: newStartTime,
        reason: reason
      })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to goodwill move reserved lesson');
    toast('Reserved lesson moved', 'success');
    closeReservedGoodwillMove();
    loadBookings();
  } catch (err) {
    setReservedGoodwillStatus(err.message || 'Failed to goodwill move reserved lesson', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Goodwill move';
  }
}

// ══════════════════════════════════════════════════════════════════
// LEARNERS
// ══════════════════════════════════════════════════════════════════
let allLearners = [];
let currentLearnerTierFilter = 0;
let currentLearnerCategoryFilter = 'all';

const LEARNER_CATEGORY_META = {
  regular: { label: 'Regular', badge: 'badge-green' },
  sporadic: { label: 'Sporadic', badge: 'badge-amber' },
  inactive: { label: 'Inactive', badge: 'badge-gray' },
  passed: { label: 'Passed', badge: 'badge-blue' }
};

function learnerCategoryBadge(category) {
  const meta = LEARNER_CATEGORY_META[category];
  if (!meta) return '<span class="badge badge-gray">Uncategorised</span>';
  return '<span class="badge ' + meta.badge + '">' + meta.label + '</span>';
}

function learnerCategoryLabel(category) {
  return LEARNER_CATEGORY_META[category]?.label || 'Uncategorised';
}

function learnerRelationshipCategorySelect(link) {
  const value = link.relationship_category || '';
  return '<select data-action="update-learner-relationship-category" data-learner-id="' + _detailLearnerId + '" data-instructor-id="' + link.instructor_id + '" data-previous-value="' + esc(value) + '" style="min-width:130px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:#fff;font-size:0.82rem;">' +
    '<option value=""' + (value === '' ? ' selected' : '') + '>Uncategorised</option>' +
    '<option value="regular"' + (value === 'regular' ? ' selected' : '') + '>Regular</option>' +
    '<option value="sporadic"' + (value === 'sporadic' ? ' selected' : '') + '>Sporadic</option>' +
    '<option value="inactive"' + (value === 'inactive' ? ' selected' : '') + '>Inactive</option>' +
    '<option value="passed"' + (value === 'passed' ? ' selected' : '') + '>Passed</option>' +
  '</select>';
}

function formatAvailability(windows) {
  if (!windows || windows.length === 0) return 'No weekly availability set';
  return windows.map(w => DAYS[w.day_of_week] + ' ' + formatTime(w.start_time) + '-' + formatTime(w.end_time)).join(', ');
}

async function loadLearners() {
  try {
    const res = await fetchAdmin('/api/admin?action=all-learners', { headers: HEADERS });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    allLearners = data.learners;
    renderLearners();
  } catch (err) {
    document.getElementById('learners-body').innerHTML =
      '<tr><td colspan="9" class="empty-state">Failed to load learners</td></tr>';
  }
}

function filterLearnerTier(btn, tier) {
  document.querySelectorAll('#learner-filters .filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentLearnerTierFilter = tier;
  renderLearners();
}

function filterLearnerCategory(btn, category) {
  document.querySelectorAll('#learner-category-filters .filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentLearnerCategoryFilter = category || 'all';
  renderLearners();
}

function renderLearners() {
  const body = document.getElementById('learners-body');
  let filtered = allLearners;
  const search = (document.getElementById('learner-search')?.value || '').toLowerCase();

  if (currentLearnerTierFilter) {
    filtered = filtered.filter(l => l.current_tier === currentLearnerTierFilter);
  }
  if (currentLearnerCategoryFilter !== 'all') {
    filtered = filtered.filter(l => currentLearnerCategoryFilter === 'uncategorised'
      ? !l.learner_category
      : l.learner_category === currentLearnerCategoryFilter);
  }
  if (search) {
    filtered = filtered.filter(l =>
      (l.name || '').toLowerCase().includes(search) ||
      (l.email || '').toLowerCase().includes(search) ||
      (l.phone || '').toLowerCase().includes(search)
    );
  }

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="empty-state">No learners found</td></tr>';
    return;
  }

  const tierLabels = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };
  const tierClasses = { 1: 'badge-green', 2: 'badge-amber', 3: 'badge-blue' };

  body.innerHTML = filtered.map(l => {
    const tier = l.current_tier || 1;
    return '<tr style="cursor:pointer;" data-action="show-learner-detail" data-id="' + l.id + '">' +
      '<td><strong>' + esc(l.name || 'Unnamed') + '</strong><br><span style="font-size:0.78rem;color:var(--muted);">' + esc(l.email || '-') + '</span></td>' +
      '<td>' + learnerCategoryBadge(l.learner_category) + '</td>' +
      '<td>' + esc(l.primary_instructor_name || '-') + '</td>' +
      '<td>' + esc(l.phone || '-') + '</td>' +
      '<td>' + fmtBalanceMins(l.balance_minutes || 0) + '</td>' +
      '<td>' + fmtBalanceMins(l.delivered_minutes || 0) + '</td>' +
      '<td>' + (l.total_bookings || 0) + (l.upcoming_bookings ? ' <span style="color:var(--green);font-size:0.78rem;">(' + l.upcoming_bookings + ' upcoming)</span>' : '') + '</td>' +
      '<td>' + (l.next_booking_date ? formatDate(l.next_booking_date) : '-') + '</td>' +
      '<td>' + (l.last_booking_date ? formatDate(l.last_booking_date) : '-') + '</td>' +
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
    html += '<div class="stat-card"><div class="stat-value" style="font-size:1rem;">' + learnerCategoryBadge(learner?.learner_category) + '</div><div class="stat-label">Learner Type</div></div>';
    html += '<div class="stat-card"><div class="stat-value" style="font-size:1.1rem;">' + esc(learner?.primary_instructor_name || 'None') + '</div><div class="stat-label">Assigned Instructor</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (tierLabels[learner?.current_tier] || 'N/A') + '</div><div class="stat-label">Current Tier</div></div>';
    html += '<div class="stat-card" style="position:relative;">' +
      '<div class="stat-value">' + fmtBalanceMins(learner?.balance_minutes || 0) + '</div>' +
      '<div class="stat-label">Hours Balance</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
        '<button class="btn btn-sm btn-primary" data-action="open-goodwill-credit" data-learner-id="' + id + '">Grant goodwill</button>' +
        '<button class="btn btn-sm" data-action="open-adjust-credits" data-learner-id="' + id + '" data-balance="' + (learner?.balance_minutes || 0) + '">Adjust instructor balance</button>' +
      '</div>' +
      '</div>';
    html += '<div class="stat-card"><div class="stat-value">' + fmtBalanceMins(learner?.delivered_minutes || 0) + '</div><div class="stat-label">Delivered Hours</div></div>';
    html += '<div class="stat-card"><div class="stat-value" style="font-size:1.1rem;">' + (learner?.test_date ? formatDate(learner.test_date) : 'Not set') + '</div><div class="stat-label">Test Date</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (data.progress?.total_sessions || 0) + '</div><div class="stat-label">Sessions Logged</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + Math.round((data.progress?.total_minutes || 0) / 60 * 10) / 10 + 'h</div><div class="stat-label">Total Hours</div></div>';
    html += '</div>';

    html += '<div class="panel-card" style="margin-bottom:20px;">' +
      '<div class="panel-card-header"><span class="panel-card-title">Availability</span></div>' +
      '<div style="padding:16px 20px;font-size:0.9rem;color:var(--muted);">' + esc(formatAvailability(data.availability || [])) + '</div>' +
      '</div>';

    html += '<h3 style="font-family:var(--font-head);margin-bottom:12px;">Instructor Relationships</h3>';
    if (!data.instructor_links || data.instructor_links.length === 0) {
      html += '<div class="empty-state" style="margin-bottom:24px;">No instructor relationships yet</div>';
    } else {
      html += '<div class="table-wrap" style="margin-bottom:24px;"><table class="data-table"><thead><tr><th>Instructor</th><th>Relationship Type</th><th>Delivered</th><th>Upcoming</th><th>Last Booking</th><th>Test Date</th></tr></thead><tbody>';
      html += data.instructor_links.map(link =>
        '<tr><td>' + esc(link.instructor_name || '-') + '</td>' +
        '<td>' + learnerRelationshipCategorySelect(link) + '</td>' +
        '<td>' + fmtBalanceMins(link.delivered_minutes || 0) + '</td>' +
        '<td>' + (link.upcoming_lessons || 0) + '</td>' +
        '<td>' + (link.last_booking_date ? formatDate(link.last_booking_date) : '-') + '</td>' +
        '<td>' + (link.relationship_test_date ? formatDate(link.relationship_test_date) : '-') + '</td></tr>'
      ).join('');
      html += '</tbody></table></div>';
    }

    html += renderCreditReconciliationInspectionCard();

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
    html += '<button data-action="confirm-delete-learner" data-id="' + id + '" data-name="' + esc(learner?.name || learner?.email || '') + '" style="background:#e74c3c;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">🗑️ Delete Learner</button>';
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

async function populateLearnerInstructorSelect(selectedId) {
  const select = document.getElementById('learner-edit-primary-instructor');
  select.innerHTML = '<option value="">No assigned instructor</option>';
  try {
    if (!instructorsCache || instructorsCache.length === 0) {
      const res = await fetchAdmin('/api/admin?action=all-instructors', { headers: HEADERS });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      instructorsCache = data.instructors || [];
    }
    select.innerHTML = '<option value="">No assigned instructor</option>' +
      instructorsCache
        .filter(i => i.active)
        .map(i => '<option value="' + i.id + '"' + (Number(selectedId) === Number(i.id) ? ' selected' : '') + '>' + esc(i.name) + '</option>')
        .join('');
  } catch (err) {
    select.innerHTML = '<option value="">Could not load instructors</option>';
  }
}

async function openEditLearner() {
  if (!_detailLearnerId) return;
  const learner = allLearners.find(l => l.id === _detailLearnerId);
  if (!learner) return;
  document.getElementById('learner-edit-id').value = learner.id;
  document.getElementById('learner-edit-name').value = learner.name || '';
  document.getElementById('learner-edit-email').value = learner.email || '';
  document.getElementById('learner-edit-phone').value = learner.phone || '';
  document.getElementById('learner-edit-pickup').value = learner.pickup_address || '';
  document.getElementById('learner-edit-category').value = learner.learner_category || '';
  document.getElementById('learner-edit-test-date').value = learner.test_date || '';
  await populateLearnerInstructorSelect(learner.primary_instructor_id || '');
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
    pickup_address: document.getElementById('learner-edit-pickup').value.trim(),
    learner_category: document.getElementById('learner-edit-category').value || null,
    primary_instructor_id: document.getElementById('learner-edit-primary-instructor').value || null,
    test_date: document.getElementById('learner-edit-test-date').value || null
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
    await loadLearners();
    showLearnerDetail(id);
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

// ── Credit adjustment ──
async function updateLearnerRelationshipCategory(select) {
  const learnerId = parseInt(select.dataset.learnerId, 10);
  const instructorId = parseInt(select.dataset.instructorId, 10);
  if (!learnerId || !instructorId) return;
  const previous = select.dataset.previousValue || '';
  select.disabled = true;
  try {
    const res = await fetchAdmin('/api/admin?action=update-learner-relationship', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learner_id: learnerId,
        instructor_id: instructorId,
        learner_category: select.value || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    select.dataset.previousValue = select.value || '';
    toast('Relationship category saved', 'success');
    showLearnerDetail(learnerId);
  } catch (err) {
    select.value = previous;
    toast('Failed to save relationship category: ' + err.message, 'error');
  } finally {
    select.disabled = false;
  }
}

let _adjustLearnerId = null;

function fmtBalanceMins(mins) {
  const m = mins || 0;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? h + 'h ' + rem + 'm' : h + 'h';
}

async function openAdjustCredits(learnerId, balanceMinutes) {
  _adjustLearnerId = learnerId;
  const learner = allLearners.find(l => l.id === parseInt(learnerId, 10)) || {};
  let m = document.getElementById('adjust-credits-modal');
  if (m) m.remove();

  const modal = document.createElement('div');
  modal.id = 'adjust-credits-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
  modal.innerHTML = `
    <div style="background:var(--card);border-radius:16px;padding:32px;max-width:440px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
      <h3 style="font-family:var(--font-head);margin:0 0 8px;">Adjust instructor credit balance</h3>
      <p style="color:var(--muted);font-size:0.85rem;margin:0 0 16px;">Learner: <strong>${esc(learner.name || learner.email || ('#' + learnerId))}</strong><br>Total across instructors: <strong>${fmtBalanceMins(balanceMinutes)}</strong></p>
      <div class="form-group" style="margin-bottom:16px;">
        <label for="adj-instructor-select">Instructor balance to adjust</label>
        <select id="adj-instructor-select" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.9rem;box-sizing:border-box;">
          <option value="">Loading instructors...</option>
        </select>
        <div style="color:var(--muted);font-size:0.78rem;margin-top:6px;">Credit is scoped per instructor. Choose the instructor whose balance should change.</div>
      </div>
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

  try {
    const options = await ensureGoodwillInstructorOptions();
    const select = document.getElementById('adj-instructor-select');
    if (select) select.innerHTML = '<option value="">Choose instructor...</option>' + (options || '');
  } catch (err) {
    const select = document.getElementById('adj-instructor-select');
    if (select) select.innerHTML = '<option value="">Failed to load instructors</option>';
  }
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
  const instructorId = parseInt(document.getElementById('adj-instructor-select')?.value, 10);
  if (!instructorId) return alert('Choose the instructor balance to adjust');
  if (!hoursInput || hoursInput <= 0) return alert('Enter a valid number of hours');

  const hours = window._adjustType === 'add' ? hoursInput : -hoursInput;

  try {
    const res = await fetchAdmin('/api/admin?action=adjust-credits', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ learner_id: _adjustLearnerId, instructor_id: instructorId, hours, reason: reason || undefined })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'AMBIGUOUS_INSTRUCTOR' || data.code === 'AMBIGUOUS_INSTRUCTOR') {
        return alert('Choose the instructor balance to adjust, then try again.');
      }
      return alert(data.error || 'Failed to adjust instructor credit balance');
    }

    const refreshId = _adjustLearnerId;
    const newBalance = fmtBalanceMins(data.new_balance_minutes);
    alert((hours > 0 ? 'Added ' : 'Removed ') + Math.abs(hours) + 'h. New total across instructors: ' + newBalance);
    closeAdjustCredits();
    showLearnerDetail(refreshId);
    if (typeof loadLearners === 'function') loadLearners();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// GOODWILL CREDIT
// ══════════════════════════════════════════════════════════════════
function renderCreditReconciliationInspectionCard() {
  return `
    <div id="credit-reconciliation-inspection-card" style="border:1px solid var(--border);border-radius:8px;padding:16px;margin:0 0 24px;background:var(--white,#fff);">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h3 style="font-family:var(--font-head);margin:0 0 4px;font-size:1rem;">Credit reconciliation inspection</h3>
          <p style="color:var(--muted);font-size:0.82rem;margin:0;">Inspection only. This checks Stripe and existing credit transactions; no credit is granted.</p>
        </div>
        <span style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#92400e;background:#fef3c7;border-radius:999px;padding:5px 8px;font-weight:700;">Dry run</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
        <div class="form-group" style="margin:0;">
          <label for="recon-pi-id">Stripe PaymentIntent ID</label>
          <input id="recon-pi-id" type="text" autocomplete="off" placeholder="pi_..."
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.88rem;">
        </div>
        <div class="form-group" style="margin:0;">
          <label for="recon-session-id">Checkout Session ID</label>
          <input id="recon-session-id" type="text" autocomplete="off" placeholder="cs_..."
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.88rem;">
        </div>
        <div class="form-group" style="margin:0;">
          <label for="recon-charge-id">Charge ID</label>
          <input id="recon-charge-id" type="text" autocomplete="off" placeholder="ch_..."
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.88rem;">
        </div>
      </div>
      <div class="form-group" style="margin:10px 0 0;">
        <label for="recon-reason">Reason/note</label>
        <textarea id="recon-reason" placeholder="Optional operator note for this inspection"
          style="width:100%;min-height:58px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.88rem;resize:vertical;"></textarea>
      </div>
      <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:12px;">
        <div id="recon-inspection-status" style="min-height:20px;font-size:0.84rem;color:var(--muted);">Paste at least one Stripe identity to inspect.</div>
        <button class="btn btn-sm btn-primary" data-action="submit-credit-reconciliation-inspection" id="recon-inspection-btn">Inspect only</button>
      </div>
      <div id="recon-inspection-result" style="margin-top:12px;"></div>
    </div>
  `;
}

function setCreditReconciliationInspectionStatus(message, type) {
  const status = document.getElementById('recon-inspection-status');
  if (!status) return;
  status.textContent = message || '';
  status.style.color = type === 'error' ? '#991b1b' : (type === 'success' ? '#166534' : 'var(--muted)');
}

function renderReconKV(label, value) {
  return '<div><div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">' + esc(label) + '</div>' +
    '<div style="font-size:0.9rem;font-weight:700;color:var(--primary);word-break:break-word;">' + esc(value == null || value === '' ? '-' : value) + '</div></div>';
}

function renderCreditReconciliationInspectionResult(data) {
  const result = document.getElementById('recon-inspection-result');
  if (!result) return;

  const code = data.code || (data.ok ? 'INSPECTION_COMPLETE' : 'MANUAL_REVIEW');
  const message = data.message || 'Inspection complete. No credit was granted.';
  const boxStyle = 'border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);';
  const footer = '<p style="margin:10px 0 0;color:var(--muted);font-size:0.82rem;font-weight:700;">Inspection only. No credit was granted.</p>';

  if (data.ready && data.grant_preview) {
    const p = data.grant_preview;
    result.innerHTML = '<div style="' + boxStyle + '">' +
      '<div style="font-weight:800;color:#166534;margin-bottom:8px;">Ready preview: ' + esc(code) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">' +
        renderReconKV('Learner id', p.learner_id) +
        renderReconKV('Instructor id', p.instructor_id) +
        renderReconKV('Minutes', p.minutes) +
        renderReconKV('Amount', fmtPence(Number(p.amount_pence || 0))) +
        renderReconKV('Stripe fee', fmtPence(Number(p.stripe_fee_pence || 0))) +
        renderReconKV('Session id', p.stripe_session_id || data.stripe?.session_id) +
        renderReconKV('PaymentIntent id', p.stripe_payment_intent_id || data.stripe?.payment_intent_id) +
        renderReconKV('Charge id', p.stripe_charge_id || data.stripe?.charge_id) +
      '</div>' + footer + '</div>';
    return;
  }

  if (data.noop || data.code === 'ALREADY_RECONCILED') {
    result.innerHTML = '<div style="' + boxStyle + '">' +
      '<div style="font-weight:800;color:#166534;margin-bottom:8px;">Already reconciled: ' + esc(code) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">' +
        renderReconKV('Transaction id', data.transaction_id || data.existing_credit_transaction?.id) +
        renderReconKV('Created at', data.created_at ? new Date(data.created_at).toLocaleString('en-GB') : data.existing_credit_transaction?.created_at) +
      '</div>' + footer + '</div>';
    return;
  }

  result.innerHTML = '<div style="' + boxStyle + '">' +
    '<div style="font-weight:800;color:#92400e;margin-bottom:8px;">Manual review: ' + esc(code) + '</div>' +
    '<p style="margin:0;color:var(--primary);font-size:0.9rem;">' + esc(message) + '</p>' +
    footer +
  '</div>';
}

async function submitCreditReconciliationInspection() {
  const btn = document.getElementById('recon-inspection-btn');
  const paymentIntentId = document.getElementById('recon-pi-id')?.value.trim() || '';
  const sessionId = document.getElementById('recon-session-id')?.value.trim() || '';
  const chargeId = document.getElementById('recon-charge-id')?.value.trim() || '';
  const reason = document.getElementById('recon-reason')?.value.trim() || '';

  if (!paymentIntentId && !sessionId && !chargeId) {
    return setCreditReconciliationInspectionStatus('Provide a PaymentIntent, Checkout Session, or Charge ID.', 'error');
  }

  btn.disabled = true;
  btn.textContent = 'Inspecting...';
  setCreditReconciliationInspectionStatus('Inspecting only; no credit will be granted.', '');

  try {
    const res = await fetchAdmin('/api/admin?action=credit-reconciliation', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        dry_run: true,
        payment_intent_id: paymentIntentId || undefined,
        session_id: sessionId || undefined,
        charge_id: chargeId || undefined,
        reason: reason || undefined
      })
    });
    const data = await res.json();
    renderCreditReconciliationInspectionResult(data);
    if (data.ready || data.noop) {
      setCreditReconciliationInspectionStatus('Inspection complete. No credit was granted.', 'success');
    } else {
      setCreditReconciliationInspectionStatus((data.code || 'Manual review') + ': no credit was granted.', 'error');
    }
  } catch (err) {
    setCreditReconciliationInspectionStatus(err.message || 'Inspection failed. No credit was granted.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Inspect only';
  }
}

// Goodwill credit grants use the Step 5.5 per-instructor endpoint. This is
// intentionally separate from legacy pooled adjustments.
let _goodwillLearnerId = null;

async function ensureGoodwillInstructorOptions() {
  if (!instructorsCache.length) {
    const res = await fetchAdmin('/api/admin?action=all-instructors', { headers: HEADERS });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load instructors');
    instructorsCache = data.instructors || [];
  }

  return instructorsCache
    .filter(i => i && i.id && i.active !== false)
    .map(i => '<option value="' + i.id + '">' + esc(i.name || ('Instructor #' + i.id)) + '</option>')
    .join('');
}

async function openGoodwillCredit(learnerId) {
  _goodwillLearnerId = parseInt(learnerId, 10);
  const learner = allLearners.find(l => l.id === _goodwillLearnerId) || {};
  let m = document.getElementById('goodwill-credit-modal');
  if (m) m.remove();

  const modal = document.createElement('div');
  modal.id = 'goodwill-credit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
  modal.innerHTML = `
    <div style="background:var(--white,#fff);border-radius:16px;padding:28px;max-width:560px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.25);">
      <h3 style="font-family:var(--font-head);margin:0 0 6px;">Grant goodwill credit</h3>
      <p style="color:var(--muted);font-size:0.85rem;margin:0 0 18px;">Learner: <strong>${esc(learner.name || learner.email || ('#' + _goodwillLearnerId))}</strong></p>
      <div class="form-group">
        <label>Instructor</label>
        <select id="goodwill-instructor" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.9rem;">
          <option value="">Loading instructors...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Minutes</label>
        <input type="number" id="goodwill-minutes" min="1" step="15" value="90"
          style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.9rem;">
      </div>
      <div class="form-group">
        <label>Absorbed by</label>
        <div style="display:grid;gap:8px;">
          <label style="display:block;text-transform:none;letter-spacing:0;color:var(--primary);font-size:0.9rem;font-weight:600;border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;">
            <input type="radio" name="goodwill-absorbed" value="platform" checked style="margin-right:8px;accent-color:var(--accent);">
            Platform absorbed
            <span style="display:block;color:var(--muted);font-size:0.78rem;font-weight:400;margin:4px 0 0 24px;">Learner gets free credit; instructor is still paid when the lesson is delivered.</span>
          </label>
          <label style="display:block;text-transform:none;letter-spacing:0;color:var(--primary);font-size:0.9rem;font-weight:600;border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;">
            <input type="radio" name="goodwill-absorbed" value="instructor" style="margin-right:8px;accent-color:var(--accent);">
            Instructor absorbed
            <span style="display:block;color:var(--muted);font-size:0.78rem;font-weight:400;margin:4px 0 0 24px;">Learner gets free credit; the matching lesson is excluded from instructor payout.</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Reason</label>
        <textarea id="goodwill-reason" placeholder="Why is this credit being granted?"
          style="width:100%;min-height:80px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:0.9rem;resize:vertical;"></textarea>
      </div>
      <div id="goodwill-status" style="min-height:20px;font-size:0.85rem;color:var(--muted);margin-top:4px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">
        <button class="btn" data-action="close-goodwill-credit">Cancel</button>
        <button class="btn btn-primary" data-action="submit-goodwill-credit" id="goodwill-submit-btn">Grant credit</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  try {
    const options = await ensureGoodwillInstructorOptions();
    const select = document.getElementById('goodwill-instructor');
    select.innerHTML = options || '<option value="">No active instructors</option>';
  } catch (err) {
    setGoodwillStatus(err.message || 'Failed to load instructors', 'error');
  }
}

function setGoodwillStatus(message, type) {
  const status = document.getElementById('goodwill-status');
  if (!status) return;
  status.textContent = message || '';
  status.style.color = type === 'error' ? '#991b1b' : (type === 'success' ? '#166534' : 'var(--muted)');
}

function closeGoodwillCredit() {
  const m = document.getElementById('goodwill-credit-modal');
  if (m) m.remove();
  _goodwillLearnerId = null;
}

async function submitGoodwillCredit() {
  const btn = document.getElementById('goodwill-submit-btn');
  const instructorId = parseInt(document.getElementById('goodwill-instructor').value, 10);
  const minutes = parseInt(document.getElementById('goodwill-minutes').value, 10);
  const reason = document.getElementById('goodwill-reason').value.trim();
  const absorbed = document.querySelector('input[name="goodwill-absorbed"]:checked')?.value;

  if (!_goodwillLearnerId) return setGoodwillStatus('Select a learner first.', 'error');
  if (!instructorId) return setGoodwillStatus('Choose an instructor.', 'error');
  if (!minutes || minutes <= 0) return setGoodwillStatus('Enter a positive number of minutes.', 'error');
  if (!reason) return setGoodwillStatus('Enter a reason for the audit log.', 'error');

  btn.disabled = true;
  btn.textContent = 'Granting...';
  setGoodwillStatus('Granting goodwill credit...', '');

  try {
    const res = await fetchAdmin('/api/admin?action=credit-goodwill', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        learner_id: _goodwillLearnerId,
        instructor_id: instructorId,
        minutes,
        absorbed_by: absorbed,
        reason
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || 'Failed to grant goodwill credit');
    }

    setGoodwillStatus('Goodwill credit granted. New instructor balance: ' + fmtBalanceMins(data.learner_balance?.balance_minutes || 0) + '.', 'success');
    toast('Goodwill credit granted', 'success');
    const refreshId = _goodwillLearnerId;
    setTimeout(function () {
      closeGoodwillCredit();
      showLearnerDetail(refreshId);
      loadLearners();
    }, 900);
  } catch (err) {
    setGoodwillStatus(err.message || 'Failed to grant goodwill credit', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Grant credit';
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

async function loadPlatformBalance() {
  const body = document.getElementById('platform-balance-body');
  const statusEl = document.getElementById('platform-balance-status');
  if (!body) return;
  try {
    const res = await fetchAdmin('/api/admin?action=platform-balance');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const colour = data.status === 'red' ? '#991b1b' : '#166534';
    const label  = data.status === 'red'
      ? 'Next payout would fail 🚨'
      : 'Next payout would succeed';
    statusEl.textContent = label;
    statusEl.style.color = colour;

    const afterBg = data.status === 'red' ? '#fef2f2' : '#f0fdf4';
    const afterFg = data.status === 'red' ? '#991b1b' : '#166534';

    // Per-instructor rows. Empty state = nothing chargeable yet this week.
    const preview = data.payout_preview || [];
    const rowsHtml = preview.length === 0
      ? `<div style="color:#6b7280;font-style:italic;padding:8px 0;">No instructors have chargeable lessons to pay right now.</div>`
      : preview.map(p => {
          const hasStripeFee = (p.stripe_fees_pence || 0) > 0;
          const commissionPct = p.gross_pence > 0
            ? Math.round((p.amount_pence + (p.stripe_fees_pence || 0)) / p.gross_pence * 100)
            : 0;
          const breakdown = p.fee_model === 'franchise'
            ? `gross ${fmtPence(p.gross_pence)} − fee ${fmtPence(p.franchise_fee_pence || 0)}` +
              (hasStripeFee ? ` − Stripe ${fmtPence(p.stripe_fees_pence)}` : '') +
              (p.deposit_deducted_pence ? ` − deposit ${fmtPence(p.deposit_deducted_pence)}` : '') +
              (p.prior_shortfall_recovered_pence ? ` − prior shortfall ${fmtPence(p.prior_shortfall_recovered_pence)}` : '')
            : `${commissionPct}% commission of ${fmtPence(p.gross_pence)}` +
              (hasStripeFee ? ` − Stripe ${fmtPence(p.stripe_fees_pence)}` : '');
          const shortfallNote = p.shortfall_pence
            ? `<div style="font-size:0.72rem;color:#b45309;margin-top:2px;">Shortfall ${fmtPence(p.shortfall_pence)} carries forward</div>`
            : '';
          return `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;border-top:1px solid #eee;">
              <div style="min-width:0;">
                <div style="font-weight:600;">${escapeHtml(p.instructor_name)}</div>
                <div style="font-size:0.78rem;color:#6b7280;">${p.lesson_count} lesson${p.lesson_count === 1 ? '' : 's'} · ${breakdown}</div>
                ${shortfallNote}
              </div>
              <div style="font-weight:700;white-space:nowrap;">${fmtPence(p.amount_pence)}</div>
            </div>
          `;
        }).join('');

    // Advisory — instructors stuck with chargeable lessons but no payout.
    const excluded = data.excluded_instructors || [];
    const reasonLabel = {
      paused: 'payouts paused',
      no_connect: 'no Connect account',
      onboarding_incomplete: 'onboarding incomplete',
      inactive: 'inactive',
      unknown: 'blocked'
    };
    const excludedHtml = excluded.length === 0 ? '' : `
      <div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
        <div style="font-size:0.74rem;color:#92400e;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Not paid this Friday</div>
        ${excluded.map(e => `
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#78350f;padding:2px 0;">
            <span>${escapeHtml(e.name)} <span style="color:#a16207;">— ${reasonLabel[e.reason] || e.reason}</span></span>
            <span>${e.chargeable_lessons} chargeable lesson${e.chargeable_lessons === 1 ? '' : 's'}</span>
          </div>
        `).join('')}
      </div>
    `;
    const exactExposure = data.exact_refund_exposure || {};
    const legacyAdvisory = data.legacy_advisory_refund_exposure_pence ?? data.refund_exposure_pence;
    const exactWarnings = Array.isArray(exactExposure.warnings) ? exactExposure.warnings.length : 0;

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div style="padding:12px;background:#f9fafb;border-radius:6px;">
          <div style="font-size:0.74rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Stripe available</div>
          <div style="font-size:1.3rem;font-weight:700;margin-top:4px;">${fmtPence(data.available_pence)}</div>
        </div>
        <div style="padding:12px;background:#f9fafb;border-radius:6px;">
          <div style="font-size:0.74rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Pending <span style="text-transform:none;font-weight:400;color:#9ca3af;">(not counted)</span></div>
          <div style="font-size:1.3rem;font-weight:700;margin-top:4px;color:#6b7280;">${fmtPence(data.pending_pence)}</div>
        </div>
      </div>

      <div style="margin-top:14px;padding:12px;background:#fafafa;border-radius:6px;">
        <div style="font-size:0.78rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">If the cron ran right now, Stripe would transfer:</div>
        ${rowsHtml}
        <div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:6px;border-top:2px solid #ddd;font-weight:700;">
          <span>Total transferred</span>
          <span>${fmtPence(data.total_payout_pence)}</span>
        </div>
      </div>

      <div style="margin-top:14px;padding:14px;background:${afterBg};border-radius:6px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-size:0.78rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Stripe balance after payout</div>
          <div style="font-size:1.5rem;font-weight:800;color:${afterFg};">${fmtPence(data.balance_after_payout_pence)}</div>
        </div>
      </div>

      ${excludedHtml}

      <div style="margin-top:14px;padding:10px 12px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:4px;font-size:0.82rem;color:#166534;">
        <strong style="color:#14532d;">Exact unused-credit exposure:</strong>
        <strong>${fmtPence(data.exact_refund_exposure_pence || 0)}</strong>
        from source-attributed instructor balances.
        Stripe-backed cap: <strong>${fmtPence(exactExposure.stripe_cash_backed_capped_pence || 0)}</strong>;
        platform goodwill: <strong>${fmtPence(exactExposure.platform_goodwill_pence || 0)}</strong>;
        instructor-absorbed: <strong>${fmtPence(exactExposure.instructor_absorbed_pence || 0)}</strong>;
        legacy/unknown: <strong>${fmtPence((exactExposure.legacy_unknown_absorber_pence || 0) + (exactExposure.legacy_unpriced_pence || 0))}</strong>.
        ${exactWarnings ? `<span style="color:#92400e;">${exactWarnings} source warning${exactWarnings === 1 ? '' : 's'}.</span>` : ''}
      </div>

      <div style="margin-top:14px;padding:10px 12px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;font-size:0.82rem;color:#4b5563;">
        <strong style="color:#374151;">Legacy advisory:</strong> aggregate credit exposure signal
        ≈ <strong>${fmtPence(legacyAdvisory)}</strong>.
        Uses the pooled learner balance shadow at the school rate; kept only as a trend/advisory comparator and not part of payout viability above.
      </div>

      <p style="margin:12px 0 0;color:#6b7280;font-size:0.78rem;">
        Mirrors Friday's cron exactly (active + onboarded + not paused + has Connect account).
        Same franchise / commission math as <code>processPayoutForInstructor</code>, in dry-run — no payout rows or Stripe transfers are created.
      </p>
      <p style="margin:6px 0 0;color:#9ca3af;font-size:0.74rem;">
        Lesson gross uses <code>lesson_types.price_pence</code> (list rate). Most lessons are credit-funded —
        the Stripe fee was taken at credit-purchase time on a <code>credit_transactions</code> row, not on the booking.
        Per-booking effective price + proportional Stripe-fee attribution wire through in the Step 4 / 4g keystone work
        (see <code>project_next_session_priority.md</code>). Until then, the headline succeed / fail status is
        reliable but per-row amounts can be slightly higher than what the platform actually nets for bulk-pack lessons.
      </p>
    `;
  } catch (err) {
    body.innerHTML = '<span style="color:#991b1b;">Failed to load next payout preview.</span>';
    statusEl.textContent = '';
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadPayouts() {
  // Fire the balance fetch in parallel — independent network call, no need to chain.
  loadPlatformBalance();
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
// Refund execution is only exposed from a clean preview and still goes through
// the server-side execute planner; the browser never submits trusted amounts.
const REFUND_EXECUTE_CONFIRMATION = 'EXECUTE_REFUND_CONFIRMED';
const REFUND_MANUAL_BANK_CONFIRMATION = 'RECORD_MANUAL_BANK_REFUND_CONFIRMED';
const REFUND_EXECUTE_KEY_PREFIX = 'cc_refund_execute_key:';
const REFUND_MANUAL_BANK_KEY_PREFIX = 'cc_manual_bank_refund_key:';
let currentRefundPreview = null;

const REFUND_SOURCE_COPY = {
  direct_slot: {
    label: 'Lesson booking ID',
    placeholder: 'e.g. 7001',
    help: 'Enter the lesson_bookings.id for the booking being reviewed.'
  },
  direct_offer: {
    label: 'Lesson booking ID',
    placeholder: 'e.g. 7001',
    help: 'Enter the lesson_bookings.id created by the accepted offer.'
  },
  credit_purchase: {
    label: 'Credit transaction ID',
    placeholder: 'e.g. 101',
    help: 'Enter the credit_transactions.id for the original credit purchase.'
  },
  repeat_offer_partial: {
    label: 'Booking credit source ID',
    placeholder: 'e.g. 55',
    help: 'Enter the booking_credit_sources.id for the unused repeat-offer allocation.'
  },
  manual_record: {
    label: 'Reference ID',
    placeholder: 'Optional internal reference',
    help: 'Manual ledger records are not automatically previewed yet; the planner will return manual review guidance.'
  }
};

const REFUND_TYPE_GUIDANCE = {
  direct_slot: {
    meaning: 'Refund a normal paid lesson directly tied to a booking.',
    example: 'Example: learner paid for a one-off lesson by card and that specific lesson needs refunding.'
  },
  direct_offer: {
    meaning: 'Refund a lesson created from an accepted instructor offer.',
    example: 'Example: instructor sent a one-off offer link, learner paid, then that offered lesson needs refunding.'
  },
  credit_purchase: {
    meaning: 'Refund unused prepaid learner credit.',
    example: 'Example: learner bought bulk credit, used only part of it, and the unused remainder needs refunding.'
  },
  repeat_offer_partial: {
    meaning: 'Refund part of a multi-week or repeat offer series.',
    example: 'Example: learner paid for several weekly offer lessons, but some weeks could not be booked or fulfilled.'
  },
  manual_record: {
    meaning: 'Use the manual-only admin record path for cases not safe for automatic execution.',
    example: 'Example: already-paid-out booking or another case requiring manual bank review.'
  }
};

function resetRefundPreviewMessages() {
  const err = document.getElementById('refund-form-error');
  if (err) {
    err.style.display = 'none';
    err.textContent = '';
  }
  const status = document.getElementById('refund-execute-status');
  if (status) {
    status.style.display = 'none';
    status.textContent = '';
  }
  const manualStatus = document.getElementById('refund-manual-bank-status');
  if (manualStatus) {
    manualStatus.style.display = 'none';
    manualStatus.textContent = '';
  }
}

function updateRefundSourceFields() {
  const type = document.getElementById('refund-type')?.value || 'direct_slot';
  const copy = REFUND_SOURCE_COPY[type] || REFUND_SOURCE_COPY.direct_slot;
  const label = document.getElementById('refund-source-label');
  const input = document.getElementById('refund-source-id');
  const help = document.getElementById('refund-source-help');
  const typeHelp = REFUND_TYPE_GUIDANCE[type] || REFUND_TYPE_GUIDANCE.direct_slot;
  const typeMeaning = document.getElementById('refund-type-help-meaning');
  const typeExample = document.getElementById('refund-type-help-example');
  if (label) label.textContent = copy.label;
  if (input) input.placeholder = copy.placeholder;
  if (help) help.textContent = copy.help;
  if (typeMeaning) typeMeaning.textContent = typeHelp.meaning;
  if (typeExample) typeExample.textContent = typeHelp.example;
  resetRefundPreviewMessages();
}

function refundStateBadge(data) {
  if (!data || data.error) return { text: 'Error', cls: 'badge-red' };
  if (data.blocked) return { text: 'Blocked', cls: 'badge-red' };
  if (data.manual_review_required) return { text: 'Manual review', cls: 'badge-amber' };
  return { text: 'Preview ready', cls: 'badge-green' };
}

function setRefundPreviewState(data) {
  const badge = document.getElementById('refund-preview-state');
  if (!badge) return;
  const state = typeof data === 'string'
    ? { text: data, cls: data === 'Loading' ? 'badge-blue' : 'badge-gray' }
    : refundStateBadge(data);
  badge.textContent = state.text;
  badge.className = 'badge ' + state.cls;
}

function refundKv(label, value) {
  const display = value == null || value === '' ? '-' : value;
  return '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
    '<div style="font-size:0.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">' + esc(label) + '</div>' +
    '<div style="font-size:0.92rem;font-weight:700;margin-top:2px;word-break:break-word;">' + esc(display) + '</div>' +
  '</div>';
}

function refundObjectRows(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '<div style="color:var(--muted);font-size:0.86rem;">None returned</div>';
  const entries = Object.entries(obj);
  if (entries.length === 0) return '<div style="color:var(--muted);font-size:0.86rem;">None returned</div>';
  return entries.map(([key, value]) => refundKv(key, typeof value === 'object' ? JSON.stringify(value) : value)).join('');
}

function refundActionLabel(action) {
  const labels = {
    execute_eligible: 'Execute eligible',
    manual_review_required: 'Manual review required',
    blocked: 'Blocked',
    manual_bank_review_required: 'Manual bank review required'
  };
  return labels[action] || action || '-';
}

function refundPreviewHasStripeTarget(data) {
  const stripe = data?.stripe || {};
  const feeEvidence = data?.fee_evidence || {};
  return Boolean(
    stripe.stripePaymentIntentId ||
    stripe.paymentIntentId ||
    feeEvidence.paymentIntentId ||
    stripe.stripeChargeId ||
    stripe.chargeId ||
    feeEvidence.chargeId
  );
}

function refundExecuteBlockReason(data) {
  if (!data || data.error) return 'Run a successful refund preview before executing.';
  if (data.blocked) return data.message || 'This preview is blocked and must not be executed.';
  if (data.manual_review_required) return data.message || 'This preview requires manual review and must not be executed automatically.';
  if (data.recommended_operator_action === 'manual_bank_review_required') return 'Manual bank review cases cannot be executed from this UI.';
  if (data.recommended_operator_action !== 'execute_eligible') {
    return 'The planner did not mark this preview as execute eligible.';
  }
  if ((data.lines || []).some((line) => line.booking_credit_source_id)) {
    return 'Booking-credit-source refund execution is not enabled in this slice.';
  }
  if (Number(data.net_refund_pence || 0) <= 0) return 'Net refund amount must be greater than zero.';
  if (!refundPreviewHasStripeTarget(data)) return 'Stripe refund target is missing; use manual review.';
  return null;
}

function manualBankRecordBlockReason(data) {
  if (!data || data.error) return 'Run a refund preview before recording a manual bank refund.';
  if (!data.blocked && !data.manual_review_required && data.recommended_operator_action === 'execute_eligible') {
    return 'Clean original-method refunds should use Execute refund, not manual bank recording.';
  }
  if (Number(data.net_refund_pence || 0) <= 0) return 'Returned amount must be greater than zero.';
  if (!Array.isArray(data.lines) || data.lines.length === 0) return 'Preview ledger line evidence is required before manual bank recording.';
  return null;
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function refundHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildRefundExecuteFingerprint(payload, data) {
  return {
    payload,
    preview: {
      refund_type: data.refund_type,
      reason: data.reason,
      gross_refund_pence: data.gross_refund_pence,
      processing_fee_withheld_pence: data.processing_fee_withheld_pence,
      net_refund_pence: data.net_refund_pence,
      stripe: data.stripe || null,
      lines: (data.lines || []).map(function (line) {
        return {
          credit_transaction_id: line.credit_transaction_id || null,
          booking_credit_source_id: line.booking_credit_source_id || null,
          lesson_booking_id: line.lesson_booking_id || null,
          learner_id: line.learner_id || null,
          instructor_id: line.instructor_id || null,
          gross_pence_removed: line.gross_pence_removed,
          net_refund_pence: line.net_refund_pence,
          minutes_adjusted: line.minutes_adjusted || 0
        };
      })
    }
  };
}

function newRefundIdempotencyKey(fingerprintHash) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return 'refund-ui-' + fingerprintHash + '-' + window.crypto.randomUUID();
  }
  return 'refund-ui-' + fingerprintHash + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

function getRefundIdempotencyKey(payload, data, prefix) {
  const fingerprintHash = refundHash(buildRefundExecuteFingerprint(payload, data));
  const storageKey = (prefix || REFUND_EXECUTE_KEY_PREFIX) + fingerprintHash;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = newRefundIdempotencyKey(fingerprintHash);
    window.sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch (err) {
    return newRefundIdempotencyKey(fingerprintHash);
  }
}

function refundPayloadMatchesCurrentForm(payload) {
  return stableStringify(payload || {}) === stableStringify(buildRefundPreviewPayload());
}

function renderRefundOperatorContext(data) {
  const rows = [
    ['Recommended action', refundActionLabel(data.recommended_operator_action)],
    ['Learner', data.learner_name],
    ['Learner email', data.learner_email],
    ['Instructor', data.instructor_name],
    ['Booking start', data.booking_start_at],
    ['Duration', data.booking_duration_minutes ? data.booking_duration_minutes + ' minutes' : null],
    ['Payment source', data.payment_source],
    ['Payment channel', data.payment_channel]
  ];
  return rows.map(([label, value]) => refundKv(label, value)).join('');
}

function renderRefundLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '<div style="color:var(--muted);font-size:0.86rem;">No ledger lines returned by the planner.</div>';
  }
  return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>Booking</th><th>Credit tx</th><th>BCS</th><th>Learner</th><th>Instructor</th><th>Gross</th><th>Fee used</th><th>Fee withheld</th><th>Returned</th><th>Minutes</th>' +
    '</tr></thead><tbody>' +
    lines.map(function (line) {
      return '<tr>' +
        '<td>' + esc(line.lesson_booking_id || '-') + '</td>' +
        '<td>' + esc(line.credit_transaction_id || '-') + '</td>' +
        '<td>' + esc(line.booking_credit_source_id || '-') + '</td>' +
        '<td>' + esc(line.learner_id || '-') + '</td>' +
        '<td>' + esc(line.instructor_id || '-') + '</td>' +
        '<td>' + fmtPence(Number(line.gross_pence_removed || 0)) + '</td>' +
        '<td>' + fmtPence(Number(line.source_fee_pence_used || 0)) + '</td>' +
        '<td>' + fmtPence(Number(line.fee_withheld_pence || 0)) + '</td>' +
        '<td>' + fmtPence(Number(line.net_refund_pence || 0)) + '</td>' +
        '<td>' + esc(line.minutes_adjusted || 0) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

function renderRefundExecutePanel(data) {
  const blockReason = refundExecuteBlockReason(data);
  const idempotencyKey = currentRefundPreview?.idempotencyKey || '';
  if (blockReason) {
    return '<div style="border:1px solid rgba(245,158,11,0.35);background:var(--amber-bg);color:#92400e;border-radius:8px;padding:14px 16px;margin-bottom:18px;">' +
      '<div style="font-weight:800;">Execution unavailable</div>' +
      '<div style="font-size:0.88rem;line-height:1.45;margin-top:4px;">' + esc(blockReason) + '</div>' +
    '</div>';
  }

  return '<div style="border:1px solid rgba(34,197,94,0.32);background:#f0fdf4;border-radius:8px;padding:14px 16px;margin-bottom:18px;">' +
    '<div style="font-weight:800;color:#166534;">Clean preview can be executed</div>' +
    '<div style="font-size:0.88rem;line-height:1.45;color:#166534;margin-top:4px;">Use the reviewed backend execute path only after approval. The server will rerun the planner and refuse blocked or manual-review cases.</div>' +
    '<div style="margin-top:12px;padding:10px 12px;border:1px solid rgba(22,101,52,0.20);border-radius:8px;background:#fff;">' +
      '<div style="font-size:0.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Idempotency key</div>' +
      '<div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:0.8rem;word-break:break-all;margin-top:3px;">' + esc(idempotencyKey) + '</div>' +
    '</div>' +
    '<label for="refund-execute-confirmation" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#166534;margin-top:12px;margin-bottom:6px;">Confirmation phrase</label>' +
    '<input id="refund-execute-confirmation" data-action="validate-refund-execute-confirmation" autocomplete="off" placeholder="' + esc(REFUND_EXECUTE_CONFIRMATION) + '" style="width:100%;padding:10px 12px;border:1px solid rgba(22,101,52,0.25);border-radius:8px;background:#fff;font-size:0.9rem;">' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;">' +
      '<button type="button" class="btn btn-primary" id="btn-execute-refund" data-action="execute-refund" disabled>Execute refund</button>' +
      '<span style="font-size:0.82rem;color:#166534;">Requires exact phrase. Amount and scope stay server-authoritative.</span>' +
    '</div>' +
    '<div id="refund-execute-status" role="alert" style="display:none;margin-top:12px;padding:10px 12px;border-radius:8px;font-size:0.86rem;font-weight:700;"></div>' +
  '</div>';
}

function renderManualBankRecordPanel(data) {
  const blockReason = manualBankRecordBlockReason(data);
  const idempotencyKey = currentRefundPreview?.manualBankIdempotencyKey || '';
  if (blockReason) return '';

  return '<div style="border:1px solid rgba(245,158,11,0.35);background:var(--amber-bg);border-radius:8px;padding:14px 16px;margin-bottom:18px;">' +
    '<div style="font-weight:800;color:#92400e;">Manual bank refund can be recorded</div>' +
    '<div style="font-size:0.88rem;line-height:1.45;color:#92400e;margin-top:4px;">Use this only after the bank refund has been approved and completed outside Stripe. This records ledger evidence only; it does not call Stripe, change bookings, edit payouts, or mutate learner credit.</div>' +
    '<div style="margin-top:12px;padding:10px 12px;border:1px solid rgba(146,64,14,0.20);border-radius:8px;background:#fff;">' +
      '<div style="font-size:0.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Manual idempotency key</div>' +
      '<div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:0.8rem;word-break:break-all;margin-top:3px;">' + esc(idempotencyKey) + '</div>' +
    '</div>' +
    '<label for="refund-manual-bank-reference" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#92400e;margin-top:12px;margin-bottom:6px;">Bank reference</label>' +
    '<input id="refund-manual-bank-reference" data-action="validate-manual-bank-refund" autocomplete="off" placeholder="Bank transfer reference" style="width:100%;padding:10px 12px;border:1px solid rgba(146,64,14,0.25);border-radius:8px;background:#fff;font-size:0.9rem;">' +
    '<label for="refund-manual-bank-evidence" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#92400e;margin-top:12px;margin-bottom:6px;">Evidence reference</label>' +
    '<input id="refund-manual-bank-evidence" autocomplete="off" placeholder="Bank screenshot, statement line, or approval reference" maxlength="500" style="width:100%;padding:10px 12px;border:1px solid rgba(146,64,14,0.25);border-radius:8px;background:#fff;font-size:0.9rem;">' +
    '<label for="refund-manual-bank-note" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#92400e;margin-top:12px;margin-bottom:6px;">Operator note</label>' +
    '<textarea id="refund-manual-bank-note" placeholder="Optional operational note for this manual refund record" maxlength="1000" rows="3" style="width:100%;padding:10px 12px;border:1px solid rgba(146,64,14,0.25);border-radius:8px;background:#fff;font-size:0.9rem;resize:vertical;"></textarea>' +
    '<label for="refund-manual-bank-confirmation" style="display:block;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#92400e;margin-top:12px;margin-bottom:6px;">Confirmation phrase</label>' +
    '<input id="refund-manual-bank-confirmation" data-action="validate-manual-bank-refund" autocomplete="off" placeholder="' + esc(REFUND_MANUAL_BANK_CONFIRMATION) + '" style="width:100%;padding:10px 12px;border:1px solid rgba(146,64,14,0.25);border-radius:8px;background:#fff;font-size:0.9rem;">' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;">' +
      '<button type="button" class="btn btn-secondary" id="btn-record-manual-bank-refund" data-action="record-manual-bank-refund" disabled>Record manual bank refund</button>' +
      '<span style="font-size:0.82rem;color:#92400e;">Requires exact phrase and bank reference.</span>' +
    '</div>' +
    '<div id="refund-manual-bank-status" role="alert" style="display:none;margin-top:12px;padding:10px 12px;border-radius:8px;font-size:0.86rem;font-weight:700;"></div>' +
  '</div>';
}

function updateRefundExecuteButton() {
  const btn = document.getElementById('btn-execute-refund');
  const input = document.getElementById('refund-execute-confirmation');
  if (!btn || !input) return;
  const payloadStillMatches = currentRefundPreview && refundPayloadMatchesCurrentForm(currentRefundPreview.payload);
  btn.disabled = input.value.trim() !== REFUND_EXECUTE_CONFIRMATION || !payloadStillMatches;
}

function updateManualBankRefundButton() {
  const btn = document.getElementById('btn-record-manual-bank-refund');
  const phrase = document.getElementById('refund-manual-bank-confirmation');
  const reference = document.getElementById('refund-manual-bank-reference');
  if (!btn || !phrase || !reference) return;
  const payloadStillMatches = currentRefundPreview && refundPayloadMatchesCurrentForm(currentRefundPreview.payload);
  btn.disabled = phrase.value.trim() !== REFUND_MANUAL_BANK_CONFIRMATION || !reference.value.trim() || !payloadStillMatches;
}

function setRefundExecuteStatus(message, type) {
  const el = document.getElementById('refund-execute-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
  const palette = type === 'error'
    ? { bg: 'var(--red-bg)', fg: '#991b1b' }
    : type === 'success'
      ? { bg: 'var(--green-bg)', fg: '#166534' }
      : { bg: 'var(--amber-bg)', fg: '#92400e' };
  el.style.background = palette.bg;
  el.style.color = palette.fg;
}

function setManualBankRefundStatus(message, type) {
  const el = document.getElementById('refund-manual-bank-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
  const palette = type === 'error'
    ? { bg: 'var(--red-bg)', fg: '#991b1b' }
    : type === 'success'
      ? { bg: 'var(--green-bg)', fg: '#166534' }
      : { bg: '#fff7ed', fg: '#92400e' };
  el.style.background = palette.bg;
  el.style.color = palette.fg;
}

function renderExecutedRefundResult(data) {
  const event = data?.refund_event || {};
  const title = data.idempotent_replay
    ? 'Existing refund returned for this idempotency key.'
    : 'Refund executed through the approved backend path.';
  return '<div style="border:1px solid rgba(34,197,94,0.32);background:var(--green-bg);color:#166534;border-radius:8px;padding:14px 16px;margin-bottom:18px;">' +
      '<div style="font-weight:800;">' + esc(title) + '</div>' +
      '<div style="font-size:0.88rem;line-height:1.45;margin-top:4px;">Verify the Stripe reference and ledger lines before learner communication.</div>' +
    '</div>' +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Refund event</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;">' +
        refundKv('Refund event ID', event.id) +
        refundKv('Status', event.status) +
        refundKv('Refund type', event.refund_type) +
        refundKv('Idempotency key', event.idempotency_key) +
        refundKv('Gross refund', fmtPence(Number(event.gross_refund_pence || 0))) +
        refundKv('Processing fee withheld', fmtPence(Number(event.processing_fee_withheld_pence || 0))) +
        refundKv('Returned amount', fmtPence(Number(event.net_refund_pence || 0))) +
        refundKv('Stripe refund reference', event.stripe_refund_id || 'Not applicable') +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 10px;">Ledger line summary</h3>' +
      renderRefundLines(event.lines || []) +
    '</div>' +
    renderRefundNotesPanel(event);
}

function renderManualBankRefundResult(data) {
  const event = data?.refund_event || {};
  const metadata = event.metadata || {};
  const title = data.idempotent_replay
    ? 'Existing manual bank refund returned for this idempotency key.'
    : 'Manual bank refund recorded in the ledger.';
  return '<div style="border:1px solid rgba(34,197,94,0.32);background:var(--green-bg);color:#166534;border-radius:8px;padding:14px 16px;margin-bottom:18px;">' +
      '<div style="font-weight:800;">' + esc(title) + '</div>' +
      '<div style="font-size:0.88rem;line-height:1.45;margin-top:4px;">No Stripe refund, booking update, payout mutation, or learner-credit mutation was performed by this record path.</div>' +
    '</div>' +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Refund event</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;">' +
        refundKv('Refund event ID', event.id) +
        refundKv('Status', event.status) +
        refundKv('Refund channel', metadata.refund_channel || 'manual_bank') +
        refundKv('Refund type', event.refund_type) +
        refundKv('Manual bank reference', metadata.manual_bank_reference || '-') +
        refundKv('Evidence reference', metadata.evidence_reference || '-') +
        refundKv('Operator note', metadata.operator_note || '-') +
        refundKv('Idempotency key', event.idempotency_key) +
        refundKv('Gross refund', fmtPence(Number(event.gross_refund_pence || 0))) +
        refundKv('Processing fee withheld', fmtPence(Number(event.processing_fee_withheld_pence || 0))) +
        refundKv('Returned amount', fmtPence(Number(event.net_refund_pence || 0))) +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 10px;">Ledger line summary</h3>' +
      renderRefundLines(event.lines || []) +
    '</div>' +
    renderRefundNotesPanel(event);
}

function refundNoteTypeLabel(type) {
  const labels = {
    operator_note: 'Operator note',
    evidence: 'Evidence',
    incident: 'Incident',
    repair_decision: 'Repair decision'
  };
  return labels[type] || type || 'Note';
}

function renderRefundNotesPanel(event) {
  if (!event || !event.id) return '';
  return '<div id="refund-notes-panel" data-refund-event-id="' + esc(event.id) + '" style="border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-top:18px;">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div>' +
        '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0;">Refund notes timeline</h3>' +
        '<div style="font-size:0.84rem;color:var(--muted);margin-top:3px;">For operator context, evidence references, and incident repair decisions. Notes do not mutate refund accounting.</div>' +
      '</div>' +
      '<span class="badge badge-gray">Event #' + esc(event.id) + '</span>' +
    '</div>' +
    '<div id="refund-notes-list" style="margin-bottom:14px;color:var(--muted);font-size:0.86rem;">Loading notes...</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px;">' +
      '<div><label for="refund-note-type" style="display:block;font-size:0.74rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:5px;">Type</label>' +
        '<select id="refund-note-type" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;">' +
          '<option value="operator_note">Operator note</option>' +
          '<option value="evidence">Evidence</option>' +
          '<option value="incident">Incident</option>' +
          '<option value="repair_decision">Repair decision</option>' +
        '</select></div>' +
      '<div><label for="refund-note-incident-status" style="display:block;font-size:0.74rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:5px;">Incident status</label>' +
        '<select id="refund-note-incident-status" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;">' +
          '<option value="not_applicable">Not applicable</option>' +
          '<option value="open">Open</option>' +
          '<option value="watching">Watching</option>' +
          '<option value="resolved">Resolved</option>' +
        '</select></div>' +
      '<div><label for="refund-note-evidence" style="display:block;font-size:0.74rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:5px;">Evidence reference</label>' +
        '<input id="refund-note-evidence" maxlength="500" placeholder="Optional reference" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;"></div>' +
    '</div>' +
    '<textarea id="refund-note-body" maxlength="2000" rows="3" placeholder="Add a concise refund note..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fff;font-size:0.9rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;">' +
      '<button type="button" class="btn btn-secondary" data-action="add-refund-note">Add note</button>' +
      '<div id="refund-note-status" role="alert" style="font-size:0.84rem;font-weight:700;color:var(--muted);"></div>' +
    '</div>' +
  '</div>';
}

function renderRefundNotesTimeline(notes) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return '<div style="padding:10px 0;color:var(--muted);font-size:0.86rem;">No refund notes yet.</div>';
  }
  return notes.map(function (note) {
    return '<div style="border-top:1px solid var(--border);padding:10px 0;">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<span class="badge badge-gray">' + esc(refundNoteTypeLabel(note.note_type)) + '</span>' +
        (note.incident_status && note.incident_status !== 'not_applicable' ? '<span class="badge badge-amber">' + esc(note.incident_status) + '</span>' : '') +
        '<span style="font-size:0.78rem;color:var(--muted);">' + esc(note.created_at || '') + '</span>' +
      '</div>' +
      '<div style="font-size:0.92rem;line-height:1.45;margin-top:6px;white-space:pre-wrap;">' + esc(note.body || '') + '</div>' +
      (note.evidence_reference ? '<div style="font-size:0.82rem;color:var(--muted);margin-top:5px;">Evidence: ' + esc(note.evidence_reference) + '</div>' : '') +
      '<div style="font-size:0.78rem;color:var(--muted);margin-top:5px;">By ' + esc(note.admin_name || note.admin_email || ('admin #' + (note.created_by || '-'))) + '</div>' +
    '</div>';
  }).join('');
}

function refundEventStatusBadge(status) {
  const map = {
    executed: 'badge-green',
    blocked: 'badge-red',
    manual_review: 'badge-amber',
    previewed: 'badge-blue'
  };
  return '<span class="badge ' + (map[status] || 'badge-gray') + '">' + esc(status || '-') + '</span>';
}

function refundReadinessLabel(value) {
  const labels = {
    complete: 'Complete',
    incomplete: 'Incomplete',
    needs_manual_decision: 'Needs manual decision',
    post_refund_verification: 'Post-refund verification',
    record_evidence_and_stop_for_review: 'Record evidence and stop for review'
  };
  return labels[value] || value || '-';
}

function refundReadinessBadge(classification) {
  const map = {
    complete: 'badge-green',
    incomplete: 'badge-red',
    needs_manual_decision: 'badge-amber'
  };
  return '<span class="badge ' + (map[classification] || 'badge-gray') + '">' + esc(refundReadinessLabel(classification)) + '</span>';
}

function renderRefundReadinessList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div style="color:var(--muted);font-size:0.86rem;">' + esc(emptyText || 'None returned') + '</div>';
  }
  return '<ul style="margin:0;padding-left:18px;color:#333;font-size:0.88rem;line-height:1.5;">' +
    items.map(function (item) { return '<li><code>' + esc(item) + '</code></li>'; }).join('') +
  '</ul>';
}

function renderRefundIncidentReadiness(data) {
  const readiness = data?.readiness || {};
  const reasons = readiness.reasons || {};
  const classification = readiness.classification || 'unknown';
  return '<div style="border:1px solid var(--border);border-radius:8px;padding:14px 16px;background:#fff;margin-bottom:18px;">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div>' +
        '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0;">Incident Readiness</h3>' +
        '<div style="font-size:0.84rem;color:var(--muted);margin-top:3px;">Read-only classifier. No incident repair action exists yet.</div>' +
      '</div>' +
      refundReadinessBadge(classification) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;margin-bottom:14px;">' +
      refundKv('Classification', refundReadinessLabel(classification)) +
      refundKv('Allowed next step', refundReadinessLabel(readiness.allowed_next_step)) +
      refundKv('Repairable candidate', readiness.repairable_candidate ? 'Yes, for future reviewed repair design only' : 'No') +
      refundKv('Read-only', data?.read_only ? 'Yes' : 'Expected yes') +
    '</div>' +
    '<div style="padding:10px 12px;border-radius:8px;background:#fff7ed;color:#92400e;font-size:0.88rem;font-weight:700;line-height:1.45;margin-bottom:14px;">' +
      'This panel does not expose repair, execute, Stripe, booking, payout, credit, CSA, BCS, or ledger mutation controls.' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">' +
      '<div><h4 style="font-size:0.86rem;margin:0 0 8px;">Required evidence</h4>' + renderRefundReadinessList(readiness.required_evidence, 'No required local evidence returned.') + '</div>' +
      '<div><h4 style="font-size:0.86rem;margin:0 0 8px;">Incomplete reasons</h4>' + renderRefundReadinessList(reasons.incomplete, 'No incomplete reasons.') + '</div>' +
      '<div><h4 style="font-size:0.86rem;margin:0 0 8px;">Manual-decision reasons</h4>' + renderRefundReadinessList(reasons.manual_decision, 'No manual-decision reasons.') + '</div>' +
      '<div><h4 style="font-size:0.86rem;margin:0 0 8px;">Stop conditions</h4>' + renderRefundReadinessList(readiness.stop_conditions, 'No stop conditions returned.') + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;">' +
      '<button type="button" class="btn btn-sm" data-action="prefill-refund-note" data-note-type="incident">Add incident note</button>' +
      '<button type="button" class="btn btn-sm" data-action="prefill-refund-note" data-note-type="repair_decision">Add repair decision note</button>' +
      '<span style="font-size:0.82rem;color:var(--muted);">These only prefill the existing notes form.</span>' +
    '</div>' +
  '</div>';
}

async function loadRefundIncidentReadiness(refundEventId) {
  const panel = document.getElementById('refund-incident-readiness-panel');
  if (!panel || !refundEventId) return;
  const expectedEventId = String(refundEventId);
  panel.dataset.refundEventId = expectedEventId;
  panel.innerHTML = '<div class="empty-state" style="padding:20px 12px;">Loading incident readiness...</div>';
  try {
    const res = await fetchAdmin('/api/admin?action=refund-incident-readiness&refund_event_id=' + encodeURIComponent(refundEventId), {
      headers: HEADERS
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || data.error || 'Incident readiness failed.');
    if (panel.dataset.refundEventId !== expectedEventId) return;
    panel.innerHTML = renderRefundIncidentReadiness(data);
  } catch (err) {
    if (panel.dataset.refundEventId !== expectedEventId) return;
    panel.innerHTML = '<div style="color:#991b1b;background:var(--red-bg);border-radius:8px;padding:10px 12px;">' + esc(err.message || 'Failed to load incident readiness.') + '</div>';
  }
}

function prefillRefundNoteFromReadiness(noteType) {
  const type = document.getElementById('refund-note-type');
  const incidentStatus = document.getElementById('refund-note-incident-status');
  const body = document.getElementById('refund-note-body');
  if (type) type.value = noteType === 'repair_decision' ? 'repair_decision' : 'incident';
  if (incidentStatus) incidentStatus.value = noteType === 'repair_decision' ? 'not_applicable' : 'open';
  if (body && !body.value.trim()) {
    body.value = noteType === 'repair_decision'
      ? 'Readiness reviewed. Repair mutation remains future work; operator decision: '
      : 'Incident readiness reviewed. Evidence/status: ';
  }
  const status = document.getElementById('refund-note-status');
  if (status) {
    status.textContent = 'Review the prefilled note, then use Add note to save context only.';
    status.style.color = 'var(--muted)';
  }
  if (body) body.focus();
}

function buildRefundEventsSearchParams() {
  const params = new URLSearchParams({ action: 'refund-events' });
  const q = (document.getElementById('refund-events-q')?.value || '').trim();
  const type = document.getElementById('refund-events-type')?.value || '';
  const status = document.getElementById('refund-events-status')?.value || '';
  const recent = (document.getElementById('refund-events-recent')?.value || '').trim();
  if (q) params.set('q', q);
  if (type) params.set('refund_type', type);
  if (status) params.set('status', status);
  if (recent && !q) params.set('recent_days', recent);
  params.set('limit', '25');
  return params;
}

function renderRefundEventRows(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return '<div class="empty-state" style="padding:20px 12px;">No refund events found for those filters.</div>';
  }
  return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>Event</th><th>Created</th><th>Learner</th><th>Type</th><th>Status</th><th>Returned</th><th>References</th><th>Actions</th>' +
    '</tr></thead><tbody>' +
    events.map(function (event) {
      const refs = [
        event.stripe_refund_id ? 'Stripe ' + esc(event.stripe_refund_id) : '',
        event.idempotency_key ? 'Key ' + esc(event.idempotency_key) : ''
      ].filter(Boolean).join('<br>');
      return '<tr>' +
        '<td><strong>#' + esc(event.id) + '</strong><br><span style="font-size:0.78rem;color:var(--muted);">' + esc(event.refund_type || '-') + '</span></td>' +
        '<td>' + esc(event.created_at || '-') + '</td>' +
        '<td>' + esc(event.learner_name || ('Learner #' + (event.learner_id || '-'))) + '<br><span style="font-size:0.78rem;color:var(--muted);">' + esc(event.learner_email || '') + '</span></td>' +
        '<td>' + esc(event.refund_type || '-') + '</td>' +
        '<td>' + refundEventStatusBadge(event.status) + '</td>' +
        '<td>' + fmtPence(Number(event.net_refund_pence || 0)) + '</td>' +
        '<td style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:0.78rem;word-break:break-all;">' + (refs || '-') + '</td>' +
        '<td><button type="button" class="btn btn-sm" data-action="open-refund-event" data-id="' + esc(event.id) + '">Open</button></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

async function loadRefundEvents(e) {
  if (e) e.preventDefault();
  const results = document.getElementById('refund-events-results');
  if (!results) return;
  const detail = document.getElementById('refund-event-detail');
  const err = document.getElementById('refund-events-error');
  const state = document.getElementById('refund-events-state');
  const btn = document.getElementById('btn-refund-events-search');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  results.innerHTML = '<div class="empty-state" style="padding:20px 12px;">Loading refund events...</div>';
  if (state) { state.textContent = 'Loading'; state.className = 'badge badge-blue'; }
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }
  try {
    const params = buildRefundEventsSearchParams();
    const res = await fetchAdmin('/api/admin?' + params.toString(), { headers: HEADERS });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || data.error || 'Refund event search failed.');
    results.innerHTML = renderRefundEventRows(data.events || []);
    if (state) {
      state.textContent = (data.events || []).length + ' found';
      state.className = 'badge badge-gray';
    }
  } catch (error) {
    results.innerHTML = '<div class="empty-state" style="padding:20px 12px;color:#991b1b;">Refund event search failed.</div>';
    if (err) {
      err.textContent = error.message || 'Refund event search failed.';
      err.style.display = 'block';
    }
    if (state) { state.textContent = 'Error'; state.className = 'badge badge-red'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Search events'; }
  }
}

function renderRefundEventDetail(data) {
  const event = data?.event || {};
  return '<div style="border-top:1px solid var(--border);padding-top:18px;">' +
    '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">' +
      '<div>' +
        '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0;">Refund event #' + esc(event.id) + '</h3>' +
        '<div style="font-size:0.84rem;color:var(--muted);margin-top:3px;">Ledger, metadata, and notes context.</div>' +
      '</div>' +
      refundEventStatusBadge(event.status) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;margin-bottom:18px;">' +
      refundKv('Learner', event.learner_name || ('Learner #' + (event.learner_id || '-'))) +
      refundKv('Learner email', event.learner_email) +
      refundKv('Refund type', event.refund_type) +
      refundKv('Idempotency key', event.idempotency_key) +
      refundKv('Stripe refund ID', event.stripe_refund_id || 'Not applicable') +
      refundKv('Stripe payment intent', event.stripe_payment_intent_id || '-') +
      refundKv('Gross refund', fmtPence(Number(event.gross_refund_pence || 0))) +
      refundKv('Processing fee withheld', fmtPence(Number(event.processing_fee_withheld_pence || 0))) +
      refundKv('Returned amount', fmtPence(Number(event.net_refund_pence || 0))) +
      refundKv('Created by', event.admin_name || event.admin_email || event.created_by) +
    '</div>' +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 10px;">Ledger lines</h3>' +
      renderRefundLines(data.lines || []) +
    '</div>' +
    '<div id="refund-incident-readiness-panel" data-refund-event-id="' + esc(event.id || '') + '">' +
      '<div class="empty-state" style="padding:20px 12px;">Incident readiness will load from the school-scoped backend classifier.</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:18px;">' +
      '<div><h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Metadata</h3>' + refundObjectRows(event.metadata) + '</div>' +
      '<div><h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Notes timeline</h3>' + renderRefundNotesTimeline(data.notes || []) + '</div>' +
    '</div>' +
    renderRefundNotesPanel(event) +
  '</div>';
}

async function openRefundEvent(refundEventId) {
  const detail = document.getElementById('refund-event-detail');
  if (!detail || !refundEventId) return;
  detail.style.display = 'block';
  detail.innerHTML = '<div class="empty-state" style="padding:20px 12px;">Loading refund event #' + esc(refundEventId) + '...</div>';
  try {
    const params = new URLSearchParams({ action: 'refund-events', refund_event_id: String(refundEventId) });
    const res = await fetchAdmin('/api/admin?' + params.toString(), { headers: HEADERS });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || data.error || 'Refund event detail failed.');
    detail.innerHTML = renderRefundEventDetail(data);
    await loadRefundIncidentReadiness(refundEventId);
    await loadRefundNotes(refundEventId);
  } catch (error) {
    detail.innerHTML = '<div style="color:#991b1b;background:var(--red-bg);border-radius:8px;padding:10px 12px;">' + esc(error.message || 'Failed to load refund event.') + '</div>';
  }
}

async function loadRefundNotes(refundEventId) {
  const list = document.getElementById('refund-notes-list');
  if (!list || !refundEventId) return;
  const expectedEventId = String(refundEventId);
  list.innerHTML = 'Loading notes...';
  try {
    const res = await fetchAdmin('/api/admin?action=refund-notes&refund_event_id=' + encodeURIComponent(refundEventId), {
      headers: HEADERS
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || data.error || 'Refund notes failed.');
    const panel = document.getElementById('refund-notes-panel');
    if (!panel || panel.dataset.refundEventId !== expectedEventId) return;
    list.innerHTML = renderRefundNotesTimeline(data.notes || []);
  } catch (err) {
    const panel = document.getElementById('refund-notes-panel');
    if (!panel || panel.dataset.refundEventId !== expectedEventId) return;
    list.innerHTML = '<div style="color:#991b1b;background:var(--red-bg);border-radius:8px;padding:10px 12px;">' + esc(err.message || 'Failed to load refund notes.') + '</div>';
  }
}

async function addRefundNoteFromPanel() {
  const panel = document.getElementById('refund-notes-panel');
  if (!panel) return;
  const refundEventId = parseInt(panel.dataset.refundEventId, 10);
  const status = document.getElementById('refund-note-status');
  const btn = panel.querySelector('[data-action="add-refund-note"]');
  const bodyEl = document.getElementById('refund-note-body');
  const body = (bodyEl?.value || '').trim();
  if (!body) {
    if (status) { status.textContent = 'Add a note before saving.'; status.style.color = '#991b1b'; }
    return;
  }

  const noteType = document.getElementById('refund-note-type')?.value || 'operator_note';
  let incidentStatus = document.getElementById('refund-note-incident-status')?.value || 'not_applicable';
  if (noteType === 'incident' && incidentStatus === 'not_applicable') incidentStatus = 'open';
  if (noteType !== 'incident') incidentStatus = 'not_applicable';
  const evidenceReference = (document.getElementById('refund-note-evidence')?.value || '').trim();
  const requestBody = {
    refund_event_id: refundEventId,
    note_type: noteType,
    incident_status: incidentStatus,
    body
  };
  if (evidenceReference) requestBody.evidence_reference = evidenceReference;

  if (status) { status.textContent = 'Saving note...'; status.style.color = 'var(--muted)'; }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding...';
  }
  try {
    const res = await fetchAdmin('/api/admin?action=add-refund-note', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(requestBody)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.message || data.error || 'Refund note failed.');
    if (bodyEl) bodyEl.value = '';
    const evidence = document.getElementById('refund-note-evidence');
    if (evidence) evidence.value = '';
    if (status) { status.textContent = 'Note added.'; status.style.color = '#166534'; }
    await loadRefundNotes(refundEventId);
  } catch (err) {
    if (status) { status.textContent = err.message || 'Failed to add note.'; status.style.color = '#991b1b'; }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Add note';
    }
  }
}

function renderRefundPreviewResult(data) {
  const result = document.getElementById('refund-preview-result');
  if (!result) return;
  setRefundPreviewState(data);

  if (data && data.error) {
    result.innerHTML = '<div style="border:1px solid rgba(239,68,68,0.28);background:var(--red-bg);color:#991b1b;border-radius:8px;padding:14px 16px;font-weight:700;">' +
      esc(data.message || 'Refund preview failed.') +
      (data.code ? '<div style="font-size:0.78rem;margin-top:6px;font-weight:600;">Code: ' + esc(data.code) + '</div>' : '') +
    '</div>';
    currentRefundPreview = null;
    return;
  }

  const blocked = Boolean(data.blocked);
  const manual = Boolean(data.manual_review_required);
  const tone = blocked ? {
    bg: 'var(--red-bg)',
    border: 'rgba(239,68,68,0.30)',
    fg: '#991b1b',
    title: 'Blocked',
    body: data.message || 'The planner blocked automatic refund handling.'
  } : manual ? {
    bg: 'var(--amber-bg)',
    border: 'rgba(245,158,11,0.35)',
    fg: '#92400e',
    title: 'Manual review required',
    body: data.message || 'The planner requires manual review before any later execution slice.'
  } : {
    bg: 'var(--green-bg)',
    border: 'rgba(34,197,94,0.32)',
    fg: '#166534',
    title: 'Preview ready',
    body: 'Server-side planner returned an itemised preview. Clean automatic cases can be executed below.'
  };

  const warnings = Array.isArray(data.warnings) && data.warnings.length
    ? '<div style="margin-top:12px;"><div style="font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Warnings</div>' +
      data.warnings.map(w => '<div style="padding:8px 10px;border-radius:6px;background:#fff7ed;color:#9a3412;font-size:0.86rem;margin-bottom:6px;">' + esc(w) + '</div>').join('') +
      '</div>'
    : '';
  const previewOnlyCopy = (!blocked && !manual)
    ? '<div style="margin:-6px 0 18px;padding:10px 12px;border-radius:8px;background:#f0fdf4;color:#166534;font-size:0.88rem;font-weight:700;">Preview only. No refund has been issued yet.</div>'
    : '';

  result.innerHTML =
    '<div style="border:1px solid ' + tone.border + ';background:' + tone.bg + ';color:' + tone.fg + ';border-radius:8px;padding:14px 16px;margin-bottom:16px;">' +
      '<div style="font-weight:800;font-size:1rem;">' + esc(tone.title) + '</div>' +
      '<div style="font-size:0.88rem;line-height:1.45;margin-top:4px;">' + esc(tone.body) + '</div>' +
      (data.code ? '<div style="font-size:0.78rem;font-weight:700;margin-top:8px;">Code: ' + esc(data.code) + '</div>' : '') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px;">' +
      '<div class="stat-card"><div class="stat-value" style="font-size:1.6rem;">' + fmtPence(Number(data.gross_refund_pence || 0)) + '</div><div class="stat-label">Gross refund</div></div>' +
      '<div class="stat-card"><div class="stat-value" style="font-size:1.6rem;">' + fmtPence(Number(data.processing_fee_withheld_pence || 0)) + '</div><div class="stat-label">Processing fee</div></div>' +
      '<div class="stat-card"><div class="stat-value" style="font-size:1.6rem;">' + fmtPence(Number(data.net_refund_pence || 0)) + '</div><div class="stat-label">Returned amount</div></div>' +
    '</div>' +
    previewOnlyCopy +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Operator context</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 16px;">' + renderRefundOperatorContext(data) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">' +
      '<span style="font-size:0.82rem;color:var(--muted);">Execute uses admin?action=execute-refund. It must not mutate booking status or payout rows.</span>' +
    '</div>' +
    renderRefundExecutePanel(data) +
    renderManualBankRecordPanel(data) +
    '<div style="margin-bottom:18px;">' +
      '<h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 10px;">Ledger line evidence</h3>' +
      renderRefundLines(data.lines) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">' +
      '<div><h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Fee evidence</h3>' + refundObjectRows(data.fee_evidence) + '</div>' +
      '<div><h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Stripe references</h3>' + refundObjectRows(data.stripe) + '</div>' +
      '<div><h3 style="font-family:var(--font-head);font-size:1rem;margin:0 0 8px;">Metadata</h3>' + refundObjectRows(data.metadata) + '</div>' +
    '</div>' +
    warnings;
}

function buildRefundPreviewPayload() {
  const type = document.getElementById('refund-type')?.value || '';
  const rawId = (document.getElementById('refund-source-id')?.value || '').trim();
  const numericId = parseInt(rawId, 10);
  const reason = (document.getElementById('refund-reason')?.value || '').trim();
  const body = { refund_type: type };
  if (reason) body.reason = reason;

  if (type === 'direct_slot' || type === 'direct_offer') body.lesson_booking_id = numericId;
  if (type === 'credit_purchase') body.credit_transaction_id = numericId;
  if (type === 'repeat_offer_partial') body.booking_credit_source_id = numericId;
  return body;
}

function openRefundPreviewFromBooking(bookingId) {
  showSection('refund-preview');
  const type = document.getElementById('refund-type');
  const source = document.getElementById('refund-source-id');
  if (type) type.value = 'direct_slot';
  updateRefundSourceFields();
  if (source) source.value = String(bookingId || '');
  const reason = document.getElementById('refund-reason');
  if (reason && !reason.value.trim()) reason.value = 'Admin refund preview for booking #' + bookingId;
}

async function submitRefundPreview(e) {
  if (e) e.preventDefault();
  resetRefundPreviewMessages();
  const err = document.getElementById('refund-form-error');
  const btn = document.getElementById('btn-refund-preview');
  const type = document.getElementById('refund-type')?.value || '';
  const requiresId = type !== 'manual_record';
  const rawId = (document.getElementById('refund-source-id')?.value || '').trim();
  if (requiresId && (!/^\d+$/.test(rawId) || parseInt(rawId, 10) <= 0)) {
    if (err) {
      err.textContent = 'Enter a valid positive numeric identifier before requesting a preview.';
      err.style.display = 'block';
    }
    return;
  }

  const result = document.getElementById('refund-preview-result');
  currentRefundPreview = null;
  if (result) {
    result.innerHTML = '<div class="empty-state" style="padding:28px 16px;">Preparing refund preview...</div>';
  }
  setRefundPreviewState('Loading');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Previewing...';
  }

  try {
    const previewPayload = buildRefundPreviewPayload();
    const res = await fetchAdmin('/api/admin?action=refund-preview', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(previewPayload)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      renderRefundPreviewResult({
        error: true,
        code: data.code || 'REFUND_PREVIEW_FAILED',
        message: data.message || data.error || 'Refund preview failed.'
      });
      return;
    }
    currentRefundPreview = {
      payload: previewPayload,
      data,
      idempotencyKey: getRefundIdempotencyKey(previewPayload, data, REFUND_EXECUTE_KEY_PREFIX),
      manualBankIdempotencyKey: getRefundIdempotencyKey(previewPayload, data, REFUND_MANUAL_BANK_KEY_PREFIX)
    };
    renderRefundPreviewResult(data);
  } catch (error) {
    currentRefundPreview = null;
    renderRefundPreviewResult({
      error: true,
      code: 'REFUND_PREVIEW_FAILED',
      message: error.message || 'Refund preview failed.'
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Preview refund';
    }
  }
}

async function executeRefundFromPreview() {
  if (!currentRefundPreview) {
    setRefundExecuteStatus('Run a clean preview before executing.', 'error');
    return;
  }
  if (!refundPayloadMatchesCurrentForm(currentRefundPreview.payload)) {
    setRefundExecuteStatus('The form changed after preview. Run a fresh preview before executing.', 'error');
    updateRefundExecuteButton();
    return;
  }
  const blockReason = refundExecuteBlockReason(currentRefundPreview.data);
  if (blockReason) {
    setRefundExecuteStatus(blockReason, 'error');
    return;
  }
  const phrase = (document.getElementById('refund-execute-confirmation')?.value || '').trim();
  if (phrase !== REFUND_EXECUTE_CONFIRMATION) {
    setRefundExecuteStatus('Type the exact confirmation phrase before executing.', 'error');
    return;
  }

  const btn = document.getElementById('btn-execute-refund');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Executing...';
  }
  setRefundExecuteStatus('Executing via admin?action=execute-refund. Keep this idempotency key with the operator evidence.', 'pending');

  try {
    const res = await fetchAdmin('/api/admin?action=execute-refund', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        ...currentRefundPreview.payload,
        idempotency_key: currentRefundPreview.idempotencyKey,
        operator_go: REFUND_EXECUTE_CONFIRMATION
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setRefundExecuteStatus((data.message || data.error || 'Refund execution failed.') + (data.code ? ' Code: ' + data.code : ''), 'error');
      return;
    }
    const result = document.getElementById('refund-preview-result');
    if (result) {
      result.innerHTML = renderExecutedRefundResult(data);
      const badge = document.getElementById('refund-preview-state');
      if (badge) {
        badge.textContent = data.idempotent_replay ? 'Idempotent replay' : 'Executed';
        badge.className = 'badge badge-green';
      }
      if (data.refund_event?.id) loadRefundNotes(data.refund_event.id);
    }
  } catch (error) {
    setRefundExecuteStatus(error.message || 'Refund execution failed.', 'error');
  } finally {
    if (btn) {
      btn.textContent = 'Execute refund';
      updateRefundExecuteButton();
    }
  }
}

async function recordManualBankRefundFromPreview() {
  if (!currentRefundPreview) {
    setManualBankRefundStatus('Run a preview before recording a manual bank refund.', 'error');
    return;
  }
  if (!refundPayloadMatchesCurrentForm(currentRefundPreview.payload)) {
    setManualBankRefundStatus('The form changed after preview. Run a fresh preview before recording.', 'error');
    updateManualBankRefundButton();
    return;
  }
  const blockReason = manualBankRecordBlockReason(currentRefundPreview.data);
  if (blockReason) {
    setManualBankRefundStatus(blockReason, 'error');
    return;
  }
  const reference = (document.getElementById('refund-manual-bank-reference')?.value || '').trim();
  if (!reference) {
    setManualBankRefundStatus('Enter the bank transfer reference before recording.', 'error');
    return;
  }
  const evidenceReference = (document.getElementById('refund-manual-bank-evidence')?.value || '').trim();
  const operatorNote = (document.getElementById('refund-manual-bank-note')?.value || '').trim();
  const phrase = (document.getElementById('refund-manual-bank-confirmation')?.value || '').trim();
  if (phrase !== REFUND_MANUAL_BANK_CONFIRMATION) {
    setManualBankRefundStatus('Type the exact manual-bank confirmation phrase before recording.', 'error');
    return;
  }

  const btn = document.getElementById('btn-record-manual-bank-refund');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Recording...';
  }
  setManualBankRefundStatus('Recording via admin?action=record-manual-bank-refund. Keep this idempotency key with the bank evidence.', 'pending');

  try {
    const requestBody = {
      ...currentRefundPreview.payload,
      idempotency_key: currentRefundPreview.manualBankIdempotencyKey,
      manual_bank_reference: reference,
      operator_go: REFUND_MANUAL_BANK_CONFIRMATION
    };
    if (evidenceReference) requestBody.evidence_reference = evidenceReference;
    if (operatorNote) requestBody.operator_note = operatorNote;

    const res = await fetchAdmin('/api/admin?action=record-manual-bank-refund', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(requestBody)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setManualBankRefundStatus((data.message || data.error || 'Manual bank refund record failed.') + (data.code ? ' Code: ' + data.code : ''), 'error');
      return;
    }
    const result = document.getElementById('refund-preview-result');
    if (result) {
      result.innerHTML = renderManualBankRefundResult(data);
      const badge = document.getElementById('refund-preview-state');
      if (badge) {
        badge.textContent = data.idempotent_replay ? 'Manual replay' : 'Manual recorded';
        badge.className = 'badge badge-green';
      }
      if (data.refund_event?.id) loadRefundNotes(data.refund_event.id);
    }
  } catch (error) {
    setManualBankRefundStatus(error.message || 'Manual bank refund record failed.', 'error');
  } finally {
    if (btn) {
      btn.textContent = 'Record manual bank refund';
      updateManualBankRefundButton();
    }
  }
}

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
  else if (a === 'set-password') openInstructorPasswordModal(parseInt(t.dataset.id, 10), t.dataset.name, t.dataset.hasPassword === '1');
  else if (a === 'remove-window') removeWindow(parseInt(t.dataset.idx, 10));
  else if (a === 'remove-blackout') removeBlackout(parseInt(t.dataset.idx, 10));
  else if (a === 'edit-booking') openAdminEditBooking(parseInt(t.dataset.id, 10));
  else if (a === 'open-reserved-goodwill-move') openReservedGoodwillMove(parseInt(t.dataset.id, 10));
  else if (a === 'close-reserved-goodwill-move') closeReservedGoodwillMove();
  else if (a === 'submit-reserved-goodwill-move') submitReservedGoodwillMove();
  else if (a === 'open-refund-preview') openRefundPreviewFromBooking(parseInt(t.dataset.id, 10));
  else if (a === 'execute-refund') executeRefundFromPreview();
  else if (a === 'record-manual-bank-refund') recordManualBankRefundFromPreview();
  else if (a === 'add-refund-note') addRefundNoteFromPanel();
  else if (a === 'open-refund-event') openRefundEvent(parseInt(t.dataset.id, 10));
  else if (a === 'prefill-refund-note') prefillRefundNoteFromReadiness(t.dataset.noteType);
  else if (a === 'mark-complete') markComplete(parseInt(t.dataset.id, 10));
  else if (a === 'show-learner-detail') showLearnerDetail(parseInt(t.dataset.id, 10));
  else if (a === 'open-adjust-credits') openAdjustCredits(t.dataset.learnerId, parseInt(t.dataset.balance, 10));
  else if (a === 'open-goodwill-credit') openGoodwillCredit(t.dataset.learnerId);
  else if (a === 'confirm-delete-learner') confirmDeleteLearner(t.dataset.id, t.dataset.name);
  else if (a === 'adj-type') setAdjustType(t.dataset.type);
  else if (a === 'close-adjust-credits') closeAdjustCredits();
  else if (a === 'submit-adjust-credits') submitAdjustCredits();
  else if (a === 'submit-credit-reconciliation-inspection') submitCreditReconciliationInspection();
  else if (a === 'close-goodwill-credit') closeGoodwillCredit();
  else if (a === 'submit-goodwill-credit') submitGoodwillCredit();
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
  else if (a === 'filter-learner-category') filterLearnerCategory(t, t.dataset.category);
  else if (a === 'close-modal') closeModal(t.dataset.modal);
  else if (a === 'bulk-action') bulkAction(t.dataset.op);
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'toggle-select-all') toggleSelectAll(t.checked);
  else if (t.dataset.action === 'toggle-bulk-select') toggleBulkSelect(parseInt(t.dataset.id, 10), t.checked);
  else if (t.dataset.action === 'update-learner-relationship-category') updateLearnerRelationshipCategory(t);
});
document.addEventListener('input', function (e) {
  if (e.target && (e.target.id === 'refund-source-id' || e.target.id === 'refund-reason')) {
    updateRefundExecuteButton();
    updateManualBankRefundButton();
  }
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'render-learners') renderLearners();
  else if (t.dataset.action === 'validate-refund-execute-confirmation') updateRefundExecuteButton();
  else if (t.dataset.action === 'validate-manual-bank-refund') updateManualBankRefundButton();
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
  var refundForm = document.getElementById('refund-preview-form');
  if (refundForm) refundForm.addEventListener('submit', submitRefundPreview);
  var refundEventsForm = document.getElementById('refund-events-search-form');
  if (refundEventsForm) refundEventsForm.addEventListener('submit', loadRefundEvents);
  var refundType = document.getElementById('refund-type');
  if (refundType) {
    refundType.addEventListener('change', function () {
      updateRefundSourceFields();
      updateRefundExecuteButton();
    });
    updateRefundSourceFields();
  }
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
  bind('btn-reset-hourly-rate', function () { document.getElementById('inst-hourly-rate').value = ''; });
  bind('btn-save-instructor', saveInstructor);
  bind('btn-add-window', addWindow);
  bind('btn-clear-bulk', clearBulkSelection);
  var adminModal = document.getElementById('adminEditBookingModal');
  if (adminModal) adminModal.addEventListener('click', function (e) { if (e.target === adminModal) closeAdminEditBooking(); });
  var reservedGoodwillModal = document.getElementById('modal-reserved-goodwill-move');
  if (reservedGoodwillModal) reservedGoodwillModal.addEventListener('click', function (e) { if (e.target === reservedGoodwillModal) closeReservedGoodwillMove(); });
  var editTime = document.getElementById('adminEditTime');
  if (editTime) editTime.addEventListener('input', updateAdminEditEnd);
  var editType = document.getElementById('adminEditType');
  if (editType) editType.addEventListener('change', updateAdminEditEnd);
  bind('btn-close-admin-edit', closeAdminEditBooking);
  bind('adminEditSaveBtn', confirmAdminEditBooking);
})();
})();
