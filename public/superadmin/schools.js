(function () {
  'use strict';

(function() {
  // Auth check — read role/name/email from the display blob mirrored in
  // localStorage at login time. The session JWT rides in the httpOnly
  // cc_admin cookie; nothing on this page needs to decode it.
  let adminData;
  try {
    adminData = JSON.parse(localStorage.getItem('cc_admin') || 'null');
  } catch (e) { adminData = null; }
  if (!adminData || !adminData.admin) {
    window.location.href = '/admin/login.html';
    return;
  }
  const admin = adminData.admin;
  if (admin.role !== 'superadmin') {
    alert('Access denied. Superadmin role required.');
    window.location.href = '/admin/portal.html';
    return;
  }
  document.getElementById('adminName').textContent = admin.name || 'Super Admin';
  document.getElementById('adminEmail').textContent = admin.email || '';

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

  // Auto-generate slug from name
  document.getElementById('schoolName').addEventListener('input', function() {
    const slug = this.value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    document.getElementById('schoolSlug').value = slug;
  });

  // Load schools
  async function loadSchools() {
    try {
      const data = await apiFetch('/api/schools?action=list');
      if (data.error) throw new Error(data.message || 'Failed to load schools');

      const schools = data.schools || [];
      const tbody = document.getElementById('schoolsBody');
      tbody.innerHTML = '';

      if (schools.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
      } else {
        document.getElementById('emptyState').style.display = 'none';
        schools.forEach(s => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${esc(s.name)}</strong></td>
            <td style="color:var(--muted); font-size:0.85rem;">${esc(s.slug)}</td>
            <td>${s.learner_count ?? 0}</td>
            <td>${s.instructor_count ?? 0}</td>
            <td>${s.booking_count ?? 0}</td>
            <td>
              <span class="badge ${s.is_active ? 'badge-green' : 'badge-red'}">
                ${s.is_active ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td>
              <a class="btn btn-sm" href="/superadmin/school-detail.html?id=${s.id}">View</a>
              <button class="btn btn-sm ${s.is_active ? 'btn-danger' : ''}" data-action="toggle-school" data-id="${s.id}" data-active="${s.is_active}">
                ${s.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
    } catch(err) {
      document.getElementById('loading').textContent = 'Error loading schools: ' + err.message;
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // Toggle school active/inactive
  window.toggleSchool = async function(id, currentlyActive) {
    const action = currentlyActive ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} this school?`)) return;
    try {
      const data = await apiPost('/api/schools?action=toggle-status', { school_id: id, is_active: !currentlyActive });
      if (data.error) throw new Error(data.message);
      loadSchools();
    } catch(err) {
      alert('Error: ' + err.message);
    }
  };

  // Create school modal
  window.openCreateModal = function() {
    document.getElementById('schoolName').value = '';
    document.getElementById('schoolSlug').value = '';
    document.getElementById('schoolEmail').value = '';
    document.getElementById('schoolPhone').value = '';
    document.getElementById('createModal').classList.add('open');
  };
  window.closeCreateModal = function() {
    document.getElementById('createModal').classList.remove('open');
  };

  window.createSchool = async function() {
    const name = document.getElementById('schoolName').value.trim();
    const slug = document.getElementById('schoolSlug').value.trim();
    const contact_email = document.getElementById('schoolEmail').value.trim();
    const contact_phone = document.getElementById('schoolPhone').value.trim();

    if (!name || !slug) { alert('Name and slug are required.'); return; }

    try {
      const data = await apiPost('/api/schools?action=create', { name, slug, contact_email, contact_phone });
      if (data.error) throw new Error(data.message);
      closeCreateModal();
      loadSchools();
    } catch(err) {
      alert('Error creating school: ' + err.message);
    }
  };

  // Logout
  window.logout = function() {
    window.ccAdminAuth.logout();
  };

  loadSchools();
})();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  if (t.dataset.action === 'toggle-school') toggleSchool(parseInt(t.dataset.id, 10), t.dataset.active === 'true');
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
  bind('btn-open-create-modal', openCreateModal);
  bind('btn-close-create', closeCreateModal);
  bind('btn-create-school', createSchool);
})();
})();
