(function () {
  'use strict';

  // Auth check
  var stored = localStorage.getItem('cc_admin');
  if (!stored) { window.location.href = '/admin/login.html'; return; }
  var token;
  try {
    token = JSON.parse(stored).token;
  } catch (e) {
    window.location.href = '/admin/login.html';
    return;
  }
  try {
    var payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'superadmin') {
      alert('Access denied. Superadmin role required.');
      window.location.href = '/admin/portal.html';
      return;
    }
    document.getElementById('adminName').textContent = payload.name || 'Super Admin';
    document.getElementById('adminEmail').textContent = payload.email || '';
  } catch (e) {
    window.location.href = '/admin/login.html';
    return;
  }

  // API helpers — session cookie rides automatically via fetchAuthed
  async function apiFetch(url) {
    var res = await window.ccAdminAuth.fetchAuthed(url);
    return res.json();
  }

  // Load stats
  async function loadStats() {
    try {
      var data = await apiFetch('/api/schools?action=platform-stats');
      if (data.error) throw new Error(data.message || 'Failed to load stats');

      document.getElementById('statSchools').textContent = data.active_schools != null ? data.active_schools : 0;
      document.getElementById('statLearners').textContent = (data.total_learners != null ? data.total_learners : 0).toLocaleString();
      document.getElementById('statInstructors').textContent = data.total_instructors != null ? data.total_instructors : 0;
      document.getElementById('statBookings').textContent = (data.total_bookings != null ? data.total_bookings : 0).toLocaleString();

      var revenue = data.revenue_30d != null ? data.revenue_30d : 0;
      document.getElementById('statRevenue').textContent =
        '\u00A3' + (revenue / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
    } catch (err) {
      document.getElementById('loading').textContent = 'Error loading stats: ' + err.message;
    }
  }

  loadStats();

  // Sidebar / mobile menu wiring (previously inline onclick handlers)
  var hamburger = document.querySelector('.mobile-header .hamburger');
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.querySelector('.sidebar-overlay');
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

  // Logout — clears the cc_admin + cc_csrf cookies on the server.
  var logoutBtn = document.querySelector('.sidebar-footer .logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      window.ccAdminAuth.logout();
    });
  }
})();
