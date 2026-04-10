(function () {
  'use strict';

  let token = null;
  let currentProfileId = null;
  let currentProfileSlug = null;

  function init() {
    const session = ccAuth.getAuth();
    token = session?.token || null;
    if (!token) { window.location.href = '/instructor/login.html'; return; }
    loadProfile();
  }

  async function loadProfile() {
    try {
      const res  = await ccAuth.fetchAuthed('/api/instructor?action=profile');
      if (res.status === 401) { signOut(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentProfileId = data.instructor.id;
      currentProfileSlug = data.instructor.slug;
      renderProfile(data.instructor);
    } catch (err) {
      document.getElementById('profileContent').innerHTML =
        `<p style="color:var(--red);padding:20px">${err.message}</p>`;
    }
  }

  const SPECIALISMS = ['Nervous drivers','Motorway lessons','Intensive courses','Automatic only','Manual only','Refresher courses','Pass Plus','Advanced driving'];

  function buildSpecialismChips(selected) {
    return SPECIALISMS.map(function(s) {
      var cls = 'chip' + (selected.includes(s) ? ' active' : '');
      return '<span class="' + cls + '" data-action="toggle-chip">' + s + '</span>';
    }).join('');
  }

  function renderProfile(p) {
    const initials = p.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const avatarHtml = p.photo_url
      ? `<img src="${esc(p.photo_url)}" alt="${esc(p.name)}" data-fallback-initials="${initials}">`
      : initials;

    document.getElementById('profileContent').innerHTML = `
      <div class="avatar-row">
        <div class="avatar" id="avatarEl">${avatarHtml}</div>
        <div class="avatar-info">
          <div class="avatar-name" id="displayName">${esc(p.name)}</div>
          <div class="avatar-email">${esc(p.email)}</div>
          <p class="avatar-note">Your email is managed by admin and cannot be changed here.</p>
        </div>
      </div>

      <div class="success-banner" id="successBanner">✓ Profile updated successfully</div>

      <div class="form-card">
        <div class="form-card-title">Personal details</div>

        <div class="form-group">
          <label for="inputName">Full name</label>
          <input type="text" id="inputName" value="${esc(p.name)}" placeholder="Your full name">
        </div>

        <div class="form-group">
          <label>Email address</label>
          <div class="email-field">${esc(p.email)}</div>
        </div>

        <div class="form-group">
          <label for="inputPhone">Phone number</label>
          <input type="text" id="inputPhone" value="${esc(p.phone || '')}" placeholder="e.g. 07700 900000">
          <p class="field-hint">Shared with learners for lesson day contact.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Public profile</div>

        <div class="form-group">
          <label for="inputBio">Bio</label>
          <textarea id="inputBio" placeholder="Tell learners a bit about yourself — your experience, teaching style, areas covered…">${esc(p.bio || '')}</textarea>
          <p class="field-hint">Shown to learners when choosing an instructor.</p>
        </div>

        <div class="form-group">
          <label>Profile photo</label>
          <input type="file" id="inputPhotoFile" accept="image/jpeg,image/png,image/webp" style="display:none">
          <input type="hidden" id="inputPhoto" value="${esc(p.photo_url || '')}">
          <button type="button" id="btn-upload-photo" style="background:var(--accent-lt);color:var(--accent);border:1.5px dashed var(--accent);border-radius:8px;padding:12px;width:100%;font-family:var(--font-body);font-size:0.85rem;font-weight:600;cursor:pointer;transition:background 0.15s;">
            ${p.photo_url ? 'Change photo' : 'Upload a photo'}
          </button>
          <div id="uploadStatus" style="font-size:0.78rem;color:var(--muted);margin-top:6px;display:none"></div>
          <p class="field-hint">JPG, PNG or WebP, max 2MB.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Qualifications &amp; Experience</div>

        <div class="form-group">
          <label for="inputAdiGrade">ADI grade</label>
          <input type="text" id="inputAdiGrade" value="${esc(p.adi_grade || '')}" placeholder="e.g. A, B, or 6">
          <p class="field-hint">Your DVSA approved driving instructor grade.</p>
        </div>

        <div class="form-group">
          <label for="inputPassRate">Pass rate (%)</label>
          <input type="number" id="inputPassRate" min="0" max="100" step="0.1" value="${p.pass_rate != null ? p.pass_rate : ''}" placeholder="e.g. 72.5">
        </div>

        <div class="form-group">
          <label for="inputYearsExp">Years of experience</label>
          <input type="number" id="inputYearsExp" min="0" max="60" step="1" value="${p.years_experience != null ? p.years_experience : ''}" placeholder="e.g. 8">
        </div>

        <div class="form-group">
          <label>Specialisms</label>
          <div class="chip-group" id="specialismsChips">
            ${buildSpecialismChips(p.specialisms || [])}
          </div>
          <p class="field-hint">Select all that apply — shown to learners on your profile.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Vehicle</div>

        <div class="form-group">
          <label for="inputVehicleMake">Make</label>
          <input type="text" id="inputVehicleMake" value="${esc(p.vehicle_make || '')}" placeholder="e.g. Vauxhall">
        </div>

        <div class="form-group">
          <label for="inputVehicleModel">Model</label>
          <input type="text" id="inputVehicleModel" value="${esc(p.vehicle_model || '')}" placeholder="e.g. Corsa">
        </div>

        <div class="form-group">
          <label for="inputTransmission">Transmission</label>
          <select id="inputTransmission" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--primary);font-family:var(--font-body);font-size:0.9rem;padding:10px 13px;outline:none;">
            <option value="manual" ${(p.transmission_type || 'manual') === 'manual' ? 'selected' : ''}>Manual</option>
            <option value="automatic" ${p.transmission_type === 'automatic' ? 'selected' : ''}>Automatic</option>
            <option value="both" ${p.transmission_type === 'both' ? 'selected' : ''}>Both</option>
          </select>
        </div>

        <div class="form-group">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="inputDualControls" ${p.dual_controls !== false ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer">
            Dual controls fitted
          </label>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Service Area</div>

        <div class="form-group">
          <label for="inputServiceAreas">Coverage areas</label>
          <textarea id="inputServiceAreas" placeholder="e.g. SW1, SE1, Croydon, Bromley" style="min-height:60px">${esc((p.service_areas || []).join(', '))}</textarea>
          <p class="field-hint">Comma-separated postcodes or area names. Helps learners find instructors near them.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Languages</div>

        <div class="form-group">
          <label for="inputLanguages">Languages spoken</label>
          <input type="text" id="inputLanguages" value="${esc((p.languages || ['English']).join(', '))}" placeholder="e.g. English, Urdu, Polish">
          <p class="field-hint">Comma-separated. Helps match learners with instructors who speak their language.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Scheduling</div>

        <div class="form-group">
          <label for="inputBuffer">Buffer time between lessons</label>
          <select id="inputBuffer" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--primary);font-family:var(--font-body);font-size:0.9rem;padding:10px 13px;outline:none;">
            <option value="0" ${p.buffer_minutes === 0 ? 'selected' : ''}>No buffer</option>
            <option value="15" ${p.buffer_minutes === 15 ? 'selected' : ''}>15 minutes</option>
            <option value="30" ${p.buffer_minutes === 30 || !p.buffer_minutes ? 'selected' : ''}>30 minutes (default)</option>
            <option value="45" ${p.buffer_minutes === 45 ? 'selected' : ''}>45 minutes</option>
            <option value="60" ${p.buffer_minutes === 60 ? 'selected' : ''}>60 minutes</option>
            <option value="90" ${p.buffer_minutes === 90 ? 'selected' : ''}>90 minutes</option>
            <option value="120" ${p.buffer_minutes === 120 ? 'selected' : ''}>120 minutes</option>
          </select>
          <p class="field-hint">Rest or travel time blocked after each booked lesson. Learners won't be able to book within this window.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Reminders</div>

        <div class="form-group">
          <label for="inputReminderHours">Learner reminder timing</label>
          <select id="inputReminderHours" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--primary);font-family:var(--font-body);font-size:0.9rem;padding:10px 13px;outline:none;">
            <option value="12" ${p.reminder_hours === 12 ? 'selected' : ''}>12 hours before</option>
            <option value="24" ${p.reminder_hours === 24 || !p.reminder_hours ? 'selected' : ''}>24 hours before (default)</option>
            <option value="48" ${p.reminder_hours === 48 ? 'selected' : ''}>48 hours before</option>
          </select>
          <p class="field-hint">Learners receive an email and WhatsApp reminder this many hours before their lesson.</p>
        </div>

        <div class="form-group">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="inputDailySchedule" ${p.daily_schedule_email !== false ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer">
            Send me a daily schedule email
          </label>
          <p class="field-hint">Receive an email at 7pm each evening with your next day's lessons.</p>
        </div>
      </div>

      <div class="form-card">
        <div class="form-card-title">Calendar Sync</div>
        <p class="field-hint" style="margin-bottom:14px">
          Paste your personal calendar's iCal feed URL below. Your personal events will automatically block booking slots so learners can't book over your commitments.
        </p>

        <div class="form-group">
          <label for="inputIcalUrl">iCal feed URL</label>
          <div style="display:flex;gap:8px">
            <input type="url" id="inputIcalUrl" value="${p.ical_feed_url || ''}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" style="flex:1">
            <button type="button" id="icalTestBtn"
              style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 16px;font-size:0.82rem;font-weight:600;cursor:pointer;color:var(--primary);white-space:nowrap">
              Test feed
            </button>
          </div>
          <div id="icalTestResult" style="margin-top:8px;font-size:0.82rem;display:none"></div>
        </div>

        <div id="icalSyncStatus" style="font-size:0.82rem;border-radius:8px;padding:10px 14px;display:${p.ical_feed_url ? 'block' : 'none'}">
          ${p.ical_sync_error
            ? '<span style="color:#c0392b">\u274c Sync error: ' + (p.ical_sync_error || '') + '</span>'
            : p.ical_last_synced_at
              ? '<span style="color:#27ae60">\u2705 Last synced: ' + new Date(p.ical_last_synced_at).toLocaleString('en-GB') + '</span>'
              : '<span style="color:#f39c12">\u23f3 Sync pending — will run within 15 minutes</span>'
          }
        </div>

        <details style="margin-top:14px">
          <summary style="font-size:0.82rem;color:var(--accent);cursor:pointer;font-weight:600">How do I find my iCal URL?</summary>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:10px;line-height:1.6">
            <p><strong>Google Calendar:</strong> Settings &rarr; click your calendar &rarr; "Secret address in iCal format" &rarr; copy the URL.</p>
            <p><strong>Outlook:</strong> Settings &rarr; Calendar &rarr; Shared calendars &rarr; Publish a calendar &rarr; copy the ICS link.</p>
            <p><strong>Apple iCloud:</strong> Calendar app &rarr; right-click your calendar &rarr; Share Calendar &rarr; tick "Public Calendar" &rarr; copy the URL.</p>
          </div>
        </details>
      </div>

      <button class="btn-save" id="saveBtn">Save changes</button>

      <div class="form-card" id="bookingLinksCard" style="margin-top:20px">
        <div class="form-card-title">Booking Links</div>
        <p class="field-hint" style="margin-bottom:12px">Share these links with learners to let them book a specific lesson type directly.</p>
        <div id="bookingLinksContainer"><span style="color:var(--muted);font-size:0.85rem">Loading…</span></div>
      </div>

    `;
    loadBookingLinks();
  }

  async function loadBookingLinks() {
    try {
      const res = await ccAuth.fetchAuthed('/api/lesson-types?action=list');
      const data = await res.json();
      const types = data.lesson_types || [];
      const container = document.getElementById('bookingLinksContainer');
      if (!container) return;

      // Instructor-specific link (shows only this instructor's slots)
      var slug = currentProfileSlug || currentProfileId;
      var myUrl = window.location.origin + '/book/' + slug;
      var html = '<div style="margin-bottom:16px">'
        + '<div style="font-weight:700;font-size:0.95rem;margin-bottom:6px">Your booking page</div>'
        + '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:0.78rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + myUrl + '</div>'
        + '</div>'
        + '<button data-action="copy-booking-link" data-url="' + myUrl + '" style="background:var(--accent);color:white;border:none;border-radius:6px;padding:8px 14px;font-size:0.8rem;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--font-body)">'
        + 'Copy link'
        + '</button>'
        + '</div>'
        + '</div>';

      if (types.length === 0) {
        container.innerHTML = html + '<span style="color:var(--muted);font-size:0.85rem">No lesson types configured.</span>';
        return;
      }

      html += '<div style="font-weight:700;font-size:0.95rem;margin-bottom:6px">By lesson type</div>';
      html += types.map(function(lt) {
        var url = window.location.origin + '/book/' + slug + '?type=' + encodeURIComponent(lt.slug);
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">'
          + '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + lt.colour + ';flex-shrink:0"></span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:0.9rem">' + lt.name + '</div>'
          + '<div style="font-size:0.78rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + url + '</div>'
          + '</div>'
          + '<button data-action="copy-booking-link" data-url="' + url + '" style="background:var(--accent);color:white;border:none;border-radius:6px;padding:8px 14px;font-size:0.8rem;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--font-body)">'
          + 'Copy link'
          + '</button>'
          + '</div>';
      }).join('');
      container.innerHTML = html;
    } catch (err) {
      console.error('Failed to load booking links:', err);
    }
  }

  function copyBookingLink(url, btn) {
    navigator.clipboard.writeText(url).then(() => {
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green, #22c55e)';
      setTimeout(() => { btn.textContent = 'Copy link'; btn.style.background = 'var(--accent)'; }, 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green, #22c55e)';
      setTimeout(() => { btn.textContent = 'Copy link'; btn.style.background = 'var(--accent)'; }, 2000);
    });
  }
  window.copyBookingLink = copyBookingLink;

  function toggleChip(el) {
    el.classList.toggle('active');
  }
  window.toggleChip = toggleChip;

  function previewPhoto(url) {
    if (!url) return;
    const avatarEl = document.getElementById('avatarEl');
    if (!avatarEl) return;
    avatarEl.innerHTML = `<img src="${url}" alt="preview" data-hide-on-error>`;
  }

  async function handlePhotoUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Image too large — max 2MB'); return;
    }
    const status = document.getElementById('uploadStatus');
    status.style.display = ''; status.textContent = 'Uploading…';

    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const res = await ccAuth.fetchAuthed('/api/instructor?action=upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: e.target.result })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        document.getElementById('inputPhoto').value = data.photo_url;
        previewPhoto(data.photo_url);
        status.textContent = '✓ Photo uploaded';
        status.style.color = 'var(--green)';

        // Update local session
        const session = JSON.parse(localStorage.getItem('cc_instructor') || '{}');
        if (session.instructor) {
          session.instructor.photo_url = data.photo_url;
          localStorage.setItem('cc_instructor', JSON.stringify(session));
        }
      } catch (err) {
        status.textContent = 'Upload failed: ' + (err.message || 'Unknown error');
        status.style.color = 'var(--red)';
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const name           = document.getElementById('inputName').value.trim();
    const phone          = document.getElementById('inputPhone').value.trim();
    const bio            = document.getElementById('inputBio').value.trim();
    const photo_url      = document.getElementById('inputPhoto').value.trim();
    const buffer_minutes = parseInt(document.getElementById('inputBuffer').value);
    const reminder_hours = parseInt(document.getElementById('inputReminderHours').value);
    const daily_schedule_email = document.getElementById('inputDailySchedule').checked;

    // New profile fields
    const adi_grade      = document.getElementById('inputAdiGrade').value.trim() || null;
    const passRateRaw    = document.getElementById('inputPassRate').value;
    const pass_rate      = passRateRaw !== '' ? parseFloat(passRateRaw) : null;
    const yearsRaw       = document.getElementById('inputYearsExp').value;
    const years_experience = yearsRaw !== '' ? parseInt(yearsRaw) : null;
    const specialisms    = [...document.querySelectorAll('#specialismsChips .chip.active')].map(c => c.textContent);
    const vehicle_make   = document.getElementById('inputVehicleMake').value.trim() || null;
    const vehicle_model  = document.getElementById('inputVehicleModel').value.trim() || null;
    const transmission_type = document.getElementById('inputTransmission').value;
    const dual_controls  = document.getElementById('inputDualControls').checked;
    const service_areas  = document.getElementById('inputServiceAreas').value.split(',').map(s => s.trim()).filter(Boolean);
    const languages      = document.getElementById('inputLanguages').value.split(',').map(s => s.trim()).filter(Boolean);
    const ical_feed_url  = document.getElementById('inputIcalUrl').value.trim() || null;

    if (!name) {
      alert('Name cannot be empty');
      return;
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const res  = await ccAuth.fetchAuthed('/api/instructor?action=update-profile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name, phone: phone || null, bio: bio || null, photo_url: photo_url || null,
          buffer_minutes, reminder_hours, daily_schedule_email,
          adi_grade, pass_rate, years_experience, specialisms,
          vehicle_make, vehicle_model, transmission_type, dual_controls,
          service_areas, languages, ical_feed_url
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update displayed name
      const nameEl = document.getElementById('displayName');
      if (nameEl) nameEl.textContent = data.instructor.name;
      // Update local session name
      const session = JSON.parse(localStorage.getItem('cc_instructor') || '{}');
      if (session.instructor) {
        session.instructor.name      = data.instructor.name;
        session.instructor.photo_url = data.instructor.photo_url;
        localStorage.setItem('cc_instructor', JSON.stringify(session));
      }

      // Show success banner
      const banner = document.getElementById('successBanner');
      if (banner) {
        banner.classList.add('show');
        setTimeout(() => banner.classList.remove('show'), 4000);
      }

    } catch (err) {
      alert(err.message || 'Failed to save profile');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  }

  function signOut() {
    ccAuth.logout();
  }

  async function testIcalFeed() {
    const url = document.getElementById('inputIcalUrl').value.trim();
    const resultEl = document.getElementById('icalTestResult');
    if (!url) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<span style="color:#c0392b">Please enter a URL first</span>';
      return;
    }
    const btn = document.getElementById('icalTestBtn');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span style="color:var(--muted)">Fetching feed…</span>';

    try {
      const res = await ccAuth.fetchAuthed('/api/instructor?action=ical-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.ok) {
        resultEl.innerHTML = `<span style="color:#27ae60">\u2705 Feed is valid — ${data.event_count} event${data.event_count !== 1 ? 's' : ''} found</span>`;
      } else {
        resultEl.innerHTML = `<span style="color:#c0392b">\u274c ${data.error || 'Feed test failed'}</span>`;
      }
    } catch (err) {
      resultEl.innerHTML = '<span style="color:#c0392b">\u274c Could not test feed</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test feed';
    }
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  init();

// All form elements are rendered into innerHTML after fetch, so we use
// document-level event delegation rather than wiring fixed ids.
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action], #btn-upload-photo, #icalTestBtn, #saveBtn');
  if (!target) return;
  if (target.id === 'btn-upload-photo') {
    var pf = document.getElementById('inputPhotoFile');
    if (pf) pf.click();
    return;
  }
  if (target.id === 'icalTestBtn') { testIcalFeed(); return; }
  if (target.id === 'saveBtn') { saveProfile(); return; }
  var action = target.dataset.action;
  if (action === 'toggle-chip') toggleChip(target);
  else if (action === 'copy-booking-link') copyBookingLink(target.dataset.url, target);
});
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'inputPhotoFile') handlePhotoUpload(e.target);
});

// Delegated image error handler — replaces inline onerror. Capture because
// the 'error' event doesn't bubble. Two cases:
//  - data-hide-on-error → hide the img
//  - data-fallback-initials="XY" → hide img and replace parent textContent
//    with the initials (used on the avatar row).
document.addEventListener('error', function (e) {
  var t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.hasAttribute('data-fallback-initials')) {
    var initials = t.dataset.fallbackInitials;
    t.style.display = 'none';
    if (t.parentNode) t.parentNode.textContent = initials;
  } else if (t.hasAttribute('data-hide-on-error')) {
    t.style.display = 'none';
  }
}, true);
})();
