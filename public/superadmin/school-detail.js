(function () {
  'use strict';

(function() {
  // Auth check
  const stored = localStorage.getItem('cc_admin');
  if (!stored) { window.location.href = '/admin/login.html'; return; }
  const { token } = JSON.parse(stored);
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'superadmin') {
      alert('Access denied. Superadmin role required.');
      window.location.href = '/admin/portal.html';
      return;
    }
    document.getElementById('adminName').textContent = payload.name || 'Super Admin';
    document.getElementById('adminEmail').textContent = payload.email || '';
  } catch(e) {
    window.location.href = '/admin/login.html';
    return;
  }

  // Get school ID from URL
  const params = new URLSearchParams(window.location.search);
  const schoolId = params.get('id');
  if (!schoolId) {
    window.location.href = '/superadmin/schools.html';
    return;
  }

  // API helpers — session cookie + CSRF header via fetchAuthed
  async function apiFetch(url) {
    const res = await window.ccAdminAuth.fetchAuthed(url);
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await window.ccAdminAuth.fetchAuthed(url, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return res.json();
  }

  function showMsg(elId, text, type) {
    const el = document.getElementById(elId);
    el.className = 'msg ' + (type === 'success' ? 'msg-success' : 'msg-error');
    el.textContent = text;
    setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
  }

  // Load school
  async function loadSchool() {
    try {
      const data = await apiFetch('/api/schools?action=get&school_id=' + schoolId);
      if (data.error) throw new Error(data.message || 'School not found');

      const s = data.school || data;

      document.getElementById('pageTitle').textContent = s.name || 'School Detail';
      document.getElementById('pageSubtitle').textContent = s.slug || '';

      // Stats
      document.getElementById('statLearners').textContent = s.learner_count ?? 0;
      document.getElementById('statInstructors').textContent = s.instructor_count ?? 0;
      document.getElementById('statBookings').textContent = s.booking_count ?? 0;

      // Form fields
      document.getElementById('fName').value = s.name || '';
      document.getElementById('fSlug').value = s.slug || '';
      document.getElementById('fEmail').value = s.contact_email || '';
      document.getElementById('fPhone').value = s.contact_phone || '';
      document.getElementById('fLogo').value = s.logo_url || '';
      document.getElementById('fWebsite').value = s.website_url || '';

      const pc = s.primary_colour || '#262626';
      const sc = s.secondary_colour || '#ffffff';
      const ac = s.accent_colour || '#f97316';
      document.getElementById('fPrimaryColour').value = pc;
      document.getElementById('fPrimaryColourText').value = pc;
      document.getElementById('fSecondaryColour').value = sc;
      document.getElementById('fSecondaryColourText').value = sc;
      document.getElementById('fAccentColour').value = ac;
      document.getElementById('fAccentColourText').value = ac;

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
    } catch(err) {
      document.getElementById('loading').textContent = 'Error: ' + err.message;
    }
  }

  // Save school
  window.saveSchool = async function() {
    try {
      const body = {
        school_id: parseInt(schoolId),
        name: document.getElementById('fName').value.trim(),
        slug: document.getElementById('fSlug').value.trim(),
        contact_email: document.getElementById('fEmail').value.trim(),
        contact_phone: document.getElementById('fPhone').value.trim(),
        logo_url: document.getElementById('fLogo').value.trim(),
        website_url: document.getElementById('fWebsite').value.trim(),
        primary_colour: document.getElementById('fPrimaryColourText').value.trim(),
        secondary_colour: document.getElementById('fSecondaryColourText').value.trim(),
        accent_colour: document.getElementById('fAccentColourText').value.trim()
      };
      const data = await apiPost('/api/schools?action=update', body);
      if (data.error) throw new Error(data.message);
      showMsg('saveMsg', 'School updated successfully.', 'success');
      // Update page title
      document.getElementById('pageTitle').textContent = body.name || 'School Detail';
      document.getElementById('pageSubtitle').textContent = body.slug || '';
    } catch(err) {
      showMsg('saveMsg', 'Error: ' + err.message, 'error');
    }
  };

  // Create admin
  window.createAdmin = async function() {
    const name = document.getElementById('aName').value.trim();
    const email = document.getElementById('aEmail').value.trim();
    const password = document.getElementById('aPassword').value;

    if (!name || !email || !password) {
      showMsg('adminMsg', 'All fields are required.', 'error');
      return;
    }
    if (password.length < 8) {
      showMsg('adminMsg', 'Password must be at least 8 characters.', 'error');
      return;
    }

    try {
      const data = await apiPost('/api/schools?action=create-admin', {
        school_id: parseInt(schoolId), name, email, password
      });
      if (data.error) throw new Error(data.message);
      showMsg('adminMsg', 'Admin account created successfully.', 'success');
      document.getElementById('aName').value = '';
      document.getElementById('aEmail').value = '';
      document.getElementById('aPassword').value = '';
    } catch(err) {
      showMsg('adminMsg', 'Error: ' + err.message, 'error');
    }
  };

  // Logout
  window.logout = function() {
    window.ccAdminAuth.logout();
  };

  loadSchool();
})();

document.addEventListener('input', function (e) {
  var t = e.target.closest('[data-sync-to]');
  if (!t) return;
  var target = document.getElementById(t.dataset.syncTo);
  if (target) target.value = t.value;
});
(function wire() {
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.querySelector('.sidebar-overlay');
  var hamburger = document.getElementById('btn-hamburger');
  if (hamburger && sidebar && overlay) {
    hamburger.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
  }
  if (overlay && sidebar) {
    overlay.addEventListener('click', function () {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-logout', logout);
  bind('btn-save-school', saveSchool);
  bind('btn-create-admin', createAdmin);
})();
})();
