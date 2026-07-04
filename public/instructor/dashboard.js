(function () {
  'use strict';

const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let instructor = null;
let todayBookings = [];
let allLearners = [];
let selectedLearnerId = null;
let selectedLearnerBalanceMinutes = 0;

function formatBalanceMins(mins) {
  var m = Number(mins || 0);
  var h = Math.floor(m / 60);
  var rem = m % 60;
  return rem ? h + 'h ' + rem + 'm' : h + 'h';
}

function init() {
  const session = ccAuth.getAuth();
  if (!session) { window.location.href = '/instructor/login.html'; return; }
  instructor = session.instructor;

  // Greeting
  document.getElementById('greeting').textContent = 'Hi, ' + (instructor?.name?.split(' ')[0] || 'there');

  // Date header
  const now = new Date();
  const dayName = DAY_SHORT[now.getDay()];
  const date = now.getDate();
  const month = MON_SHORT[now.getMonth()];
  document.getElementById('dashDate').textContent = 'TODAY \u2014 ' + dayName + ' ' + date + ' ' + month;

  // Init shared booking actions (cancel with reason, reschedule, add lesson)
  BookingActions.init({ showToast, onRefresh: loadDashboard });

  loadDashboard();
}

async function loadDashboard() {
  try {
    // Fetch today's schedule and stats in parallel
    const today = new Date();
    const ds = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

    const [schedRes, statsRes, profileRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/instructor?action=schedule-range&from=' + ds + '&to=' + ds),
      ccAuth.fetchAuthed('/api/instructor?action=stats'),
      ccAuth.fetchAuthed('/api/instructor?action=profile')
    ]);

    const schedData = await schedRes.json();
    const statsData = await statsRes.json();

    // Stats strip
    if (statsRes.ok) {
      const t = statsData.today || 0;
      const w = statsData.thisWeek || 0;
      document.getElementById('dashStats').textContent = t + ' today \u00B7 ' + w + ' this week';
    }

    // Booking link
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      const slug = profileData.instructor?.slug || profileData.instructor?.id;
      if (slug) {
        const url = window.location.origin + '/book/' + slug;
        document.getElementById('dashBookingUrl').textContent = url;
        document.getElementById('dashBookingLink').style.display = 'flex';
        document.getElementById('dashBookingLink').dataset.url = url;
      }
    }

    // Today's bookings
    if (schedRes.ok) {
      todayBookings = schedData.bookings || [];
      // Sort by start_time
      todayBookings.sort(function(a, b) { return a.start_time < b.start_time ? -1 : 1; });
      renderLessons();
    }

    // Pending broadcast offers (fire-and-forget — failure to load this card
    // shouldn't block the rest of the dashboard).
    loadBroadcasts().catch(function(e) { console.warn('broadcasts load failed:', e.message); });

    // Connect health alert (fire-and-forget — same rationale).
    loadConnectAlert().catch(function(e) { console.warn('connect-alert load failed:', e.message); });
  } catch (err) {
    document.getElementById('dashLessons').innerHTML =
      '<div class="dash-empty"><div class="dash-empty-icon">&#x26A0;&#xFE0F;</div><p>' + (err.message || 'Failed to load') + '</p><button data-action="retry-load" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">Try again</button></div>';
  }
}

function renderLessons() {
  var container = document.getElementById('dashLessons');
  var confirmed = todayBookings.filter(function(b) { return b.status !== 'refunded'; });

  if (confirmed.length === 0) {
    container.innerHTML =
      '<div class="dash-empty">' +
        '<div class="dash-empty-icon">&#x2600;&#xFE0F;</div>' +
        '<h3>No lessons today</h3>' +
        '<p>Enjoy your day off, or book a lesson.</p>' +
        '<button class="btn-empty-book" data-action="open-book-modal">+ Book Lesson</button>' +
      '</div>';
    return;
  }

  // Find next upcoming lesson
  var now = new Date();
  var nextId = null;
  for (var i = 0; i < confirmed.length; i++) {
    var b = confirmed[i];
    if (b.status !== 'scheduled') continue;
    var parts = b.start_time.split(':');
    var lessonTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(parts[0]), parseInt(parts[1]));
    if (lessonTime > now) { nextId = b.id; break; }
  }

  var html = '';
  for (var i = 0; i < todayBookings.length; i++) {
    var b = todayBookings[i];
    var isNext = b.id === nextId;
    var isCompleted = b.status === 'chargeable';
    var isCancelled = b.status === 'refunded';

    var cls = 'dash-lesson';
    if (isNext) cls += ' is-next';
    if (isCompleted) cls += ' is-completed';
    if (isCancelled) cls += ' is-completed';

    var time = b.start_time.slice(0, 5);
    var name = esc(b.learner_name || 'Unknown');
    var addr = b.learner_pickup_address || b.booking_pickup_address || '';
    // Extract just the postcode from address
    var pcMatch = addr.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    var detail = pcMatch ? pcMatch[1].toUpperCase() : (addr ? addr.split(',')[0].trim() : '');
    if (b.lesson_type_name) detail = b.lesson_type_name + (detail ? ' \u00B7 ' + detail : '');
    if (b.social_video_consent) detail = (detail ? detail + ' \u00B7 ' : '') + 'Filmed lesson';

    var badgeCls = 'badge-confirmed';
    var badgeText = '';
    if (isCancelled) { badgeCls = 'badge-cancelled'; badgeText = 'Cancelled'; }
    else if (isCompleted) { badgeCls = 'badge-completed'; badgeText = 'Done'; }

    html += '<div class="' + cls + '" data-action="open-detail" data-detail-idx="' + i + '">' +
      '<div class="dash-lesson-time">' + time + '</div>' +
      '<div class="dash-lesson-info">' +
        '<div class="dash-lesson-name">' + name + '</div>' +
        (detail ? '<div class="dash-lesson-detail">' + esc(detail) + '</div>' : '') +
      '</div>' +
      (badgeText ? '<span class="dash-lesson-badge ' + badgeCls + '">' + badgeText + '</span>' : '') +
    '</div>';
  }
  container.innerHTML = html;
  updateLateButton();
}

// ── Book Lesson Modal ──
async function openBookModal() {
  document.getElementById('bookModal').classList.add('open');
  document.getElementById('bookSearch').value = '';
  document.getElementById('bookSelected').classList.remove('show');
  selectedLearnerId = null;
  selectedLearnerBalanceMinutes = 0;

  // Set defaults
  var now = new Date();
  var ds = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  document.getElementById('bookDate').value = ds;
  // Default to next half-hour
  var mins = now.getMinutes();
  now.setMinutes(mins < 30 ? 30 : 0);
  if (mins >= 30) now.setHours(now.getHours() + 1);
  document.getElementById('bookTime').value = now.toTimeString().slice(0, 5);
  document.querySelector('input[name="bookPay"][value="cash"]').checked = true;
  document.getElementById('bookDropoff').value = '';
  document.getElementById('bookNotes').value = '';
  document.getElementById('bookCreditNote').style.display = 'none';
  document.getElementById('bookPaymentLinkNote').style.display = 'none';
  clearPaymentLinkSuccess();
  document.getElementById('bookBtn').disabled = false;
  document.getElementById('bookBtn').textContent = 'Book lesson';
  updateBookPaymentUi();

  // Load learners and lesson types
  try {
    var [lRes, tRes] = await Promise.all([
      ccAuth.fetchAuthed('/api/instructor?action=school-learners'),
      ccAuth.fetchAuthed('/api/lesson-types?action=list')
    ]);
    var lData = await lRes.json();
    var tData = await tRes.json();

    allLearners = lData.learners || lData || [];
    var types = tData.lesson_types || [];
    var sel = document.getElementById('bookType');
    sel.innerHTML = types.map(function(t) {
      var hrs = t.duration_minutes / 60;
      var hrsStr = hrs % 1 === 0 ? hrs + 'hr' : hrs.toFixed(1) + 'hr';
      return '<option value="' + t.id + '">' + esc(t.name) + ' (' + hrsStr + ')</option>';
    }).join('');
  } catch (e) {}
}

function closeBookModal() {
  clearPaymentLinkSuccess();
  document.getElementById('bookModal').classList.remove('open');
}

function filterLearners() {
  var q = document.getElementById('bookSearch').value.toLowerCase().trim();
  var dd = document.getElementById('bookDropdown');
  if (!q || q.length < 2) { dd.classList.remove('open'); return; }
  var matches = allLearners.filter(function(l) {
    return (l.name || '').toLowerCase().includes(q) ||
           (l.email || '').toLowerCase().includes(q) ||
           (l.phone || '').includes(q);
  });
  // "Your learner" first, then alphabetical within each group
  matches.sort(function (a, b) {
    if (!!a.is_your_learner !== !!b.is_your_learner) return a.is_your_learner ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  matches = matches.slice(0, 15);

  if (matches.length === 0) {
    dd.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:0.85rem;">No learners found</div>';
  } else {
    dd.innerHTML = matches.map(function(l) {
      var det = l.email || l.phone || '';
      var tag = l.is_your_learner
        ? '<span style="font-size:0.7rem;font-weight:600;color:var(--green,#1f8a4c);background:rgba(31,138,76,0.1);padding:1px 6px;border-radius:4px;margin-left:6px">Your learner</span>'
        : '<span style="font-size:0.7rem;font-weight:600;color:var(--muted);background:var(--surface);padding:1px 6px;border-radius:4px;margin-left:6px">New to you</span>';
      return '<div class="learner-option" data-action="select-learner" data-learner-id="' + l.id + '" data-name="' + esc(l.name) + '" data-det="' + esc(det) + '" data-balance-minutes="' + (l.balance_minutes || 0) + '">' +
        '<div class="learner-opt-name">' + esc(l.name) + tag + '</div>' +
        '<div class="learner-opt-detail">' + esc(det) + '</div>' +
      '</div>';
    }).join('');
  }
  dd.classList.add('open');
}

function selectLearner(id, name, detail, balanceMinutes) {
  clearPaymentLinkSuccess();
  selectedLearnerId = id;
  selectedLearnerBalanceMinutes = balanceMinutes;
  document.getElementById('bookSearch').value = '';
  document.getElementById('bookDropdown').classList.remove('open');
  document.getElementById('bookSelectedName').textContent = name;
  document.getElementById('bookSelectedDetail').textContent = detail;
  document.getElementById('bookSelected').classList.add('show');

  // Show credit note
  var note = document.getElementById('bookCreditNote');
  if (balanceMinutes > 0) {
    note.textContent = 'Learner has ' + formatBalanceMins(balanceMinutes) + ' with you.';
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }
}

function clearLearner() {
  clearPaymentLinkSuccess();
  selectedLearnerId = null;
  selectedLearnerBalanceMinutes = 0;
  document.getElementById('bookSelected').classList.remove('show');
  document.getElementById('bookCreditNote').style.display = 'none';
  document.getElementById('bookSearch').value = '';
}

function updateBookPaymentUi() {
  var payMethod = document.querySelector('input[name="bookPay"]:checked')?.value || 'cash';
  var linkNote = document.getElementById('bookPaymentLinkNote');
  var btn = document.getElementById('bookBtn');
  if (linkNote) linkNote.style.display = payMethod === 'payment_link' ? 'block' : 'none';
  if (btn && !btn.disabled) btn.textContent = payMethod === 'payment_link' ? 'Send payment link' : 'Book lesson';
}

function clearPaymentLinkSuccess() {
  var successEl = document.getElementById('bookOfferSuccess');
  if (!successEl) return;
  successEl.style.display = 'none';
  successEl.innerHTML = '';
}

function renderBookOfferSuccess(data) {
  var successEl = document.getElementById('bookOfferSuccess');
  if (!successEl) return;
  var shareUrl = data.accept_url || '';
  var selectedName = document.getElementById('bookSelectedName').textContent || data.learner_name || 'learner';
  var safeName = esc(selectedName);
  var emailAvailable = data.email_available === true;
  var messageAvailable = data.message_available === true;
  var emailSent = data.email_sent === true;
  var messageSent = data.message_sent === true;
  var deliveryParts = [];
  if (emailSent) deliveryParts.push('email');
  if (messageSent) deliveryParts.push('text message');
  var failedParts = [];
  if (emailAvailable && !emailSent) failedParts.push('email');
  if (messageAvailable && !messageSent) failedParts.push('text message');
  var missingParts = [];
  if (!emailAvailable) missingParts.push('no email saved');
  if (!messageAvailable) missingParts.push('no phone saved');

  var statusLine;
  if (deliveryParts.length > 0) {
    var deliveryText = deliveryParts.length === 2 ? deliveryParts[0] + ' and ' + deliveryParts[1] : deliveryParts[0];
    var failedText = failedParts.length
      ? ' ' + (failedParts.length === 2 ? failedParts[0] + ' and ' + failedParts[1] : failedParts[0]) + ' delivery did not complete.'
      : '';
    var missingText = missingParts.length ? ' (' + missingParts.join(', ') + ')' : '';
    statusLine = 'Payment link sent to ' + safeName + ' by ' + deliveryText + '. The slot is held as a pending offer for 24 hours and will only be booked after they accept and pay.' + missingText + failedText;
  } else if (failedParts.length > 0) {
    var failed = failedParts.length === 2 ? failedParts[0] + ' and ' + failedParts[1] : failedParts[0];
    statusLine = 'Payment link created for ' + safeName + ', but ' + failed + ' delivery did not complete. The slot is held as a pending offer for 24 hours.';
  } else if (missingParts.length > 0) {
    statusLine = 'Payment link created for ' + safeName + '; the selected learner has ' + missingParts.join(' and ') + '. The slot is held as a pending offer for 24 hours.';
  } else {
    statusLine = 'Payment link created for ' + safeName + '. The slot is held as a pending offer for 24 hours.';
  }

  successEl.innerHTML =
    '<div>' + statusLine + '</div>' +
    '<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<input type="text" id="bookOfferShareUrl" readonly style="flex:1;min-width:0;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.78rem;background:var(--white);color:var(--primary)">' +
      '<button id="bookOfferCopyBtn" style="padding:6px 14px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap">Copy link</button>' +
    '</div>';
  document.getElementById('bookOfferShareUrl').value = shareUrl;
  document.getElementById('bookOfferCopyBtn').addEventListener('click', function () {
    var copyBtn = this;
    var urlInput = document.getElementById('bookOfferShareUrl');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(function () {
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      }).catch(function () {
        urlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
      });
    } else {
      urlInput.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 2000);
    }
  });
  successEl.style.display = 'block';
}

async function confirmBook() {
  if (!selectedLearnerId) { showToast('Please select a learner', 'error'); return; }
  var date = document.getElementById('bookDate').value;
  var time = document.getElementById('bookTime').value;
  if (!date || !time) { showToast('Please fill in date and time', 'error'); return; }
  var payMethod = document.querySelector('input[name="bookPay"]:checked').value;
  var isPaymentLink = payMethod === 'payment_link';

  var btn = document.getElementById('bookBtn');
  btn.disabled = true;
  btn.textContent = isPaymentLink ? 'Sending...' : 'Booking...';
  clearPaymentLinkSuccess();

  try {
    if (isPaymentLink) {
      var offerBody = {
        learner_id: selectedLearnerId,
        scheduled_date: date,
        start_time: time.slice(0,5),
        lesson_type_id: parseInt(document.getElementById('bookType').value)
      };

      var offerRes = await ccAuth.fetchAuthed('/api/instructor?action=create-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerBody)
      });
      var offerData = await offerRes.json();
      if (!offerRes.ok) throw new Error(offerData.error || 'Failed to send payment link');

      renderBookOfferSuccess(offerData);
      showToast('Payment link created. The slot is held for 24 hours.', 'success');
      loadDashboard();
      btn.disabled = false;
      btn.textContent = 'Send payment link';
      return;
    }

    var body = {
      learner_id: selectedLearnerId,
      scheduled_date: date,
      start_time: time.slice(0,5),
      lesson_type_id: parseInt(document.getElementById('bookType').value),
      payment_method: payMethod,
      notes: document.getElementById('bookNotes').value.trim() || null,
      dropoff_address: document.getElementById('bookDropoff').value.trim() || null
    };

    var res = await ccAuth.fetchAuthed('/api/instructor?action=create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Booking failed');

    closeBookModal();
    showToast('Lesson booked with ' + (data.learner_name || 'learner'), 'success');
    loadDashboard(); // Refresh
  } catch (err) {
    showToast(err.message || (isPaymentLink ? 'Failed to send payment link' : 'Booking failed'), 'error');
    btn.disabled = false;
    btn.textContent = isPaymentLink ? 'Send payment link' : 'Book lesson';
  }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 4000);
}

// ── Lesson Detail Modal ──
var detailBooking = null;

function openDetail(idx) {
  var b = todayBookings[idx];
  if (!b) return;
  detailBooking = b;

  var time = b.start_time.slice(0, 5) + ' — ' + (b.end_time || '').slice(0, 5);
  var name = b.learner_name || 'Unknown';
  document.getElementById('detailTitle').textContent = name;

  // Prefer contact before flag
  var flagEl = document.getElementById('detailFlag');
  if (b.prefer_contact_before) {
    flagEl.textContent = 'Learner prefers to be contacted before the lesson';
    flagEl.style.display = 'block';
  } else {
    flagEl.style.display = 'none';
  }

  // Build info rows
  var rows = '';
  rows += detailRow('Time', time);
  rows += detailRow('Status', capitalize(b.status));
  if (b.lesson_type_name) rows += detailRow('Lesson type', b.lesson_type_name);
  if (b.social_video_consent) rows += detailRow('Filming', 'Learner agreed for this lesson to be filmed' + (b.social_video_discount_pct ? ' (' + b.social_video_discount_pct + '% discount)' : ''));
  if (b.duration_minutes) {
    var hrs = b.duration_minutes / 60;
    rows += detailRow('Duration', (hrs % 1 === 0 ? hrs + ' hour' + (hrs > 1 ? 's' : '') : hrs.toFixed(1) + ' hours'));
  }
  var phone = b.learner_phone || '';
  if (phone) {
    var telHref = phone.startsWith('+') ? phone : (phone.startsWith('0') ? '+44' + phone.slice(1) : phone);
    rows += detailRow('Phone', '<a href="tel:' + esc(telHref) + '">' + esc(phone) + '</a>');
  }
  if (b.learner_email) rows += detailRow('Email', esc(b.learner_email));
  var pickup = b.learner_pickup_address || b.booking_pickup_address || '';
  if (pickup) rows += detailRow('Pickup', esc(pickup));
  if (b.booking_dropoff_address) rows += detailRow('Drop-off', esc(b.booking_dropoff_address));
  if (b.notes) rows += detailRow('Booking notes', esc(b.notes));

  document.getElementById('detailInfo').innerHTML = rows;

  // Pre-fill instructor notes
  document.getElementById('detailNotes').value = b.instructor_notes || '';

  // Actions
  var actions = '';
  if (phone) {
    var callHref = phone.startsWith('+') ? phone : (phone.startsWith('0') ? '+44' + phone.slice(1) : phone);
    actions += '<a href="tel:' + esc(callHref) + '" class="btn-detail call">Call Learner</a>';
  }

  // Only show complete for past lessons (end time has passed)
  var now = new Date();
  var today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  var endParts = (b.end_time || b.start_time || '23:59').split(':');
  var lessonEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(endParts[0]), parseInt(endParts[1]));
  var isPast = lessonEnd <= now;

  if (b.status === 'scheduled' && !isPast) {
    actions += '<button class="btn-detail cancel-btn" data-action="cancel-from-detail">Cancel Lesson</button>';
  }
  if (b.can_report_not_delivered) {
    actions += '<button class="btn-detail cancel-btn" data-action="not-delivered-from-detail">Mark as not delivered</button>';
  }

  document.getElementById('detailActions').innerHTML = actions;
  document.getElementById('detailModal').classList.add('open');
}

function closeDetail() {
  document.getElementById('detailModal').classList.remove('open');
  detailBooking = null;
}

function detailRow(label, value) {
  return '<div class="detail-row"><span class="detail-label">' + label + '</span><span class="detail-value">' + value + '</span></div>';
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function cancelFromDetail() {
  if (!detailBooking) return;
  closeDetail();
  BookingActions.openCancel(detailBooking);
}

function notDeliveredFromDetail() {
  if (!detailBooking) return;
  var booking = detailBooking;
  closeDetail();
  BookingActions.openNotDelivered(booking);
}
function closeCancelConfirm(result) {
  document.getElementById('cancelConfirmModal').classList.remove('open');
  if (pendingCancelResolve) { pendingCancelResolve(result); pendingCancelResolve = null; }
}

// ── Running Late Modal ──
var selectedDelay = 10;

function getUpcomingCount() {
  var now = new Date();
  return todayBookings.filter(function(b) {
    if (b.status !== 'scheduled') return false;
    var parts = b.start_time.split(':');
    var t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(parts[0]), parseInt(parts[1]));
    return t > now;
  }).length;
}

function updateLateButton() {
  var count = getUpcomingCount();
  var btn = document.getElementById('btnLate');
  if (count > 0) {
    btn.disabled = false;
    btn.title = 'Notify ' + count + ' upcoming learner' + (count > 1 ? 's' : '');
  } else {
    btn.disabled = true;
    btn.title = 'No upcoming lessons';
  }
}

function openLateModal() {
  var count = getUpcomingCount();
  if (count === 0) return;
  selectedDelay = 10;
  document.getElementById('lateCustom').value = '';
  document.getElementById('lateCount').textContent = count + ' learner' + (count > 1 ? 's' : '') + ' will be notified via WhatsApp and email.';
  document.getElementById('btnLateSend').disabled = false;
  document.getElementById('btnLateSend').textContent = 'Notify Learners';

  // Reset pill selection
  var pills = document.querySelectorAll('.late-pill');
  pills.forEach(function(p) { p.classList.remove('selected'); });
  pills[0].classList.add('selected');

  document.getElementById('lateModal').classList.add('open');
}

function closeLateModal() {
  document.getElementById('lateModal').classList.remove('open');
}

function selectDelay(mins, el) {
  selectedDelay = mins;
  document.getElementById('lateCustom').value = '';
  document.querySelectorAll('.late-pill').forEach(function(p) { p.classList.remove('selected'); });
  el.classList.add('selected');
}

function selectCustomDelay() {
  var val = parseInt(document.getElementById('lateCustom').value);
  if (val && val > 0) {
    selectedDelay = val;
    document.querySelectorAll('.late-pill').forEach(function(p) { p.classList.remove('selected'); });
  }
}

async function sendRunningLate() {
  var btn = document.getElementById('btnLateSend');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    var res = await ccAuth.fetchAuthed('/api/instructor?action=running-late', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay_minutes: selectedDelay })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send');

    closeLateModal();
    if (data.notified > 0) {
      showToast('Notified ' + data.notified + ' learner' + (data.notified > 1 ? 's' : ''), 'success');
    } else {
      showToast('No learners to notify', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Failed to send notifications', 'error');
    btn.disabled = false;
    btn.textContent = 'Notify Learners';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.learner-search-wrap')) {
    var dd = document.getElementById('bookDropdown');
    if (dd) dd.classList.remove('open');
  }
});

function copyDashBookingLink() {
  const url = document.getElementById('dashBookingLink').dataset.url;
  const btn = document.getElementById('dashCopyBtn');
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--green, #22c55e)';
    setTimeout(() => { btn.textContent = 'Copy link'; btn.style.background = ''; }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--green, #22c55e)';
    setTimeout(() => { btn.textContent = 'Copy link'; btn.style.background = ''; }, 2000);
  });
}

init();

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'retry-load') loadDashboard();
  else if (a === 'open-book-modal') openBookModal();
  else if (a === 'open-detail') openDetail(parseInt(t.dataset.detailIdx, 10));
  else if (a === 'select-learner') selectLearner(parseInt(t.dataset.learnerId, 10), t.dataset.name, t.dataset.det, parseInt(t.dataset.balanceMinutes, 10));
  else if (a === 'cancel-from-detail') cancelFromDetail();
  else if (a === 'not-delivered-from-detail') notDeliveredFromDetail();
  else if (a === 'close-broadcast-batch') closeBroadcastBatch(t.dataset.batchId, t);
});

// ── Pending broadcast offers card ──
async function loadBroadcasts() {
  var container = document.getElementById('dashBroadcasts');
  if (!container) return;
  try {
    var res = await ccAuth.fetchAuthed('/api/instructor?action=my-broadcast-batches');
    if (!res.ok) { container.style.display = 'none'; return; }
    var data = await res.json();
    var batches = data.batches || [];
    if (batches.length === 0) { container.style.display = 'none'; return; }

    var html = '<div class="dash-broadcasts-title">Pending broadcast offers</div>';
    html += batches.map(function (b) {
      var date = new Date(b.scheduled_date + 'T00:00:00Z');
      var dateStr = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      var timeStr = (b.start_time || '').slice(0, 5);
      var triggerLabel = b.trigger === 'cancellation' ? 'auto · cancellation' : 'manual';
      var discountStr = b.discount_pct > 0 ? ' · ' + b.discount_pct + '% off' : '';
      return '<div class="broadcast-batch-card">' +
        '<div class="broadcast-batch-info">' +
          '<div class="broadcast-batch-title">' + esc(dateStr) + ' at ' + esc(timeStr) + '</div>' +
          '<div class="broadcast-batch-meta">' +
            '<strong>' + b.pending_count + ' awaiting</strong>' +
            (b.accepted_count > 0 ? ' · ' + b.accepted_count + ' accepted' : '') +
            (b.superseded_count > 0 ? ' · ' + b.superseded_count + ' superseded' : '') +
            ' · ' + esc(triggerLabel) + esc(discountStr) +
          '</div>' +
        '</div>' +
        '<button class="broadcast-close-btn" data-action="close-broadcast-batch" data-batch-id="' + esc(b.batch_id) + '">' +
          'Close offer' +
        '</button>' +
      '</div>';
    }).join('');

    container.innerHTML = html;
    container.style.display = '';
  } catch (err) {
    console.warn('loadBroadcasts:', err.message);
    container.style.display = 'none';
  }
}

// One-line nudge that surfaces a payouts problem at the page the instructor
// lands on. Click → /instructor/earnings.html where the full banner with
// actionable buttons lives. Stays hidden when account is healthy or when
// it's a platform-owner dismissed state (no account + payouts_paused).
async function loadConnectAlert() {
  var el = document.getElementById('dashConnectAlert');
  if (!el) return;
  var res = await ccAuth.fetchAuthed('/api/connect?action=connect-status');
  if (!res.ok) { el.style.display = 'none'; return; }
  var s = await res.json();

  // Dismissed platform-owner: no banner anywhere.
  if (!s.has_account && s.payouts_paused) { el.style.display = 'none'; return; }

  var red = false, message = null;
  if (!s.has_account) {
    red = true;
    message = 'Set up payouts to receive learner payments.';
  } else if (!s.onboarding_complete) {
    message = 'Finish setting up your payouts.';
  } else if (s.charges_enabled !== undefined && (!s.charges_enabled || !s.payouts_enabled || (s.requirements_pending || 0) > 0)) {
    var n = s.requirements_pending || 0;
    message = n > 0
      ? 'Stripe needs ' + n + ' more item' + (n === 1 ? '' : 's') + ' before your payouts can resume.'
      : 'Stripe has paused your payouts — action needed.';
  } else if (s.payouts_paused) {
    message = 'Your payouts are paused.';
  }

  if (!message) { el.style.display = 'none'; return; }
  el.classList.toggle('red', red);
  el.innerHTML =
    '<span class="dash-connect-alert-icon">⚠️</span>' +
    '<span class="dash-connect-alert-text">' + esc(message) + '</span>' +
    '<span class="dash-connect-alert-arrow">›</span>';
  el.style.display = '';
}

async function closeBroadcastBatch(batchId, btn) {
  if (!batchId) return;
  if (!confirm('Close this broadcast offer? All pending recipients will get a "no longer available" message and the slot will be free again.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Closing…'; }
  try {
    var res = await ccAuth.fetchAuthed('/api/instructor?action=close-broadcast-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: batchId })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to close');
    showToast(data.closed === 1 ? 'Closed · 1 learner notified' : 'Closed · ' + data.closed + ' learners notified');
    loadBroadcasts();
  } catch (err) {
    showToast(err.message || 'Failed to close', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Close offer'; }
  }
}
(function wire() {
  var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btnLate', openLateModal);
  bind('btn-book-lesson', openBookModal);
  bind('dashCopyBtn', copyDashBookingLink);
  var bookModal = document.getElementById('bookModal');
  if (bookModal) bookModal.addEventListener('click', function (e) { if (e.target === bookModal) closeBookModal(); });
  var bookSearch = document.getElementById('bookSearch');
  if (bookSearch) {
    bookSearch.addEventListener('input', filterLearners);
    bookSearch.addEventListener('focus', function () { document.getElementById('bookDropdown').classList.add('open'); });
  }
  bind('btn-clear-learner', clearLearner);
  bind('btn-close-book', closeBookModal);
  bind('bookBtn', confirmBook);
  document.querySelectorAll('input[name="bookPay"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      clearPaymentLinkSuccess();
      updateBookPaymentUi();
    });
  });
  ['bookDate', 'bookTime', 'bookType'].forEach(function (id) {
    var field = document.getElementById(id);
    if (field) field.addEventListener('change', clearPaymentLinkSuccess);
  });
  var detailModal = document.getElementById('detailModal');
  if (detailModal) detailModal.addEventListener('click', function (e) { if (e.target === detailModal) closeDetail(); });
  bind('btn-close-detail', closeDetail);
  var lateModal = document.getElementById('lateModal');
  if (lateModal) lateModal.addEventListener('click', function (e) { if (e.target === lateModal) closeLateModal(); });
  document.querySelectorAll('.late-pill[data-delay]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectDelay(parseInt(btn.dataset.delay, 10), btn); });
  });
  var lateCustom = document.getElementById('lateCustom');
  if (lateCustom) lateCustom.addEventListener('input', selectCustomDelay);
  bind('btn-close-late', closeLateModal);
  bind('btnLateSend', sendRunningLate);
  var cancelModal = document.getElementById('cancelConfirmModal');
  if (cancelModal) cancelModal.addEventListener('click', function (e) { if (e.target === cancelModal) closeCancelConfirm(false); });
  bind('btn-cancel-confirm-no', function () { closeCancelConfirm(false); });
  bind('btn-cancel-confirm-yes', function () { closeCancelConfirm(true); });
})();
})();
