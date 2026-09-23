(function () {
  'use strict';
  const button = document.getElementById('btn-export-contacts');
  const status = document.getElementById('contacts-export-status');
  if (!button || !status) return;
  const schoolSelect = document.getElementById('contacts-export-school');
  const auth = window.ccAdminAuth.getAuth();
  const platformAdmin = auth && auth.admin && auth.admin.role === 'superadmin';
  if (platformAdmin) {
    document.getElementById('contacts-export-school-label').hidden = false;
    button.disabled = true;
    window.ccAdminAuth.fetchAuthed('/api/schools?action=list').then(async function (response) {
      if (!response.ok) throw new Error('Unable to load schools. Reload to try again.');
      const data = await response.json();
      (data.schools || []).forEach(function (school) {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.name;
        schoolSelect.appendChild(option);
      });
      const selected = new URLSearchParams(window.location.search).get('school_id') || auth.admin.school_id;
      if (selected) schoolSelect.value = String(selected);
      else if (data.schools && data.schools.length === 1) schoolSelect.value = String(data.schools[0].id);
      button.disabled = false;
    }).catch(function (error) { status.textContent = error.message; });
  }

  button.addEventListener('click', async function () {
    if (button.disabled) return;
    if (platformAdmin && !schoolSelect.value) {
      status.textContent = 'Choose a school to export contacts.';
      schoolSelect.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Exporting…';
    status.textContent = 'Preparing all contacts…';
    try {
      const params = new URLSearchParams({ action: 'export-contacts' });
      if (platformAdmin) params.set('school_id', schoolSelect.value);
      const response = await window.ccAdminAuth.fetchAuthed('/api/admin?' + params.toString());
      if (!response.ok) {
        if (response.status === 401) throw new Error('Please sign in as an admin again to export contacts.');
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Unable to export contacts. Please try again.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = (response.headers.get('Content-Disposition') || '').match(/filename="([a-zA-Z0-9._-]+)"/);
      link.href = url;
      link.download = filename ? filename[1] : 'gohighlevel-contacts.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      const count = response.headers.get('X-Contact-Count');
      status.textContent = count === null ? 'Your contacts CSV has downloaded.' : count + (count === '1' ? ' contact' : ' contacts') + ' exported for GoHighLevel.';
    } catch (error) {
      status.textContent = error.message || 'Unable to export contacts. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Export GoHighLevel CSV';
    }
  });
})();
