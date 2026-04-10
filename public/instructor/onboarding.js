(function () {
  'use strict';

  function init() {
    const session = ccAuth.getAuth();
    if (!session) {
      window.location.href = '/instructor/login.html';
      return;
    }
    // Pre-fill name if available from session
    if (session.instructor && session.instructor.name) {
      document.getElementById('inputName').value = session.instructor.name;
    }
  }

  async function submitOnboarding(e) {
    e.preventDefault();

    const name = document.getElementById('inputName').value.trim();
    if (!name) {
      showError('Please enter your name.');
      return;
    }

    const phone = document.getElementById('inputPhone').value.trim() || null;
    const bio = document.getElementById('inputBio').value.trim() || null;
    const vehicle_make = document.getElementById('inputVehicleMake').value.trim() || null;
    const vehicle_model = document.getElementById('inputVehicleModel').value.trim() || null;
    const transmission_type = document.getElementById('inputTransmission').value;
    const adi_grade = document.getElementById('inputAdiGrade').value.trim() || null;
    const yearsRaw = document.getElementById('inputYearsExp').value;
    const years_experience = yearsRaw !== '' ? parseInt(yearsRaw) : null;
    const service_areas = document.getElementById('inputServiceAreas').value
      .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    const languages = document.getElementById('inputLanguages').value
      .split(',').map(function(s) { return s.trim(); }).filter(Boolean);

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    hideError();

    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=complete-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, phone, bio, vehicle_make, vehicle_model, transmission_type,
          adi_grade, years_experience,
          service_areas: service_areas.length ? service_areas : null,
          languages: languages.length ? languages : ['English']
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      // Update session with onboarding status
      const session = JSON.parse(localStorage.getItem('cc_instructor') || '{}');
      if (session.instructor) {
        session.instructor.onboarding_complete = true;
        session.instructor.name = data.instructor.name;
        localStorage.setItem('cc_instructor', JSON.stringify(session));
      }

      window.location.href = '/instructor/';
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Complete setup';
    }
  }

  function showError(msg) {
    const el = document.getElementById('errorBanner');
    el.textContent = msg;
    el.classList.add('show');
  }

  function hideError() {
    document.getElementById('errorBanner').classList.remove('show');
  }

  init();

(function wire() {
  var form = document.getElementById('onboardingForm');
  if (form) form.addEventListener('submit', submitOnboarding);
})();
})();
