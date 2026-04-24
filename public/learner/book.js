(function () {
  'use strict';


// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_PRICE_PENCE = 8250; // fallback if lesson-types API fails

// ─── State ───────────────────────────────────────────────────────────────────
let auth          = null; // null when browsing as guest; { user, ... } when logged in
let creditBalance = 0;
let balanceMinutes = 0;
let paymentsEnabled = true; // assume true until balance API tells us otherwise
let instructors   = [];
let lessonTypes   = [];
let selectedLessonType = null; // current lesson type object
let slotCache     = {}; // dateStr -> [slot, ...]
let loadedRanges  = [];
let feedFrom      = null; // Date: start of loaded window (always today)
let feedTo        = null; // Date: end of currently loaded window
const FEED_CHUNK_DAYS = 14;
const FEED_MAX_DAYS   = 90;
let pendingSlot   = null;
let pendingCancel = null;
let preselectedTypeSlug = null;
let preselectedInstructorSlug = null;
let preselectedTypeId = null;
let prefilledName = null; // from ?name= URL param (shareable booking link)
let pendingReschedule = null; // { bookingId, date, start, end, instructorName, instructorId }
let lastBookingId = null;
let learnerProfile = { phone: '', pickup_address: '' };

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  auth = ccAuth.getAuth();

  if (localStorage.getItem('cc_welcome') === '1') {
    document.getElementById('welcomeBanner').style.display = 'flex';
  }

  // Handle URL params
  const params = new URLSearchParams(window.location.search);
  preselectedTypeSlug = params.get('type'); // ?type=standard or ?type=2hr
  preselectedTypeId = params.get('type_id'); // ?type_id=3 (from reschedule)
  prefilledName = params.get('name'); // ?name=Joe (shareable booking link from instructor)
  const rescheduleBookingId = params.get('reschedule'); // ?reschedule=BOOKING_ID
  if (params.get('paid') === '1') {
    const paidMsg = auth
      ? 'Payment successful — your lesson is booked! Check your email for details.'
      : 'Booking confirmed! Check your email for details and a link to manage your bookings.';
    showToast(paidMsg, 'success');
    window.history.replaceState({}, '', '/learner/book.html');
  }
  if (params.get('cancelled') === '1') {
    showToast('Payment cancelled — the slot has been released.', '');
    window.history.replaceState({}, '', '/learner/book.html');
  }

  // Pre-select instructor from URL param (e.g. ?instructor=4) or /book/:slug path
  let preselectedInstructorId = params.get('instructor');
  const bookPathMatch = window.location.pathname.match(/^\/book\/([^/]+)$/);
  if (bookPathMatch) {
    preselectedInstructorSlug = decodeURIComponent(bookPathMatch[1]).toLowerCase();
  }

  // Wire up modal buttons (must work for both guest and authenticated users)
  document.getElementById('bookModalClose').onclick = closeBookModal;
  document.getElementById('bookModalCloseAlt').onclick = closeBookModal;
  document.getElementById('bookModalCloseX').onclick = closeBookModal;
  document.getElementById('btnConfirmBook').onclick = confirmBookWithCredit;
  document.getElementById('btnPayAndBook').onclick = confirmPayAndBook;
  document.getElementById('btnSuccessDone').onclick = closeBookModal;
  document.getElementById('btnSyncCalendar').onclick = handleCalendarSubscribe;
  const closeCancelModal = () => document.getElementById('cancelModal').classList.remove('open');
  document.getElementById('cancelModalClose').onclick = closeCancelModal;
  document.getElementById('cancelModalCloseX').onclick = closeCancelModal;
  document.getElementById('rescheduleModalCloseX').onclick = closeRescheduleModal;
  document.getElementById('btnConfirmCancel').onclick = confirmCancel;

  // Close modals on overlay click
  document.getElementById('bookModal').addEventListener('click', e => { if (e.target === document.getElementById('bookModal')) closeBookModal(); });
  document.getElementById('cancelModal').addEventListener('click', e => { if (e.target === document.getElementById('cancelModal')) closeCancelModal(); });
  document.getElementById('rescheduleModal').addEventListener('click', e => { if (e.target === document.getElementById('rescheduleModal')) closeRescheduleModal(); });

  // Close modals on Escape key
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('bookModal').classList.contains('open')) closeBookModal();
    else if (document.getElementById('cancelModal').classList.contains('open')) closeCancelModal();
    else if (document.getElementById('rescheduleModal').classList.contains('open')) closeRescheduleModal();
  });

  const isGuest = !auth;

  function preselectInstructor() {
    const sel = document.getElementById('instructorFilter');
    // Resolve slug from /book/:slug path to instructor ID
    if (preselectedInstructorSlug && !preselectedInstructorId && instructors.length) {
      const match = instructors.find(i => i.slug === preselectedInstructorSlug);
      if (match) preselectedInstructorId = String(match.id);
    }
    if (preselectedInstructorId && sel.querySelector(`option[value="${preselectedInstructorId}"]`)) {
      sel.value = preselectedInstructorId;
    }
  }

  if (!auth) {
    Promise.all([loadInstructors(), loadLessonTypes()])
      .then(async () => {
        preselectInstructor();
        // Re-load lesson types now that instructor filter is set, so offered_lesson_types filtering applies
        if (preselectedInstructorSlug || preselectedInstructorId) await loadLessonTypes();
        initFeed();
        window.posthog && posthog.capture('booking_page_viewed', { is_guest: true, has_type_preselect: !!preselectedTypeSlug });
      });
    return;
  }

  Promise.all([loadBalance(), loadInstructors(), loadUpcoming(), loadLearnerProfile(), loadLessonTypes()])
    .then(async () => {
      preselectInstructor();
      // Re-load lesson types now that instructor filter is set, so offered_lesson_types filtering applies
      if (preselectedInstructorSlug || preselectedInstructorId) await loadLessonTypes();
      initFeed();
      showPostcodePromptIfNeeded();

      // Activate reschedule mode if ?reschedule=BOOKING_ID is in the URL
      if (rescheduleBookingId && auth) {
        try {
          const res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings');
          const data = await res.json();
          if (res.ok) {
            const booking = (data.upcoming || []).find(b => String(b.id) === rescheduleBookingId);
            if (booking) {
              // Pre-select the instructor filter to show only their slots
              const sel = document.getElementById('instructorFilter');
              if (sel.querySelector(`option[value="${booking.instructor_id}"]`)) {
                sel.value = String(booking.instructor_id);
                loadedRanges = []; slotCache = {};
                await initFeed();
              }
              startRescheduleMode(
                booking.id,
                booking.scheduled_date,
                booking.start_time.slice(0, 5),
                booking.end_time.slice(0, 5),
                booking.instructor_name,
                booking.instructor_id
              );
              // Clean the URL
              window.history.replaceState({}, '', '/learner/book.html');
            }
          }
        } catch (err) {
          console.warn('Failed to load reschedule booking:', err);
        }
      }

      window.posthog && posthog.capture('booking_page_viewed', { is_guest: false, has_type_preselect: !!preselectedTypeSlug });
    });
}

function dismissWelcome() {
  localStorage.removeItem('cc_welcome');
  document.getElementById('welcomeBanner').style.display = 'none';
}
window.dismissWelcome = dismissWelcome;

// ─── Balance ─────────────────────────────────────────────────────────────────
async function loadBalance() {
  try {
    const res = await ccAuth.fetchAuthed('/api/credits?action=balance');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    creditBalance = data.credit_balance;
    balanceMinutes = data.balance_minutes || 0;
    if (data.payments_enabled !== undefined) paymentsEnabled = !!data.payments_enabled;
    updateCreditBadge();
  } catch {}
}

function formatBalanceHours(mins) {
  const hrs = mins / 60;
  return hrs % 1 === 0 ? `${hrs} hr${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hrs`;
}

function updateCreditBadge() {
  // Hide credits banner entirely when payments are disabled
  document.getElementById('noCreditsBanner').style.display = (paymentsEnabled && balanceMinutes === 0) ? 'flex' : 'none';
}

// ─── Lesson Types ───────────────────────────────────────────────────────────
async function loadLessonTypes() {
  try {
    let url = '/api/lesson-types?action=list';
    // Pass instructor_id so the API can filter to only that instructor's offered lesson types.
    // Also pass learner_id when available for per-learner custom pricing.
    const instrId = document.getElementById('instructorFilter')?.value;
    if (instrId) {
      url += '&instructor_id=' + instrId;
      if (auth && auth.user && auth.user.id) url += '&learner_id=' + auth.user.id;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    lessonTypes = data.lesson_types || [];
    // Auto-select from ?type=slug URL param, or default to first
    // When arriving via /book/:slug (no ?type=), don't auto-select — let learner choose
    if (lessonTypes.length > 0 && !selectedLessonType) {
      if (preselectedTypeId) {
        selectedLessonType = lessonTypes.find(lt => lt.id === parseInt(preselectedTypeId)) || lessonTypes[0];
      } else if (preselectedTypeSlug) {
        selectedLessonType = lessonTypes.find(lt => lt.slug === preselectedTypeSlug) || lessonTypes[0];
      } else {
        selectedLessonType = lessonTypes[0];
      }
    }
    renderLessonTypePills();
  } catch (err) {
    console.error('Failed to load lesson types:', err);
    lessonTypes = [{ id: null, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: DEFAULT_PRICE_PENCE, colour: '#3b82f6' }];
    selectedLessonType = lessonTypes[0];
  }
}

function renderLessonTypePills() {
  const container = document.getElementById('lessonTypePills');
  if (!container || lessonTypes.length <= 1) return;
  const needsPrompt = !selectedLessonType && lessonTypes.length > 1;
  // When showing prompt, switch to vertical card layout
  if (needsPrompt) {
    container.style.flexDirection = 'column';
    container.style.overflow = 'visible';
    container.style.gap = '8px';
  } else {
    container.style.flexDirection = '';
    container.style.overflow = '';
    container.style.gap = '';
  }
  let html = '';
  if (needsPrompt) {
    html += '<div style="font-size:0.85rem;font-weight:700;color:var(--primary)">Choose your lesson length</div>';
  }
  html += (needsPrompt ? '<div style="display:flex;gap:8px;overflow-x:auto;scrollbar-width:none">' : '');
  html += lessonTypes.map(lt => {
    const hrs = lt.duration_minutes / 60;
    const hrsStr = hrs % 1 === 0 ? `${hrs}hr` : `${hrs.toFixed(1)}hr`;
    const priceStr = '£' + (lt.price_pence / 100).toFixed(0);
    const isActive = selectedLessonType && selectedLessonType.id === lt.id;
    return `<button class="lt-pill${isActive ? ' active' : ''}" data-action="select-lesson-type" data-lt-id="${lt.id}" style="--lt-colour: ${lt.colour}">
      ${esc(lt.name)} · ${hrsStr} · ${priceStr}
    </button>`;
  }).join('');
  html += (needsPrompt ? '</div>' : '');
  container.innerHTML = html;
}

function selectLessonType(id) {
  selectedLessonType = lessonTypes.find(lt => lt.id === id) || lessonTypes[0];
  renderLessonTypePills();
  slotCache = {};
  loadedRanges = [];
  initFeed();
}
window.selectLessonType = selectLessonType;

// ─── Instructors ─────────────────────────────────────────────────────────────
async function loadInstructors() {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructors?action=list');
    const data = await res.json();
    instructors = data.instructors || [];
    const sel = document.getElementById('instructorFilter');
    instructors.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.id; opt.textContent = i.name;
      sel.appendChild(opt);
    });
  } catch {}
}

// ─── Upcoming bookings (compact next-lesson card) ───────────────────────────
async function loadUpcoming() {
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const upcoming = data.upcoming || [];
    const card = document.getElementById('nextLessonCard');
    if (upcoming.length === 0) { card.style.display = 'none'; return; }
    const next = upcoming[0];
    const dateStr = new Date(next.scheduled_date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
    document.getElementById('nextLessonDetail').textContent =
      `${dateStr} at ${next.start_time.slice(0,5)} with ${next.instructor_name}`;
    card.style.display = 'flex';
  } catch {}
}

// ─── Learner profile ─────────────────────────────────────────────────────────
async function loadLearnerProfile() {
  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=profile');
    if (!res.ok) return;
    const data = await res.json();
    learnerProfile = data.profile || {};
  } catch {}
}

function showPostcodePromptIfNeeded() {
  const prompt = document.getElementById('postcodePrompt');
  if (!prompt) return;
  if (auth && !learnerProfile.pickup_address?.trim()) {
    prompt.style.display = 'block';
  } else {
    prompt.style.display = 'none';
  }
}

async function savePickupPostcode() {
  const input = document.getElementById('postcodeInput');
  const errEl = document.getElementById('postcodeError');
  const postcode = input.value.trim().toUpperCase();
  errEl.style.display = 'none';

  // Basic UK postcode validation
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode)) {
    errEl.textContent = 'Please enter a valid UK postcode';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btnSavePostcode');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: postcode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    // Update local profile and hide prompt
    learnerProfile.pickup_address = postcode;
    document.getElementById('postcodePrompt').style.display = 'none';
    showToast('Pickup postcode saved — filtering slots by travel time', 'success');

    // Re-fetch slots with travel filter now active
    loadedRanges = [];
    slotCache = {};
    initFeed();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to save';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}
window.savePickupPostcode = savePickupPostcode;

function isProfileComplete() {
  return !!(learnerProfile.phone && learnerProfile.phone.trim() && learnerProfile.pickup_address && learnerProfile.pickup_address.trim());
}

// Save phone/pickup from modal fields to learner profile (for users who haven't set them yet)
async function saveProfileFieldsFromModal() {
  const profileFieldsEl = document.getElementById('profileFields');
  if (!profileFieldsEl || profileFieldsEl.style.display === 'none') return true;

  const phone = document.getElementById('mdProfilePhone').value.trim();
  const pickup = document.getElementById('mdProfilePickup').value.trim();
  const needsPhone = document.getElementById('profilePhoneRow').style.display !== 'none';
  const needsPickup = document.getElementById('profilePickupRow').style.display !== 'none';

  if (needsPhone && !phone) { showToast('Please enter your phone number.', 'error'); return false; }
  if (needsPhone) {
    const stripped = phone.replace(/\s+/g, '');
    if (!/^07\d{9}$/.test(stripped) && !/^\+447\d{9}$/.test(stripped)) {
      showToast('Please enter a valid UK phone number (07xxx xxx xxx).', 'error'); return false;
    }
  }
  if (needsPickup && !pickup) { showToast('Please enter your pickup address.', 'error'); return false; }

  try {
    const body = {};
    if (needsPhone && phone) body.phone = phone.replace(/\s+/g, '');
    if (needsPickup && pickup) body.pickup_address = pickup;
    const res = await ccAuth.fetchAuthed('/api/learner?action=update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Could not save your details. Please try again.', 'error');
      return false;
    }
    // Update local profile so future bookings don't show the fields again
    if (body.phone) learnerProfile.phone = body.phone;
    if (body.pickup_address) learnerProfile.pickup_address = body.pickup_address;
    return true;
  } catch (err) {
    showToast('Could not save your details. Please try again.', 'error');
    return false;
  }
}

function getLearnerPostcode() {
  if (!learnerProfile.pickup_address) return null;
  const match = learnerProfile.pickup_address.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return match ? match[1].toUpperCase().replace(/\s+/g, '+') : null;
}

// ─── Feed controls ──────────────────────────────────────────────────────────
function onFilterChange() { loadedRanges = []; slotCache = {}; loadLessonTypes(); initFeed(); }

async function initFeed() {
  // If no lesson type selected yet, show a prompt instead of loading slots
  if (!selectedLessonType && lessonTypes.length > 1) {
    document.getElementById('calContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👆</div>
        <h3>Select a lesson length</h3>
        <p>Choose a lesson type above to see available time slots.</p>
      </div>`;
    return;
  }
  feedFrom = new Date(); feedFrom.setHours(0,0,0,0);
  feedTo = addDaysLocal(feedFrom, FEED_CHUNK_DAYS - 1);
  const maxDate = addDaysLocal(feedFrom, FEED_MAX_DAYS);
  if (feedTo > maxDate) feedTo = maxDate;
  slotCache = {};
  loadedRanges = [];
  showLoading();
  const ok = await fetchFeedSlots(feedFrom, feedTo);
  if (ok === false) return;
  renderFeed();
}

async function fetchFeedSlots(fromDate, toDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  let from = fmtDate(fromDate < today ? today : fromDate);
  let to = fmtDate(toDate);
  const maxDate = fmtDate(addDaysLocal(today, FEED_MAX_DAYS));
  if (from > maxDate) return true;
  if (to > maxDate) to = maxDate;

  const instructorId = document.getElementById('instructorFilter').value;
  const ltId = selectedLessonType && selectedLessonType.id ? selectedLessonType.id : '';
  const cacheKey = `${from}|${to}|${instructorId}|${ltId}`;
  if (loadedRanges.includes(cacheKey)) return true;

  const fromD = new Date(from + 'T00:00:00');
  const toD = new Date(to + 'T00:00:00');
  const chunks = [];
  let chunkStart = new Date(fromD);
  while (chunkStart <= toD) {
    let chunkEnd = addDaysLocal(chunkStart, 30);
    if (chunkEnd > toD) chunkEnd = new Date(toD);
    chunks.push({ from: fmtDate(chunkStart), to: fmtDate(chunkEnd) });
    chunkStart = addDaysLocal(chunkEnd, 1);
  }

  try {
    let travelHidden = 0;
    for (const chunk of chunks) {
      let url = `/api/slots?action=available&from=${chunk.from}&to=${chunk.to}`;
      if (instructorId) url += `&instructor_id=${instructorId}`;
      if (ltId) url += `&lesson_type_id=${ltId}`;
      const pc = getLearnerPostcode();
      if (pc) url += `&pickup_postcode=${pc}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.travel_hidden) travelHidden += data.travel_hidden;
      const slots = data.slots || {};
      for (const ds in slots) {
        if (!slotCache[ds]) slotCache[ds] = [];
        for (const s of slots[ds]) {
          if (!slotCache[ds].find(x => x.date === s.date && x.start_time === s.start_time && x.instructor_id === s.instructor_id)) {
            slotCache[ds].push(s);
          }
        }
      }
    }
    const banner = document.getElementById('travelHiddenBanner');
    if (travelHidden > 0) {
      document.getElementById('travelHiddenText').textContent =
        `${travelHidden} slot${travelHidden === 1 ? '' : 's'} hidden due to travel distance from your pickup address`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
    loadedRanges.push(cacheKey);
    return true;
  } catch (err) {
    console.error('fetchFeedSlots error:', err);
    showError(err.message || 'Failed to load available slots');
    return false;
  }
}

function renderFeed() {
  const allSlots = [];
  const fromStr = fmtDate(feedFrom);
  const toStr = fmtDate(feedTo);
  for (const ds in slotCache) {
    if (ds < fromStr || ds > toStr) continue;
    for (const s of slotCache[ds]) allSlots.push(s);
  }
  allSlots.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.start_time < b.start_time ? -1 : 1;
  });

  if (allSlots.length === 0) {
    document.getElementById('calContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <h3>No slots available</h3>
        <p>No slots found in the next ${FEED_CHUNK_DAYS} days. Try a different lesson type or check back later.</p>
      </div>`;
    updateFeedFooter(0);
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  let html = '<div class="slot-feed">';
  let lastDateStr = '';
  for (const s of allSlots) {
    // Date header when date changes
    if (s.date !== lastDateStr) {
      lastDateStr = s.date;
      const d = new Date(s.date + 'T00:00:00');
      const isToday = fmtDate(d) === fmtDate(today);
      const isTomorrow = fmtDate(d) === fmtDate(addDaysLocal(today, 1));
      let dateLabel;
      if (isToday) dateLabel = 'Today';
      else if (isTomorrow) dateLabel = 'Tomorrow';
      else dateLabel = `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
      html += `<div class="feed-date-header">${dateLabel}</div>`;
    }

    const timeStr = `${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}`;
    const colour = s.colour || (selectedLessonType ? selectedLessonType.colour : 'var(--accent)');
    const avatar = s.instructor_avatar
      ? `<span class="slot-avatar"><img src="${esc(s.instructor_avatar)}" alt=""></span>`
      : `<span class="slot-avatar">${esc((s.instructor_name || '?')[0])}</span>`;

    html += `<div class="feed-card" data-action="open-book-modal"
      data-instructor-id="${s.instructor_id}"
      data-date="${s.date}"
      data-start="${s.start_time}"
      data-end="${s.end_time}"
      data-instructor-name="${esc(s.instructor_name || '')}">
      <div class="feed-card-accent" style="background:${colour}"></div>
      <div class="feed-card-body">
        <div class="feed-card-time">${timeStr}</div>
        <div class="feed-card-instructor">${avatar} ${esc(s.instructor_name || 'Instructor')}</div>
      </div>
      <svg class="feed-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </div>`;
  }
  html += '</div>';
  document.getElementById('calContent').innerHTML = html;
  updateFeedFooter(allSlots.length);
}

function updateFeedFooter(slotCount) {
  const footer = document.getElementById('feedFooter');
  const status = document.getElementById('feedStatus');
  const btn = document.getElementById('btnLoadMore');
  footer.style.display = 'block';

  const today = new Date(); today.setHours(0,0,0,0);
  const maxDate = addDaysLocal(today, FEED_MAX_DAYS);
  const atMax = feedTo >= maxDate;

  status.textContent = slotCount > 0
    ? `Showing ${slotCount} available slot${slotCount !== 1 ? 's' : ''}`
    : 'No slots found in this period';
  btn.style.display = atMax ? 'none' : 'inline-block';
  btn.disabled = false;
  btn.textContent = 'Show more slots';
}

async function loadMoreSlots() {
  const btn = document.getElementById('btnLoadMore');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const newFrom = addDaysLocal(feedTo, 1);
  const today = new Date(); today.setHours(0,0,0,0);
  const maxDate = addDaysLocal(today, FEED_MAX_DAYS);
  let newTo = addDaysLocal(newFrom, FEED_CHUNK_DAYS - 1);
  if (newTo > maxDate) newTo = maxDate;

  feedTo = newTo;
  const ok = await fetchFeedSlots(newFrom, newTo);
  if (ok !== false) renderFeed();
  else { btn.disabled = false; btn.textContent = 'Show more slots'; }
}
window.loadMoreSlots = loadMoreSlots;

function showLoading() { document.getElementById('calContent').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading available slots…</p></div>'; document.getElementById('feedFooter').style.display = 'none'; }
function showError(msg) { document.getElementById('calContent').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${msg}</p></div>`; document.getElementById('feedFooter').style.display = 'none'; }

// ─── Book modal ──────────────────────────────────────────────────────────────
function openBookModal(el) {
  const isGuest = !auth;

  // Authenticated users with incomplete profile see inline fields (same as guest) instead of being blocked
  const needsProfileFields = !isGuest && !isProfileComplete();

  // If in reschedule mode, redirect to reschedule confirmation (auth required)
  if (pendingReschedule) {
    if (isGuest) { if (window.ccAuth) window.ccAuth.requireAuth(); return; }
    const slotInstructorId = el.dataset.instructorId;
    openRescheduleConfirm({
      instructor_id: slotInstructorId,
      date:          el.dataset.date,
      start_time:    el.dataset.start,
      end_time:      el.dataset.end
    });
    return;
  }

  window.posthog && posthog.capture('slot_clicked', {
    lesson_type_slug: selectedLessonType?.slug, instructor_id: el.dataset.instructorId,
    date: el.dataset.date, is_guest: isGuest
  });

  pendingSlot = {
    instructor_id:   el.dataset.instructorId,
    date:            el.dataset.date,
    start_time:      el.dataset.start,
    end_time:        el.dataset.end,
    instructor_name: el.dataset.instructorName
  };
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('mdDate').textContent = dateDisplay;
  document.getElementById('mdTime').textContent = `${pendingSlot.start_time} – ${pendingSlot.end_time}`;
  document.getElementById('mdInstructor').textContent = pendingSlot.instructor_name;

  const ltName     = selectedLessonType ? selectedLessonType.name : 'Standard Lesson';
  const ltDuration = selectedLessonType ? selectedLessonType.duration_minutes : 90;
  const ltHrs = ltDuration / 60;
  const ltHrsStr = ltHrs % 1 === 0 ? `${ltHrs} hour${ltHrs !== 1 ? 's' : ''}` : `${ltHrs.toFixed(1)} hours`;
  document.getElementById('mdType').textContent = ltName;
  document.getElementById('mdDuration').textContent = ltHrsStr;
  document.getElementById('mdDeductHours').textContent = ltHrsStr;
  const ltPrice    = selectedLessonType ? selectedLessonType.price_pence : DEFAULT_PRICE_PENCE;
  const ltPriceStr = '£' + (ltPrice / 100).toFixed(2);
  // Always populate price in pay-path elements (for both guest and authenticated users)
  document.getElementById('mdPayAmount').textContent = ltPriceStr;
  document.getElementById('payBtnLabel').textContent = `Pay ${ltPriceStr} & book`;
  document.getElementById('paySpinner').style.display = 'none';
  document.getElementById('btnPayAndBook').disabled = false;

  // Guest flow: show guest fields, force pay path, hide repeat/credit options
  if (isGuest) {
    document.getElementById('guestFields').style.display = 'block';
    document.getElementById('repeatSection').style.display = 'none';
    document.getElementById('modalCreditPath').style.display = 'none';
    document.getElementById('modalPayPath').style.display = 'block';
    // Clear previous guest field values (pre-fill name if from shareable link)
    document.getElementById('mdGuestName').value = prefilledName || '';
    document.getElementById('mdGuestEmail').value = '';
    document.getElementById('mdGuestPhone').value = '';
    document.getElementById('mdGuestPickup').value = '';
    document.getElementById('mdGuestTerms').checked = false;
  } else {
    document.getElementById('guestFields').style.display = 'none';
    document.getElementById('repeatSection').style.display = '';
    // Show profile completion fields if phone or pickup missing
    if (needsProfileFields) {
      document.getElementById('profileFields').style.display = 'block';
      const hasPhone = !!(learnerProfile.phone && learnerProfile.phone.trim());
      const hasAddr  = !!(learnerProfile.pickup_address && learnerProfile.pickup_address.trim());
      document.getElementById('profilePhoneRow').style.display = hasPhone ? 'none' : '';
      document.getElementById('profilePickupRow').style.display = hasAddr ? 'none' : '';
      document.getElementById('mdProfilePhone').value = '';
      document.getElementById('mdProfilePickup').value = '';
    } else {
      document.getElementById('profileFields').style.display = 'none';
    }
    if (!paymentsEnabled) {
      // Free booking mode — always show credit path, hide pay path
      document.getElementById('modalCreditPath').style.display = 'block';
      document.getElementById('modalPayPath').style.display = 'none';
      document.getElementById('mdDeductHours').textContent = 'free — no credits required';
      document.getElementById('bookBtnLabel').textContent = 'Confirm booking';
      document.getElementById('bookSpinner').style.display = 'none';
      document.getElementById('btnConfirmBook').disabled = false;
    } else {
      const hasCreds = balanceMinutes >= ltDuration;
      document.getElementById('modalCreditPath').style.display = hasCreds ? 'block' : 'none';
      document.getElementById('modalPayPath').style.display = hasCreds ? 'none' : 'block';
      if (hasCreds) {
        document.getElementById('bookBtnLabel').textContent = 'Confirm booking';
        document.getElementById('bookSpinner').style.display = 'none';
        document.getElementById('btnConfirmBook').disabled = false;
      }
    }
  }

  document.getElementById('mdDropoff').value = '';
  document.getElementById('bookConfirmStep').style.display = 'block';
  document.getElementById('bookSuccessStep').style.display = 'none';
  document.getElementById('bookModal').classList.add('open');
  startSlotTimer();
}

function closeBookModal() {
  const wasSuccess = document.getElementById('bookSuccessStep').style.display !== 'none';
  window.posthog && posthog.capture('booking_modal_closed', { completed: wasSuccess });
  clearSlotTimer();
  document.getElementById('bookModal').classList.remove('open');
  document.getElementById('repeatToggle').checked = false;
  document.getElementById('repeatOptions').classList.remove('open');
  repeatConflicts = [];
  setTimeout(() => {
    document.getElementById('bookConfirmStep').style.display = 'block';
    document.getElementById('bookSuccessStep').style.display = 'none';
  }, 300);
}

// ─── Repeat weekly logic ──────────────────────────────────────────────────
let repeatConflicts = [];

function toggleRepeatOptions() {
  const open = document.getElementById('repeatToggle').checked;
  document.getElementById('repeatOptions').classList.toggle('open', open);
  if (open) updateRepeatDates();
  updateDeductDisplay();
}

function getRepeatWeeks() {
  if (!document.getElementById('repeatToggle').checked) return 1;
  return parseInt(document.getElementById('repeatWeeksSelect').value, 10);
}

async function updateRepeatDates() {
  if (!pendingSlot) return;
  const weeks = getRepeatWeeks();
  const dates = [];
  const baseDate = new Date(pendingSlot.date + 'T00:00:00Z');
  for (let w = 0; w < weeks; w++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + w * 7);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Check conflicts
  repeatConflicts = [];
  try {
    const from = dates[0];
    const to = dates[dates.length - 1];
    const ltId = selectedLessonType ? selectedLessonType.id : '';
    const instId = pendingSlot.instructor_id;
    const pc = getLearnerPostcode();
    const res = await ccAuth.fetchAuthed(`/api/slots?action=available&from=${from}&to=${to}&instructor_id=${instId}${ltId ? '&lesson_type_id=' + ltId : ''}${pc ? '&pickup_postcode=' + pc : ''}`);
    const data = await res.json();
    // Check which dates have the slot available
    for (let i = 1; i < dates.length; i++) {
      const dateSlots = data.slots?.[dates[i]] || [];
      const hasSlot = dateSlots.some(s => s.start_time === pendingSlot.start_time);
      if (!hasSlot) repeatConflicts.push(dates[i]);
    }
  } catch {}

  // Render date list
  const container = document.getElementById('repeatDates');
  container.innerHTML = dates.map((d, i) => {
    const display = new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const isConflict = repeatConflicts.includes(d);
    return `<div class="repeat-date-item${isConflict ? ' conflict' : ''}">
      <span class="repeat-num">${i + 1}</span>
      <span>${display} at ${pendingSlot.start_time}</span>
      ${isConflict ? '<span style="margin-left:auto;font-weight:600">Unavailable</span>' : ''}
    </div>`;
  }).join('');

  // Conflict warning
  const warning = document.getElementById('repeatConflictWarning');
  if (repeatConflicts.length > 0) {
    warning.textContent = `${repeatConflicts.length} slot(s) unavailable. All slots must be free to book a series.`;
    warning.style.display = 'block';
  } else {
    warning.style.display = 'none';
  }

  updateDeductDisplay();
  updateBookButtonState();
}

function updateDeductDisplay() {
  const weeks = getRepeatWeeks();
  const ltDuration = selectedLessonType ? selectedLessonType.duration_minutes : 90;
  const totalMins = ltDuration * weeks;
  const totalHrs = totalMins / 60;
  const totalStr = totalHrs % 1 === 0 ? `${totalHrs} hours` : `${totalHrs.toFixed(1)} hours`;

  document.getElementById('mdDeductHours').textContent = totalStr;

  if (weeks > 1) {
    const perLesson = ltDuration / 60;
    const perStr = perLesson % 1 === 0 ? `${perLesson} hour${perLesson !== 1 ? 's' : ''}` : `${perLesson.toFixed(1)} hours`;
    document.getElementById('repeatTotal').textContent = `Total: ${totalStr} (${weeks} × ${perStr})`;
    document.getElementById('repeatTotal').style.display = 'block';
  } else {
    document.getElementById('repeatTotal').style.display = 'none';
  }

  // Update balance check for credit path visibility
  if (!paymentsEnabled) {
    // Free booking mode — always show credit path, hide pay path
    document.getElementById('modalCreditPath').style.display = 'block';
    document.getElementById('modalPayPath').style.display = 'none';
    // Update deduction text to indicate free booking
    document.getElementById('mdDeductHours').textContent = 'free — no credits required';
  } else {
    const hasCreds = balanceMinutes >= totalMins;
    document.getElementById('modalCreditPath').style.display = hasCreds ? 'block' : 'none';
    document.getElementById('modalPayPath').style.display = hasCreds ? 'none' : 'block';
  }
}

function updateBookButtonState() {
  const weeks = getRepeatWeeks();
  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  if (weeks > 1) {
    label.textContent = repeatConflicts.length > 0 ? 'Slots unavailable' : `Book ${weeks} lessons`;
    btn.disabled = repeatConflicts.length > 0;
  } else {
    label.textContent = 'Confirm booking';
    btn.disabled = false;
  }
}
window.toggleRepeatOptions = toggleRepeatOptions;
window.updateRepeatDates = updateRepeatDates;

// ─── Confirm with credit ─────────────────────────────────────────────────────
async function confirmBookWithCredit() {
  if (!pendingSlot) return;
  // Save profile fields first if shown (phone/pickup for incomplete profiles)
  if (!(await saveProfileFieldsFromModal())) return;

  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  const spinner = document.getElementById('bookSpinner');
  const weeks = getRepeatWeeks();
  btn.disabled = true; label.textContent = weeks > 1 ? `Booking ${weeks} lessons…` : 'Booking…'; spinner.style.display = 'block';

  try {
    const bookBody = { ...pendingSlot, dropoff_address: document.getElementById('mdDropoff').value.trim() || undefined };
    if (selectedLessonType && selectedLessonType.id) bookBody.lesson_type_id = selectedLessonType.id;
    if (weeks > 1) bookBody.repeat_weeks = weeks;
    const res = await ccAuth.fetchAuthed('/api/slots?action=book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookBody)
    });
    const data = await res.json();
    if (!res.ok) {
      // Handle conflict response for recurring bookings
      if (data.code === 'SLOTS_UNAVAILABLE' && data.conflicts) {
        const conflictDates = data.conflicts.map(c => {
          const d = new Date(c.date + 'T00:00:00Z');
          return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        }).join(', ');
        throw new Error(`Some slots are unavailable: ${conflictDates}`);
      }
      throw new Error(data.error);
    }

    creditBalance = data.credit_balance;
    balanceMinutes = data.balance_minutes || 0;
    lastBookingId = data.booking_id;
    updateCreditBadge();
    window.posthog && posthog.capture('booking_confirmed', { method: 'credit', lesson_type_slug: selectedLessonType?.slug });
    showBookSuccess(weeks, data.dates);
    refreshAfterBooking();
  } catch (err) {
    showToast(err.message || 'Booking failed. Please try again.', 'error');
    btn.disabled = false;
    label.textContent = weeks > 1 ? `Book ${weeks} lessons` : 'Confirm booking';
    spinner.style.display = 'none';
  }
}

// ─── Pay & book (Stripe) ─────────────────────────────────────────────────────
async function confirmPayAndBook() {
  if (!pendingSlot) return;
  // Save profile fields first if shown (phone/pickup for incomplete profiles)
  if (auth && !(await saveProfileFieldsFromModal())) return;

  const btn = document.getElementById('btnPayAndBook');
  const label = document.getElementById('payBtnLabel');
  const spinner = document.getElementById('paySpinner');
  const ltPrice = selectedLessonType ? selectedLessonType.price_pence : DEFAULT_PRICE_PENCE;
  const isGuest = !auth;

  // Guest validation — inline per-field errors
  if (isGuest) {
    clearAllGuestErrors();
    let hasError = false;
    const nameEl  = document.getElementById('mdGuestName');
    const emailEl = document.getElementById('mdGuestEmail');
    const phoneEl = document.getElementById('mdGuestPhone');
    const addrEl  = document.getElementById('mdGuestPickup');
    const termsEl = document.getElementById('mdGuestTerms');

    if (!nameEl.value.trim()) { showFieldError(nameEl, 'errGuestName'); hasError = true; }
    if (!emailEl.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) { showFieldError(emailEl, 'errGuestEmail'); hasError = true; }
    const stripped = phoneEl.value.replace(/\s+/g, '');
    if (!stripped || (!/^07\d{9}$/.test(stripped) && !/^\+447\d{9}$/.test(stripped))) { showFieldError(phoneEl, 'errGuestPhone'); hasError = true; }
    if (!addrEl.value.trim()) { showFieldError(addrEl, 'errGuestPickup'); hasError = true; }
    if (!termsEl.checked) { showFieldError(termsEl, 'errGuestTerms'); hasError = true; }

    if (hasError) { showToast('Please fix the highlighted fields', 'error'); return; }
  }

  btn.disabled = true; label.textContent = 'Redirecting to payment…'; spinner.style.display = 'block';
  window.posthog && posthog.capture('booking_pay_initiated', { method: 'stripe', is_guest: isGuest, lesson_type_slug: selectedLessonType?.slug });

  try {
    if (isGuest) {
      // Guest checkout — no auth required
      const payBody = {
        ...pendingSlot,
        lesson_type_id: selectedLessonType?.id,
        dropoff_address: document.getElementById('mdDropoff').value.trim() || undefined,
        guest_name:           document.getElementById('mdGuestName').value.trim(),
        guest_email:          document.getElementById('mdGuestEmail').value.trim(),
        guest_phone:          document.getElementById('mdGuestPhone').value.replace(/\s+/g, '').trim(),
        guest_pickup_address: document.getElementById('mdGuestPickup').value.trim()
      };
      const res = await ccAuth.fetchAuthed('/api/slots?action=checkout-slot-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payBody)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } else {
      // Authenticated checkout
      const payBody = { ...pendingSlot, dropoff_address: document.getElementById('mdDropoff').value.trim() || undefined };
      if (selectedLessonType && selectedLessonType.id) payBody.lesson_type_id = selectedLessonType.id;
      const res = await ccAuth.fetchAuthed('/api/slots?action=checkout-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payBody)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    }
  } catch (err) {
    showToast(err.message || 'Could not start payment. Please try again.', 'error');
    const priceStr = '£' + (ltPrice / 100).toFixed(2);
    btn.disabled = false; label.textContent = `Pay ${priceStr} & book`; spinner.style.display = 'none';
  }
}

function showBookSuccess(weeks, dates) {
  const successStep = document.getElementById('bookSuccessStep');
  if (weeks && weeks > 1 && dates) {
    const dateList = dates.map(d => {
      const display = new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      return display;
    }).join(', ');
    document.getElementById('successDate').textContent = dateList;
    successStep.querySelector('h2').textContent = `${weeks} lessons booked!`;
    successStep.querySelector('p').innerHTML = `Your <strong>${weeks} weekly lessons</strong> at <strong id="successTime">${pendingSlot.start_time}</strong> with <strong id="successInstructor">${pendingSlot.instructor_name}</strong> are confirmed. Check your email for details.`;
  } else {
    const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', timeZone:'UTC' });
    document.getElementById('successDate').textContent = dateDisplay;
    successStep.querySelector('h2').textContent = 'Lesson booked!';
    successStep.querySelector('p').innerHTML = `Your lesson on <strong id="successDate">${dateDisplay}</strong> at <strong id="successTime">${pendingSlot.start_time}</strong> with <strong id="successInstructor">${pendingSlot.instructor_name}</strong> is confirmed. Check your email for details.`;
  }
  document.getElementById('successTime').textContent = pendingSlot.start_time;
  document.getElementById('successInstructor').textContent = pendingSlot.instructor_name;

  const showSync = shouldShowCalSync();
  document.getElementById('calSyncPrompt').style.display = showSync ? 'block' : 'none';
  document.getElementById('calSyncedNote').style.display = showSync ? 'none' : 'block';

  document.getElementById('bookConfirmStep').style.display = 'none';
  successStep.style.display = 'block';
}

function refreshAfterBooking() {
  // Clear cache and reload
  loadedRanges = []; slotCache = {};
  Promise.all([loadUpcoming(), initFeed()]);
}

// ─── Calendar download & subscribe ───────────────────────────────────────────
async function handleCalendarDownload(e) {
  e.preventDefault();
  if (!lastBookingId) return;
  try {
    const res = await ccAuth.fetchAuthed(`/api/calendar?action=download&booking_id=${lastBookingId}`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'coachcarter-lesson.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendar file downloaded — open it to add to your calendar', 'success');
  } catch { showToast('Could not download calendar file', 'error'); }
}

function shouldShowCalSync() {
  const val = localStorage.getItem('cc_cal_subscribed');
  if (!val) return true;
  if (val === '1') return false; // legacy permanent dismiss
  const ts = parseInt(val, 10);
  if (isNaN(ts)) return true;
  return Date.now() - ts > 30 * 24 * 60 * 60 * 1000; // 30 days
}

async function handleCalendarSubscribe(e) {
  if (e) e.preventDefault();
  try {
    const res = await ccAuth.fetchAuthed('/api/calendar?action=feed-url');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('cc_cal_subscribed', String(Date.now()));
    window.location.href = data.webcal_url;
    // After a short delay, update the modal to show synced state
    setTimeout(() => {
      document.getElementById('calSyncPrompt').style.display = 'none';
      document.getElementById('calSyncedNote').style.display = 'block';
    }, 1000);
  } catch { showToast('Could not set up calendar sync', 'error'); }
}


async function downloadCalendar(bookingId) {
  try {
    const res = await ccAuth.fetchAuthed(`/api/calendar?action=download&booking_id=${bookingId}`);
    if (!res.ok) throw new Error('Failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'coachcarter-lesson.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendar file downloaded', 'success');
  } catch { showToast('Could not download calendar file', 'error'); }
}
window.downloadCalendar = downloadCalendar;

// ─── Cancel modal ────────────────────────────────────────────────────────────
function openCancelModal(bookingId, date, start, end, instructorName, hoursUntil, seriesId) {
  pendingCancel = { bookingId, date, start, end, instructorName, hoursUntil, seriesId: seriesId || null };
  const dateDisplay = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('cmDate').textContent = dateDisplay;
  document.getElementById('cmTime').textContent = `${start} – ${end}`;
  document.getElementById('cmInstructor').textContent = instructorName;

  const willGet = hoursUntil >= 48;
  const policyEl = document.getElementById('cancelPolicyNote');
  policyEl.className = 'cancel-policy' + (willGet ? ' safe' : '');
  policyEl.innerHTML = willGet
    ? '✓ You are cancelling more than 48 hours before the lesson. <strong>Your lesson will be returned automatically.</strong>'
    : '⚠ This lesson is within 48 hours. <strong>Your lesson will be forfeited</strong> in line with the cancellation policy.';

  // Show acknowledgment checkbox for sub-48hr cancellations
  const ackLabel = document.getElementById('cancelAckLabel');
  const ackCheck = document.getElementById('cancelAckCheck');
  ackCheck.checked = false;
  ackLabel.style.display = willGet ? 'none' : 'flex';

  // Series cancel option
  const seriesOption = document.getElementById('cancelSeriesOption');
  const seriesCheck = document.getElementById('cancelSeriesCheck');
  seriesCheck.checked = false;
  document.getElementById('cancelSeriesInfo').style.display = 'none';
  if (seriesId) {
    seriesOption.style.display = 'block';
    // If opened from the "Cancel series" button, pre-check it
    if (hoursUntil === 999) {
      seriesCheck.checked = true;
      toggleCancelSeriesInfo();
      // Override policy display for series
      policyEl.className = 'cancel-policy safe';
      policyEl.innerHTML = '✓ Each lesson in the series will be assessed individually. Lessons 48+ hours away will be refunded.';
    }
  } else {
    seriesOption.style.display = 'none';
  }

  document.getElementById('cancelBtnLabel').textContent = seriesCheck.checked ? 'Cancel series' : 'Cancel lesson';
  document.getElementById('btnConfirmCancel').disabled = !willGet && !seriesCheck.checked;
  document.getElementById('cancelModal').classList.add('open');
}
window.openCancelModal = openCancelModal;

function toggleCancelSeriesInfo() {
  const checked = document.getElementById('cancelSeriesCheck').checked;
  document.getElementById('cancelSeriesInfo').style.display = checked ? 'block' : 'none';
  document.getElementById('cancelBtnLabel').textContent = checked ? 'Cancel series' : 'Cancel lesson';
  if (checked) {
    document.getElementById('cancelSeriesInfo').textContent = 'All remaining lessons in this weekly series will be cancelled. Refunds apply per the 48-hour policy.';
    document.getElementById('btnConfirmCancel').disabled = false;
  }
}
window.toggleCancelSeriesInfo = toggleCancelSeriesInfo;

function toggleCancelBtn() {
  const ackCheck = document.getElementById('cancelAckCheck');
  document.getElementById('btnConfirmCancel').disabled = !ackCheck.checked;
}
window.toggleCancelBtn = toggleCancelBtn;

async function confirmCancel() {
  if (!pendingCancel) return;
  const btn = document.getElementById('btnConfirmCancel');
  const cancelSeries = document.getElementById('cancelSeriesCheck').checked && pendingCancel.seriesId;
  btn.disabled = true;
  document.getElementById('cancelBtnLabel').textContent = cancelSeries ? 'Cancelling series…' : 'Cancelling…';

  try {
    const body = { booking_id: pendingCancel.bookingId };
    if (cancelSeries) body.cancel_series = true;
    const res = await ccAuth.fetchAuthed('/api/slots?action=cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    creditBalance = data.credit_balance;
    balanceMinutes = data.balance_minutes || 0;
    updateCreditBadge();
    document.getElementById('cancelModal').classList.remove('open');
    showToast(data.message, data.credit_returned !== false ? 'success' : '');
    loadedRanges = []; slotCache = {};
    await Promise.all([loadUpcoming(), initFeed()]);
  } catch (err) {
    showToast(err.message || 'Cancellation failed.', 'error');
    btn.disabled = false;
    document.getElementById('cancelBtnLabel').textContent = cancelSeries ? 'Cancel series' : 'Cancel lesson';
  }
}

// ─── Reschedule flow ────────────────────────────────────────────────────────
function startRescheduleMode(bookingId, date, start, end, instructorName, instructorId) {
  pendingReschedule = { bookingId, date, start, end, instructorName, instructorId };
  const dateStr = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
  document.getElementById('rescheduleBannerText').textContent = `${dateStr} at ${start} with ${instructorName}`;
  document.getElementById('rescheduleBanner').style.display = 'flex';
  showToast('Select a new time slot below to reschedule your lesson', '');
}
window.startRescheduleMode = startRescheduleMode;

function cancelRescheduleMode() {
  pendingReschedule = null;
  document.getElementById('rescheduleBanner').style.display = 'none';
}
window.cancelRescheduleMode = cancelRescheduleMode;

function openRescheduleConfirm(newSlot) {
  // Show confirmation modal with old → new times
  const oldDateStr = new Date(pendingReschedule.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  const newDateStr = new Date(newSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });

  document.getElementById('rmOldDateTime').textContent = `${oldDateStr} at ${pendingReschedule.start}`;
  document.getElementById('rmNewDateTime').textContent = `${newDateStr} at ${newSlot.start_time}`;
  document.getElementById('rmInstructor').textContent = pendingReschedule.instructorName;
  document.getElementById('rescheduleBtnLabel').textContent = 'Move lesson';
  document.getElementById('rescheduleSpinner').style.display = 'none';
  document.getElementById('btnConfirmReschedule').disabled = false;
  document.getElementById('btnConfirmReschedule').onclick = () => confirmReschedule(newSlot);
  document.getElementById('rescheduleModal').classList.add('open');
}

function closeRescheduleModal() {
  document.getElementById('rescheduleModal').classList.remove('open');
}
window.closeRescheduleModal = closeRescheduleModal;

async function confirmReschedule(newSlot) {
  const btn = document.getElementById('btnConfirmReschedule');
  btn.disabled = true;
  document.getElementById('rescheduleBtnLabel').textContent = 'Moving…';
  document.getElementById('rescheduleSpinner').style.display = 'block';

  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: pendingReschedule.bookingId,
        new_date: newSlot.date,
        new_start_time: newSlot.start_time
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeRescheduleModal();
    cancelRescheduleMode();
    showToast(data.message || 'Lesson rescheduled successfully!', 'success');
    loadedRanges = []; slotCache = {};
    await Promise.all([loadUpcoming(), initFeed()]);
  } catch (err) {
    showToast(err.message || 'Reschedule failed.', 'error');
    btn.disabled = false;
    document.getElementById('rescheduleBtnLabel').textContent = 'Move lesson';
    document.getElementById('rescheduleSpinner').style.display = 'none';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDaysLocal(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function getWeekStart(d) {
  const r = new Date(d);
  const dow = r.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + diff);
  r.setHours(0,0,0,0);
  return r;
}
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function signOut() { ccAuth.logout(); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── Slot reservation countdown ──────────────────────────────────────────────
let slotTimerInterval = null;
function startSlotTimer() {
  clearSlotTimer();
  let remaining = 600; // 10 minutes in seconds
  const timerEl = document.getElementById('slotTimer');
  const valEl = document.getElementById('slotTimerValue');
  timerEl.style.display = 'block';
  valEl.style.color = 'var(--muted)';
  function tick() {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    valEl.textContent = mins + ':' + String(secs).padStart(2, '0');
    if (remaining <= 60) valEl.style.color = 'var(--red)';
    if (remaining <= 0) {
      clearSlotTimer();
      valEl.textContent = 'expired';
      showToast('Your slot reservation has expired. Please select a new slot.', 'error');
      closeBookModal();
      return;
    }
    remaining--;
  }
  tick();
  slotTimerInterval = setInterval(tick, 1000);
}
function clearSlotTimer() {
  if (slotTimerInterval) { clearInterval(slotTimerInterval); slotTimerInterval = null; }
  const el = document.getElementById('slotTimer');
  if (el) el.style.display = 'none';
}

// ─── Inline field validation helpers ─────────────────────────────────────────
function showFieldError(inputEl, errId) {
  inputEl.classList.add('input-error');
  const msg = document.getElementById(errId);
  if (msg) msg.classList.add('show');
}
function clearFieldError(inputEl) {
  inputEl.classList.remove('input-error');
  const errEl = inputEl.closest('div')?.querySelector('.field-error-msg') ||
                inputEl.parentElement?.querySelector('.field-error-msg');
  if (errEl) errEl.classList.remove('show');
}
function clearAllGuestErrors() {
  document.querySelectorAll('#guestFields .input-error').forEach(el => el.classList.remove('input-error'));
  document.querySelectorAll('#guestFields .field-error-msg.show').forEach(el => el.classList.remove('show'));
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

function showWaitlistJoin(dayOfWeek, dateStr) {
  const area = document.getElementById('waitlistFormArea');
  if (!area) return;

  // Build time options (07:00 - 21:00 in 30-min steps)
  let timeOpts = '<option value="">Any time</option>';
  for (let h = 7; h <= 21; h++) {
    for (const m of ['00', '30']) {
      if (h === 21 && m === '30') continue;
      const val = String(h).padStart(2, '0') + ':' + m;
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = m === '00' ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
      timeOpts += `<option value="${val}">${label}</option>`;
    }
  }

  // Get current instructor filter
  const instrSel = document.getElementById('instructorFilter');
  const instrId = instrSel ? instrSel.value : '';
  const instrName = instrSel && instrSel.value ? instrSel.options[instrSel.selectedIndex].text : 'Any instructor';

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  area.innerHTML = `
    <div class="waitlist-form">
      <label>Day</label>
      <select id="wlDay">
        <option value="${dayOfWeek}">${dayNames[dayOfWeek]}</option>
        <option value="">Any day (match my availability)</option>
      </select>
      <label>From</label>
      <select id="wlStart">${timeOpts}</select>
      <label>To</label>
      <select id="wlEnd">${timeOpts}</select>
      <div class="waitlist-check-row">
        <input type="checkbox" id="wlUseAvail" data-action="toggle-waitlist-avail">
        <span>Match my weekly availability instead</span>
      </div>
      <input type="hidden" id="wlInstructor" value="${instrId}">
      <div class="waitlist-form-actions">
        <button class="btn-waitlist-submit" id="btnWlJoin" data-action="submit-waitlist-join">Join Waitlist</button>
        <button class="btn-waitlist-cancel" data-action="close-waitlist-form">Cancel</button>
      </div>
    </div>`;
}

function toggleWaitlistAvail() {
  const useAvail = document.getElementById('wlUseAvail').checked;
  const dayEl = document.getElementById('wlDay');
  const startEl = document.getElementById('wlStart');
  const endEl = document.getElementById('wlEnd');
  dayEl.disabled = useAvail;
  startEl.disabled = useAvail;
  endEl.disabled = useAvail;
  if (useAvail) {
    dayEl.value = '';
    startEl.value = '';
    endEl.value = '';
  }
}

async function submitWaitlistJoin() {
  const btn = document.getElementById('btnWlJoin');
  btn.disabled = true; btn.textContent = 'Joining…';

  const useAvail = document.getElementById('wlUseAvail').checked;
  const body = { use_my_availability: useAvail };

  if (!useAvail) {
    const day = document.getElementById('wlDay').value;
    const start = document.getElementById('wlStart').value;
    const end = document.getElementById('wlEnd').value;
    if (day !== '') body.preferred_day = parseInt(day);
    if (start && end) {
      if (start >= end) {
        showToast('End time must be after start time', 'error');
        btn.disabled = false; btn.textContent = 'Join Waitlist';
        return;
      }
      body.preferred_start_time = start;
      body.preferred_end_time = end;
    }
  }

  const instrId = document.getElementById('wlInstructor').value;
  if (instrId) body.instructor_id = parseInt(instrId);
  if (selectedLessonType) body.lesson_type_id = selectedLessonType.id;

  try {
    const res = await ccAuth.fetchAuthed('/api/waitlist?action=join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('waitlistFormArea').innerHTML = `
      <div class="waitlist-success">
        You're on the waitlist! We'll WhatsApp and email you when a matching slot opens.
      </div>`;
  } catch (err) {
    showToast(err.message || 'Failed to join waitlist', 'error');
    btn.disabled = false; btn.textContent = 'Join Waitlist';
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
init();


// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'select-lesson-type') {
    var id = parseInt(target.dataset.ltId, 10);
    if (!isNaN(id)) selectLessonType(id);
  } else if (action === 'open-book-modal') {
    openBookModal(target);
  } else if (action === 'submit-waitlist-join') {
    submitWaitlistJoin();
  } else if (action === 'close-waitlist-form') {
    var area = document.getElementById('waitlistFormArea');
    if (area) area.innerHTML = '';
  }
});
document.addEventListener('change', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'toggle-waitlist-avail') toggleWaitlistAvail();
});

// ── Static handlers previously inline in the HTML ──
(function wireStaticHandlers() {
  var bannerDismiss = document.querySelector('.banner-dismiss');
  if (bannerDismiss) bannerDismiss.addEventListener('click', dismissWelcome);
  var rescheduleCancel = document.getElementById('rescheduleCancelBtn');
  if (rescheduleCancel) rescheduleCancel.addEventListener('click', cancelRescheduleMode);
  var instFilter = document.getElementById('instructorFilter');
  if (instFilter) instFilter.addEventListener('change', onFilterChange);
  var savePostcodeBtn = document.getElementById('btnSavePostcode');
  if (savePostcodeBtn) savePostcodeBtn.addEventListener('click', savePickupPostcode);
  var loadMoreBtn = document.getElementById('btnLoadMore');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreSlots);
  ['mdGuestName', 'mdGuestEmail', 'mdGuestPhone', 'mdGuestPickup'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function () { clearFieldError(el); });
  });
  var guestTerms = document.getElementById('mdGuestTerms');
  if (guestTerms) guestTerms.addEventListener('change', function () { clearFieldError(guestTerms); });
  var repeatToggle = document.getElementById('repeatToggle');
  if (repeatToggle) repeatToggle.addEventListener('change', toggleRepeatOptions);
  var repeatWeeks = document.getElementById('repeatWeeksSelect');
  if (repeatWeeks) repeatWeeks.addEventListener('change', updateRepeatDates);
  var cancelSeries = document.getElementById('cancelSeriesCheck');
  if (cancelSeries) cancelSeries.addEventListener('change', toggleCancelSeriesInfo);
  var cancelAck = document.getElementById('cancelAckCheck');
  if (cancelAck) cancelAck.addEventListener('change', toggleCancelBtn);
  var rescheduleModalClose = document.getElementById('rescheduleModalCancelBtn');
  if (rescheduleModalClose) rescheduleModalClose.addEventListener('click', closeRescheduleModal);
})();

})();
