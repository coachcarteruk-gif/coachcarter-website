(function () {
  'use strict';

// HTML-escape helper — user data from the API is never trusted.
// Every ${field} interpolation into innerHTML MUST be wrapped in esc().
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const demoBookings = [
  {
    ref: 'CC-2847',
    name: 'Sarah Johnson',
    email: 'sarah.j@email.com',
    package: 'pass_guarantee',
    packageDisplay: 'Test Ready Guarantee',
    status: 'PAID_PENDING_VERIFICATION',
    statusDisplay: 'Pending Verification',
    amount: 2400,
    licence: 'JOHNS901234AB5CD',
    testStatus: 'has_test',
    testRef: '12345678'
  },
  {
    ref: 'CC-2846',
    name: 'Mike Chen',
    email: 'mike.chen@email.com',
    package: 'bulk',
    packageDisplay: '30 Hour Package',
    status: 'PAID_PENDING_SCHEDULING',
    statusDisplay: 'Pending Scheduling',
    amount: 1620,
    licence: 'CHEN876543DC2BA',
    testStatus: 'needs_test',
    testRef: null
  },
  {
    ref: 'CC-2845',
    name: 'Emma Williams',
    email: 'emma.w@email.com',
    package: 'payg',
    packageDisplay: 'Pay As You Go',
    status: 'PAID_PENDING_SCHEDULING',
    statusDisplay: 'Pending Scheduling',
    amount: 60,
    licence: 'WILL345678EF9GH',
    testStatus: 'unsure',
    testRef: null
  }
];

function renderBookings(filter = 'all') {
  const list = document.getElementById('bookings-list');
  if (!list) return;
  
  let filtered = demoBookings;
  
  if (filter === 'pending-verification') {
    filtered = demoBookings.filter(b => b.status === 'PAID_PENDING_VERIFICATION');
  } else if (filter === 'pending-scheduling') {
    filtered = demoBookings.filter(b => b.status === 'PAID_PENDING_SCHEDULING');
  } else if (filter === 'pass-guarantee') {
    filtered = demoBookings.filter(b => b.package === 'pass_guarantee');
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No bookings found</div>';
    return;
  }

  list.innerHTML = filtered.map(booking => `
    <div class="booking-row">
      <div class="ref">${esc(booking.ref)}</div>
      <div class="customer">
        <span class="customer-name">${esc(booking.name)}</span>
        <span class="customer-email">${esc(booking.email)}</span>
      </div>
      <div class="package ${booking.package === 'pass_guarantee' ? 'pass' : ''}">${esc(booking.packageDisplay)}</div>
      <div><span class="status ${booking.status === 'PAID_PENDING_VERIFICATION' ? 'verification' : 'pending'}">${esc(booking.statusDisplay)}</span></div>
      <div class="amount">£${esc(booking.amount)}</div>
      <div class="actions">
        <button class="action-btn" data-action="view-booking" data-ref="${esc(booking.ref)}">View</button>
        ${booking.testStatus === 'has_test' ? `<button class="action-btn" data-action="verify-dvsa" data-ref="${esc(booking.ref)}">Verify DVSA</button>` : ''}
      </div>
    </div>
  `).join('');

  updateStats();
}

function updateStats() {
  const totalEl = document.getElementById('total-bookings');
  const verifyEl = document.getElementById('pending-verification');
  const scheduleEl = document.getElementById('pending-scheduling');
  const passEl = document.getElementById('pass-guarantees');
  
  if (totalEl) totalEl.textContent = demoBookings.length;
  if (verifyEl) verifyEl.textContent = demoBookings.filter(b => b.status === 'PAID_PENDING_VERIFICATION').length;
  if (scheduleEl) scheduleEl.textContent = demoBookings.filter(b => b.status === 'PAID_PENDING_SCHEDULING').length;
  if (passEl) passEl.textContent = demoBookings.filter(b => b.package === 'pass_guarantee').length;
}

function viewBooking(ref) {
  const booking = demoBookings.find(b => b.ref === ref);
  if (!booking) return;
  
  alert(`Booking: ${ref}\n\nName: ${booking.name}\nEmail: ${booking.email}\nLicence: ${booking.licence}\nTest Status: ${booking.testStatus}\nTest Ref: ${booking.testRef || 'N/A'}`);
}

function verifyDVSA(ref) {
  window.open('https://www.gov.uk/check-driving-test', '_blank');
}

function scrollToEnquiries() {
  const enquirySection = document.querySelector('div[style*="margin-top: 64px"]');
  if (enquirySection) {
    enquirySection.scrollIntoView({ behavior: 'smooth' });
  }
}
function showSection(section) {
  document.querySelector('.bookings-section').style.display = 'none';
  document.querySelector('.enquiries-section').style.display = 'none';
  document.querySelector('.instructors-section').style.display = 'none';
  ['nav-bookings','nav-enquiries','nav-instructors'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  if (section === 'bookings') {
    document.querySelector('.bookings-section').style.display = 'block';
    document.getElementById('nav-bookings').classList.add('active');
  } else if (section === 'enquiries') {
    document.querySelector('.enquiries-section').style.display = 'block';
    document.getElementById('nav-enquiries').classList.add('active');
  } else if (section === 'instructors') {
    document.querySelector('.instructors-section').style.display = 'block';
    document.getElementById('nav-instructors').classList.add('active');
    loadInstructors();
  }
}

// ── INSTRUCTOR MANAGEMENT ─────────────────────────────────
async function loadInstructors() {
  const listEl = document.getElementById('instructors-list');
  listEl.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const res = await fetchAdmin('/api/admin?action=all-instructors', { headers: ADMIN_HEADERS });
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();
    renderInstructors(data.instructors || []);
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state">Failed to load instructors.</div>';
    console.error(err);
  }
}

function renderInstructors(instructors) {
  const listEl = document.getElementById('instructors-list');
  if (!instructors.length) {
    listEl.innerHTML = '<div class="empty-state">No instructors yet. Add one to get started.</div>';
    return;
  }
  listEl.innerHTML = instructors.map(i => `
    <div class="booking-row" style="grid-template-columns: 1fr 200px 160px 100px 100px; opacity:${i.active ? 1 : 0.5};">
      <div class="customer">
        <span class="customer-name">${esc(i.name)}${!i.active ? ' <span style="font-size:0.75rem;color:var(--muted)">(inactive)</span>' : ''}</span>
        ${i.bio ? `<span class="customer-email" style="font-size:0.8rem;">${esc(i.bio.slice(0,60))}${i.bio.length>60?'…':''}</span>` : ''}
      </div>
      <div class="customer-email" style="font-size:0.9rem;">${esc(i.email)}</div>
      <div style="font-size:0.9rem;">${esc(i.phone || '—')}</div>
      <div style="font-size:0.9rem; color:var(--muted);">${esc(i.upcoming_bookings)} upcoming<br><span style="font-size:0.8rem;">${esc(i.completed_lessons)} done</span></div>
      <div class="actions">
        <button class="action-btn" data-action="edit-instructor" data-instructor='${esc(JSON.stringify(i))}'>Edit</button>
        <button class="action-btn" data-action="toggle-instructor" data-id="${parseInt(i.id)||0}" data-active="${!i.active}" style="${i.active ? 'color:var(--red)' : 'color:var(--green)'}">${i.active ? 'Deactivate' : 'Activate'}</button>
      </div>
    </div>
  `).join('');
}

function openInstructorModal(instructor) {
  document.getElementById('modalTitle').textContent = instructor ? 'Edit Instructor' : 'Add Instructor';
  document.getElementById('modalInstructorId').value = instructor ? instructor.id : '';
  document.getElementById('iName').value  = instructor?.name      || '';
  document.getElementById('iEmail').value = instructor?.email     || '';
  document.getElementById('iPhone').value = instructor?.phone     || '';
  document.getElementById('iBio').value   = instructor?.bio       || '';
  document.getElementById('iPhoto').value = instructor?.photo_url || '';
  document.getElementById('modalError').style.display = 'none';
  document.getElementById('modalError').textContent = '';
  document.getElementById('instructorModal').style.display = 'flex';
}

function closeInstructorModal() {
  document.getElementById('instructorModal').style.display = 'none';
}

async function saveInstructor() {
  const id    = document.getElementById('modalInstructorId').value;
  const name  = document.getElementById('iName').value.trim();
  const email = document.getElementById('iEmail').value.trim();
  const phone = document.getElementById('iPhone').value.trim();
  const bio   = document.getElementById('iBio').value.trim();
  const photo = document.getElementById('iPhoto').value.trim();
  const errEl = document.getElementById('modalError');
  const saveBtn = document.getElementById('modalSaveBtn');

  if (!name || !email) {
    errEl.textContent = 'Name and email are required.';
    errEl.style.display = 'block';
    return;
  }

  saveBtn.textContent = 'Saving…';
  saveBtn.disabled = true;
  errEl.style.display = 'none';

  const action = id ? 'update-instructor' : 'create-instructor';
  const body = { name, email, phone, bio, photo_url: photo };
  if (id) body.id = parseInt(id);

  try {
    const res = await fetchAdmin('/api/admin?action=' + action, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Something went wrong.';
      errEl.style.display = 'block';
      return;
    }
    closeInstructorModal();
    loadInstructors();
  } catch (err) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  } finally {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
  }
}

async function toggleInstructor(id, active) {
  const label = active ? 'activate' : 'deactivate';
  if (!confirm(`Are you sure you want to ${label} this instructor?`)) return;
  try {
    const res = await fetchAdmin('/api/admin?action=toggle-instructor', {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id, active })
    });
    if (!res.ok) throw new Error('API error');
    loadInstructors();
  } catch (err) {
    alert('Failed to update instructor status.');
  }
}

// Close modal on backdrop click
document.getElementById('instructorModal').addEventListener('click', function(e) {
  if (e.target === this) closeInstructorModal();
});
// ─────────────────────────────────────────────────────────

document.querySelectorAll('.filters .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderBookings(btn.dataset.filter);
  });
});

// Admin auth now lives in the httpOnly cc_admin cookie — browser
// attaches it automatically. fetchAdmin (from shared/admin-auth.js)
// handles credentials + CSRF header. ADMIN_HEADERS kept as a
// Content-Type-only object so existing fetchAdmin({ headers: ... })
// call sites keep working unchanged.
const adminAuth = JSON.parse(localStorage.getItem('cc_admin') || 'null');
const ADMIN_HEADERS = { 'Content-Type': 'application/json' };
const fetchAdmin = window.ccAdminAuth.fetchAuthed;

async function loadEnquiries() {
  try {
    const res = await fetchAdmin('/api/enquiries?action=list', { headers: ADMIN_HEADERS });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    
    const countEl = document.getElementById('enquiry-count');
    const listEl = document.getElementById('enquiries-list');
    
    if (!countEl || !listEl) return;
    
    if (!data.enquiries || data.enquiries.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No enquiries yet</div>';
      countEl.textContent = '0 enquiries';
      return;
    }
    
    countEl.textContent = data.enquiries.length + ' enquiry' + (data.enquiries.length !== 1 ? 'ies' : 'y');
    
    const enquiryTypeLabels = {
      'general': 'General',
      'booking': 'Booking',
      'pass-guarantee': 'Test Ready Guarantee',
      'bulk-packages': 'Bulk Package',
      'availability': 'Availability'
    };
    
    listEl.innerHTML = data.enquiries.map(e => {
      const date = new Date(e.submitted_at);
      const dateStr = date.toLocaleDateString('en-GB');
      const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const isPass = e.enquiry_type === 'pass-guarantee';
      const typeLabel = enquiryTypeLabels[e.enquiry_type] || e.enquiry_type;
      const enquiryId = parseInt(e.id) || 0;

      return '<div class="booking-row">' +
        '<div class="package ' + (isPass ? 'pass' : '') + '" style="min-width: 120px;">' + esc(typeLabel) + '</div>' +
        '<div class="customer">' +
          '<span class="customer-name">' + esc(e.name) + '</span>' +
          '<span class="customer-email">' + esc(e.email) + '</span>' +
        '</div>' +
        '<div style="min-width: 140px; font-size: 0.9rem;">' +
          '<a href="tel:' + esc(e.phone) + '" style="color: var(--primary); text-decoration: none;">' + esc(e.phone) + '</a>' +
        '</div>' +
        '<div style="min-width: 180px; font-size: 0.85rem; color: var(--muted);">' +
          dateStr + ' at ' + timeStr +
        '</div>' +
        '<div style="min-width: 100px;">' +
          '<span class="status ' + (e.status === 'new' ? 'pending' : e.status === 'contacted' ? 'scheduled' : 'verification') + '">' +
            esc(e.status) +
          '</span>' +
        '</div>' +
        '<div class="actions" style="min-width: 80px;">' +
          '<button class="action-btn" data-action="view-enquiry" data-id="' + enquiryId + '">View</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (err) {
    console.error('Failed to load enquiries:', err);
    const listEl = document.getElementById('enquiries-list');
    const countEl = document.getElementById('enquiry-count');
    if (listEl) listEl.innerHTML = '<div class="empty-state">Error loading enquiries. Check console.</div>';
    if (countEl) countEl.textContent = 'Error';
  }
}

function refreshEnquiries() {
  const listEl = document.getElementById('enquiries-list');
  if (listEl) listEl.innerHTML = '<div class="empty-state">Loading...</div>';
  loadEnquiries();
}

function viewEnquiry(id) {
  fetchAdmin('/api/enquiries?action=get&id=' + id, { headers: ADMIN_HEADERS })
    .then(res => res.json())
    .then(data => {
      const e = data.enquiry;
      const enquiryTypeLabels = {
        'general': 'General Question',
        'booking': 'Booking Enquiry',
        'pass-guarantee': 'Test Ready Guarantee Programme',
        'bulk-packages': 'Bulk Packages',
        'availability': 'Check Availability'
      };
      
      const marketingText = e.marketing_consent ? 'Yes' : 'No';
      const messageText = e.message ? '\n\nMessage:\n' + e.message : '';
      
      const action = prompt(
        'Enquiry from ' + e.name + '\n\n' +
        'Type: ' + (enquiryTypeLabels[e.enquiry_type] || e.enquiry_type) + '\n' +
        'Email: ' + e.email + '\n' +
        'Phone: ' + e.phone + '\n' +
        'Marketing: ' + marketingText +
        messageText +
        '\n\nSubmitted: ' + new Date(e.submitted_at).toLocaleString('en-GB') + '\n\n' +
        'Actions:\n1. Mark as contacted\n2. Reply via email\n3. Close\n\nEnter 1, 2, or 3:'
      );
      
      if (action === '1') {
        updateEnquiryStatus(id, 'contacted');
      } else if (action === '2') {
        window.location.href = 'mailto:' + e.email + '?subject=Re: Your enquiry to CoachCarter&body=Hi ' + e.name.split(' ')[0] + ',%0D%0A%0D%0AThank you for your enquiry about ' + (enquiryTypeLabels[e.enquiry_type] || e.enquiry_type) + '.%0D%0A%0D%0A';
        updateEnquiryStatus(id, 'contacted');
      }
    })
    .catch(err => {
      alert('Error loading enquiry details');
    });
}

async function updateEnquiryStatus(id, status) {
  try {
    const res = await fetchAdmin('/api/enquiries?action=update-status', {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: id, status: status })
    });
    
    if (res.ok) {
      refreshEnquiries();
    } else {
      alert('Failed to update status');
    }
  } catch (err) {
    alert('Error updating status');
  }
}

renderBookings();
loadEnquiries();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'view-booking') viewBooking(t.dataset.ref);
  else if (a === 'verify-dvsa') verifyDVSA(t.dataset.ref);
  else if (a === 'edit-instructor') {
    try { openInstructorModal(JSON.parse(t.dataset.instructor)); } catch (err) { console.error(err); }
  }
  else if (a === 'toggle-instructor') toggleInstructor(parseInt(t.dataset.id, 10), t.dataset.active === 'true');
  else if (a === 'view-enquiry') viewEnquiry(parseInt(t.dataset.id, 10));
});
// Sidebar nav
document.querySelectorAll('[data-section]').forEach(function (a) {
  a.addEventListener('click', function (e) { e.preventDefault(); showSection(a.dataset.section); });
});
(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-refresh-enquiries', refreshEnquiries);
  bind('btn-add-instructor', function () { openInstructorModal(null); });
  bind('btn-close-instructor-modal', closeInstructorModal);
  bind('modalSaveBtn', saveInstructor);
})();
})();
