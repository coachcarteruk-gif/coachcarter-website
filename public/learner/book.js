(function () {
  'use strict';


// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_PRICE_PENCE = 8250; // fallback if lesson-types API fails

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
const FEED_MAX_DAYS   = 84;
// Overflow lead routing (plan item 1.2). When a specific instructor is selected
// and they have zero slots across the full 84-day window, render a slot-feed of
// alternatives from the school's other active instructors. State below is reset
// on filter change via onFilterChange().
let overflowMode  = false;            // true when chosen instructor has 0 slots in 84d
let overflowCache = null;             // { dateStr: [slot, ...] } for alternatives, or null
let overflowFingerprint = null;       // `${ltId}|${postcode}` — invalidates cache on change
let pendingSlot   = null;
let pendingCancel = null;
let preselectedTypeSlug = null;
let preselectedInstructorSlug = null;
let preselectedTypeId = null;
let prefilledName = null; // from ?name= URL param (shareable booking link)
let pendingReschedule = null; // { bookingId, date, start, end, instructorName, instructorId }
let lastBookingId = null;
let learnerProfile = { phone: '', pickup_address: '' };
let hasFreeTrialSlot = false; // true if current school has a lesson_type with slug='trial'
// Slot-first state: full list of selectable lesson types (excludes 'trial')
// and the smallest active duration in minutes "” used for slot-feed grid spacing.
let availableLessonTypes = [];
let slotFeedDuration = 60; // sensible default; updated from availableLessonTypes
let slotFeedLessonTypeId = null; // id of the lesson type whose duration we use for grid spacing

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      ? 'Payment successful "” your lesson is booked! Check your email for details.'
      : 'Booking confirmed! Check your email for details and a link to manage your bookings.';
    showToast(paidMsg, 'success');
    window.history.replaceState({}, '', '/learner/book.html');
  }
  if (params.get('cancelled') === '1') {
    showToast('Payment cancelled "” the slot has been released.', '');
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
  const claimTrialLink = document.getElementById('claimTrialLink');
  if (claimTrialLink) claimTrialLink.onclick = handleClaimTrialClick;
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
    // Spectator-mode banner: show guest hint, suppress the "No hours on your account" banner
    // (it reads as broken for someone who has no account at all).
    const guestBanner = document.getElementById('guestBanner');
    if (guestBanner) guestBanner.style.display = 'flex';
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

// â”€â”€â”€ Balance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Hide credits banner for guests (they have no account "” guestBanner covers this case)
  // and when payments are disabled.
  document.getElementById('noCreditsBanner').style.display = (auth && paymentsEnabled && balanceMinutes === 0) ? 'flex' : 'none';
}

// â”€â”€â”€ Lesson Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    hasFreeTrialSlot = lessonTypes.some(lt => lt && lt.slug === 'trial');
    // Slot-first: cache the full bookable list (sans trial) and pick the
    // smallest active duration to drive feed grid spacing. The duration
    // dropdown inside the booking modal is built from this list.
    availableLessonTypes = lessonTypes.filter(lt => lt && lt.slug !== 'trial');
    if (availableLessonTypes.length > 0) {
      const minLt = availableLessonTypes.reduce((a, b) => (a.duration_minutes <= b.duration_minutes ? a : b));
      slotFeedDuration = minLt.duration_minutes;
      slotFeedLessonTypeId = minLt.id;
    }
    // Slot-first: selectedLessonType is set by the modal's duration picker
    // when the user clicks a slot, not at page-load time. The ?type= URL
    // params (preselectedTypeSlug / preselectedTypeId) are read directly by
    // loadDurationsForSlot to drive the dropdown preselect.
  } catch (err) {
    console.error('Failed to load lesson types:', err);
    lessonTypes = [{ id: null, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: DEFAULT_PRICE_PENCE, colour: '#3b82f6' }];
  }
}

// â”€â”€â”€ Instructors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Upcoming bookings (compact next-lesson card) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Learner profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    showToast('Pickup postcode saved "” filtering slots by travel time', 'success');

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

// â”€â”€â”€ Feed controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function onFilterChange() {
  loadedRanges = []; slotCache = {};
  // Lesson-type / postcode filters affect alternatives too — overflow cache is per (ltId|postcode).
  // Instructor change just re-runs initFeed() which will rebuild overflow detection from scratch.
  overflowMode = false;
  overflowCache = null;
  overflowFingerprint = null;
  loadLessonTypes();
  initFeed();
}

async function initFeed() {
  // Slot-first: feed loads at the smallest active duration regardless of any
  // single "selected" lesson type. The duration is picked inside the modal.
  feedFrom = new Date(); feedFrom.setHours(0,0,0,0);
  feedTo = addDaysLocal(feedFrom, FEED_CHUNK_DAYS - 1);
  const maxDate = addDaysLocal(feedFrom, FEED_MAX_DAYS);
  if (feedTo > maxDate) feedTo = maxDate;
  slotCache = {};
  loadedRanges = [];
  overflowMode = false; // re-evaluated below
  showLoading();

  const instructorId = document.getElementById('instructorFilter').value;

  // Overflow lead routing (plan item 1.2). Only when a specific instructor is
  // selected do we eagerly fetch the full 84-day window — needed to know whether
  // they're truly empty (chunked load could falsely declare empty on chunk 1).
  if (instructorId) {
    const fullTo = addDaysLocal(feedFrom, FEED_MAX_DAYS);
    // Eager full-window fetch is needed to know if the chosen instructor is truly empty
    // (chunked load could falsely declare empty after only chunk 1). Side benefit: when
    // the learner picks one specific instructor, showing all 84 days of their diary at
    // once is a better UX than chunked load-more clicks.
    const ok = await fetchFeedSlots(feedFrom, fullTo);
    if (ok === false) return;
    feedTo = fullTo; // hide load-more — full window already rendered
    const chosenHasSlots = Object.values(slotCache).some(arr => arr && arr.length > 0);
    if (!chosenHasSlots && instructors.length > 1) {
      // Fetch alternatives (all-instructor query) once, cache by lesson-type + postcode.
      const ltId = slotFeedLessonTypeId || (selectedLessonType && selectedLessonType.id) || '';
      const pc = getLearnerPostcode() || '';
      const fingerprint = `${ltId}|${pc}`;
      if (!overflowCache || overflowFingerprint !== fingerprint) {
        overflowCache = {};
        overflowFingerprint = fingerprint;
        const altOk = await fetchFeedSlots(feedFrom, fullTo, {
          targetCache: overflowCache,
          omitInstructor: true,
          skipTravelBanner: true,
          skipRangeDedup: true
        });
        if (altOk === false) { overflowCache = null; overflowFingerprint = null; renderFeed(); return; }
      }
      overflowMode = true;
    }
    renderFeed();
    return;
  }

  // No specific instructor — original chunked load path.
  const ok = await fetchFeedSlots(feedFrom, feedTo);
  if (ok === false) return;
  renderFeed();
}

async function fetchFeedSlots(fromDate, toDate, opts) {
  // opts (all optional):
  //   targetCache  — write slots into this object instead of slotCache (for overflow alternatives).
  //   omitInstructor — drop ?instructor_id from the query (overflow path uses this to fetch all-instructor slots).
  //   skipTravelBanner — don't update the travel-hidden banner from this fetch.
  //   skipRangeDedup — don't consult/write loadedRanges (overflow has its own fingerprint cache).
  opts = opts || {};
  const targetCache = opts.targetCache || slotCache;

  const today = new Date(); today.setHours(0,0,0,0);
  let from = fmtDate(fromDate < today ? today : fromDate);
  let to = fmtDate(toDate);
  const maxDate = fmtDate(addDaysLocal(today, FEED_MAX_DAYS));
  if (from > maxDate) return true;
  if (to > maxDate) to = maxDate;

  const instructorId = opts.omitInstructor ? '' : document.getElementById('instructorFilter').value;
  // Slot-first: feed renders at the smallest active duration, agnostic of which
  // lesson type the learner will eventually pick. The grid lesson_type_id sets
  // the slot length; min_duration_only=1 tells the API to skip the
  // offered_lesson_types filter (per-duration check happens on slot click).
  const ltId = slotFeedLessonTypeId || (selectedLessonType && selectedLessonType.id) || '';
  const cacheKey = `${from}|${to}|${instructorId}|${ltId}|mdo`;
  if (!opts.skipRangeDedup && loadedRanges.includes(cacheKey)) return true;

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
      let url = `/api/slots?action=available&from=${chunk.from}&to=${chunk.to}&min_duration_only=1`;
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
        if (!targetCache[ds]) targetCache[ds] = [];
        for (const s of slots[ds]) {
          if (!targetCache[ds].find(x => x.date === s.date && x.start_time === s.start_time && x.instructor_id === s.instructor_id)) {
            targetCache[ds].push(s);
          }
        }
      }
    }
    if (!opts.skipTravelBanner) {
      const banner = document.getElementById('travelHiddenBanner');
      if (travelHidden > 0) {
        document.getElementById('travelHiddenText').textContent =
          `${travelHidden} slot${travelHidden === 1 ? '' : 's'} hidden due to travel distance from your pickup address`;
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }
    if (!opts.skipRangeDedup) loadedRanges.push(cacheKey);
    return true;
  } catch (err) {
    console.error('fetchFeedSlots error:', err);
    if (!opts.targetCache) showError(err.message || 'Failed to load available slots');
    return false;
  }
}

// Build the inner slot-feed HTML (date headers + cards) from a flat slot list.
// Shared by the normal feed and the overflow-alternatives feed.
function buildSlotFeedHtml(allSlots) {
  const today = new Date(); today.setHours(0,0,0,0);
  let html = '<div class="slot-feed">';
  let lastDateStr = '';
  for (const s of allSlots) {
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
    const timeStr = s.start_time.slice(0, 5);
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
  return html;
}

function renderFeed() {
  // Overflow lead routing (plan item 1.2): chosen instructor has zero slots
  // across the full 84-day window. Render heading + subheading + alternatives.
  if (overflowMode) {
    const chosenId = document.getElementById('instructorFilter').value;
    const chosen = instructors.find(i => String(i.id) === String(chosenId));
    const fullName = (chosen && chosen.name) || 'this instructor';
    const firstName = fullName.includes(' ') ? fullName.split(' ')[0] : fullName;

    // Render alternatives within the same date window as the normal feed.
    const altSlots = [];
    const fromStr = fmtDate(feedFrom);
    const toStr = fmtDate(feedTo);
    for (const ds in (overflowCache || {})) {
      if (ds < fromStr || ds > toStr) continue;
      for (const s of overflowCache[ds]) altSlots.push(s);
    }
    altSlots.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start_time < b.start_time ? -1 : 1;
    });

    if (altSlots.length === 0) {
      // Edge case: even alternatives have no slots in the loaded window.
      // This happens when (a) school has only one active instructor (already
      // handled in initFeed by skipping overflowMode) or (b) lesson-type /
      // postcode filter narrows alternatives to zero.
      document.getElementById('calContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h3>No slots with ${esc(firstName)} in the next 12 weeks.</h3>
          <p>No slots found with our other instructors either. Try a different lesson type or check back later.</p>
        </div>`;
      updateFeedFooter(0);
      return;
    }

    const html = `
      <div class="overflow-section">
        <h3 class="overflow-heading">No slots with ${esc(firstName)} in the next 12 weeks.</h3>
        <p class="overflow-subhead">Slots with our other instructors:</p>
        ${buildSlotFeedHtml(altSlots)}
      </div>`;
    document.getElementById('calContent').innerHTML = html;
    updateFeedFooter(altSlots.length);
    return;
  }

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

  document.getElementById('calContent').innerHTML = buildSlotFeedHtml(allSlots);
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

// â”€â”€â”€ Book modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Apply a chosen lesson type to all the price/duration/credit/pay UI inside
// the modal. Called from openBookModal after dropdown selection (or auto-pick
// when only one option fits). Pure UI write "” no side effects beyond the DOM
// and selectedLessonType.
function applyLessonTypeToModal(lt, isGuest, needsProfileFields) {
  selectedLessonType = lt;
  const ltDuration = lt.duration_minutes;
  // Recompute pendingSlot.end_time to match the picked duration. Backend
  // handlers (handleBook, handleCheckoutSlot, handleCheckoutSlotGuest) read
  // start_time + end_time from the body "” they must reflect the user's choice,
  // not the grid's smallest-duration end-time.
  if (pendingSlot && pendingSlot.start_time) {
    const [h, m] = pendingSlot.start_time.split(':').map(Number);
    const startMins = h * 60 + m;
    const endMins = startMins + ltDuration;
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    pendingSlot.end_time = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    document.getElementById('mdTime').textContent = `${pendingSlot.start_time} "“ ${pendingSlot.end_time}`;
  }
  const ltHrs = ltDuration / 60;
  const ltHrsStr = ltHrs % 1 === 0 ? `${ltHrs} hour${ltHrs !== 1 ? 's' : ''}` : `${ltHrs.toFixed(1)} hours`;
  document.getElementById('mdDuration').textContent = ltHrsStr;
  document.getElementById('mdDeductHours').textContent = ltHrsStr;
  const ltPrice = lt.price_pence != null ? lt.price_pence : DEFAULT_PRICE_PENCE;
  const ltPriceStr = 'Â£' + (ltPrice / 100).toFixed(2);
  document.getElementById('mdPayAmount').textContent = ltPriceStr;
  document.getElementById('payBtnLabel').textContent = `Pay ${ltPriceStr} & book`;
  document.getElementById('paySpinner').style.display = 'none';
  document.getElementById('btnPayAndBook').disabled = false;

  // Credit-vs-pay path is duration-dependent for authed users.
  if (isGuest) {
    document.getElementById('modalCreditPath').style.display = 'none';
    document.getElementById('modalPayPath').style.display = 'block';
  } else if (!paymentsEnabled) {
    document.getElementById('modalCreditPath').style.display = 'block';
    document.getElementById('modalPayPath').style.display = 'none';
    document.getElementById('mdDeductHours').textContent = 'free "” no credits required';
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
    updateBalanceLine(ltDuration);
  }
}

function openBookModal(el) {
  const isGuest = !auth;
  const needsProfileFields = !isGuest && !isProfileComplete();

  // Reschedule mode bypasses the duration picker "” rescheduled bookings keep their original duration.
  if (pendingReschedule) {
    if (isGuest) { if (window.ccAuth) window.ccAuth.requireAuth(); return; }
    openRescheduleConfirm({
      instructor_id: el.dataset.instructorId,
      date:          el.dataset.date,
      start_time:    el.dataset.start,
      end_time:      el.dataset.end
    });
    return;
  }

  window.posthog && posthog.capture('slot_clicked', {
    instructor_id: el.dataset.instructorId,
    date: el.dataset.date,
    is_guest: isGuest
  });

  pendingSlot = {
    instructor_id:   el.dataset.instructorId,
    date:            el.dataset.date,
    start_time:      el.dataset.start,
    end_time:        el.dataset.end, // grid end-time; will be overwritten when duration is picked
    instructor_name: el.dataset.instructorName
  };
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('mdDate').textContent = dateDisplay;
  document.getElementById('mdTime').textContent = pendingSlot.start_time;
  document.getElementById('mdInstructor').textContent = pendingSlot.instructor_name;
  document.getElementById('mdDropoff').value = '';

  // Reset duration-picker UI to loading state.
  document.getElementById('mdDurationPicker').style.display = 'none';
  document.getElementById('mdSingleTypeRow').style.display = 'none';
  document.getElementById('mdNoFitRow').style.display = 'none';
  document.getElementById('mdLoadingRow').style.display = 'flex';
  document.getElementById('mdDuration').textContent = '"”';
  document.getElementById('btnPayAndBook').disabled = true;
  document.getElementById('btnConfirmBook') && (document.getElementById('btnConfirmBook').disabled = true);
  selectedLessonType = null;

  // Guest vs authed UI scaffolding (independent of duration choice).
  if (isGuest) {
    document.getElementById('guestFields').style.display = 'block';
    document.getElementById('repeatSection').style.display = 'none';
    document.getElementById('mdGuestName').value = prefilledName || '';
    document.getElementById('mdGuestEmail').value = '';
    document.getElementById('mdGuestPhone').value = '';
    document.getElementById('mdGuestPickup').value = '';
    document.getElementById('mdGuestTerms').checked = false;
    const claimCta = document.getElementById('claimTrialCta');
    if (claimCta) {
      if (hasFreeTrialSlot) {
        claimCta.style.display = 'block';
        window.posthog && posthog.capture('claim_trial_cta_shown', {
          instructor_id: pendingSlot.instructor_id,
          date: pendingSlot.date
        });
      } else {
        claimCta.style.display = 'none';
      }
    }
  } else {
    document.getElementById('guestFields').style.display = 'none';
    const claimCta = document.getElementById('claimTrialCta');
    if (claimCta) claimCta.style.display = 'none';
    document.getElementById('repeatSection').style.display = '';
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
  }

  document.getElementById('bookConfirmStep').style.display = 'block';
  document.getElementById('bookSuccessStep').style.display = 'none';
  document.getElementById('bookModal').classList.add('open');
  startSlotTimer();

  // Fire the duration check.
  loadDurationsForSlot(pendingSlot, isGuest, needsProfileFields);
}

// Fetch durations-for-slot, populate the dropdown (or single-type confirmation
// row), preselect, and call applyLessonTypeToModal. Surfaces a no-fit empty
// state when nothing's bookable.
async function loadDurationsForSlot(slot, isGuest, needsProfileFields) {
  const select = document.getElementById('mdLessonTypeSelect');
  try {
    let url = `/api/slots?action=durations-for-slot&instructor_id=${encodeURIComponent(slot.instructor_id)}&date=${encodeURIComponent(slot.date)}&start_time=${encodeURIComponent(slot.start_time)}`;
    const pc = getLearnerPostcode();
    if (pc) url += `&pickup_postcode=${encodeURIComponent(pc)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load durations');

    const durations = (data.durations || []).slice().sort((a, b) => a.duration_minutes - b.duration_minutes);
    const fitting = durations.filter(d => d.fits);

    document.getElementById('mdLoadingRow').style.display = 'none';

    window.posthog && posthog.capture('durations_loaded', {
      instructor_id: slot.instructor_id,
      date: slot.date,
      start_time: slot.start_time,
      fits_count: fitting.length,
      total_count: durations.length
    });

    if (fitting.length === 0) {
      window.posthog && posthog.capture('slot_no_durations_fit', {
        instructor_id: slot.instructor_id,
        date: slot.date,
        start_time: slot.start_time,
        reasons: Array.from(new Set(durations.map(d => d.reason).filter(Boolean)))
      });
      // No-fit empty state.
      const reasons = Array.from(new Set(durations.map(d => d.reason).filter(Boolean)));
      const reasonText = reasons.includes('travel') ? 'travel time prevents any duration here'
                       : reasons.includes('clash')  ? 'this time clashes with an existing booking'
                       : reasons.includes('window') ? 'this is outside the instructor\'s working hours for that length'
                       : reasons.includes('notice') ? 'too short notice for any duration'
                       : 'no lesson lengths fit this slot';
      document.getElementById('mdNoFitText').textContent = reasonText;
      document.getElementById('mdNoFitRow').style.display = 'flex';
      document.getElementById('mdDuration').textContent = '"”';
      // Disable both confirm paths; user has to close + pick another slot.
      document.getElementById('btnPayAndBook').disabled = true;
      const credBtn = document.getElementById('btnConfirmBook');
      if (credBtn) credBtn.disabled = true;
      return;
    }

    // Auto-collapse when there's only one option for the school AND only one fits.
    if (durations.length === 1 && fitting.length === 1) {
      document.getElementById('mdSingleType').textContent = `${fitting[0].name} "” ${formatHours(fitting[0].duration_minutes)} "” Â£${(fitting[0].price_pence / 100).toFixed(2)}`;
      document.getElementById('mdSingleTypeRow').style.display = 'flex';
      applyLessonTypeToModal(fitting[0], isGuest, needsProfileFields);
      window.posthog && posthog.capture('duration_selected', {
        lesson_type_slug: fitting[0].slug,
        duration_minutes: fitting[0].duration_minutes,
        price_pence: fitting[0].price_pence,
        was_preselected: true,
        source: 'single_option',
        fits: true,
        all_options: durations.map(d => d.slug)
      });
      return;
    }

    // Render dropdown "” fitting options first, non-fitting disabled with a reason suffix.
    select.innerHTML = '';
    for (const d of fitting) {
      const opt = document.createElement('option');
      opt.value = String(d.lesson_type_id);
      opt.textContent = `${d.name} "” ${formatHours(d.duration_minutes)} "” Â£${(d.price_pence / 100).toFixed(2)}`;
      select.appendChild(opt);
    }
    for (const d of durations.filter(d => !d.fits)) {
      const opt = document.createElement('option');
      opt.value = String(d.lesson_type_id);
      opt.disabled = true;
      const why = d.reason === 'travel' ? 'travel' : d.reason === 'clash' ? 'clash' : d.reason === 'window' ? 'too long' : d.reason === 'notice' ? 'short notice' : d.reason === 'not_offered' ? 'not offered' : 'unavailable';
      opt.textContent = `${d.name} "” ${formatHours(d.duration_minutes)} "” unavailable (${why})`;
      select.appendChild(opt);
    }
    // Preselect order: ?type= URL slug â†’ cc_last_lesson_type_id (returning
    // learner default) â†’ first fitting (smallest). No expiry on the
    // localStorage value "” driving lessons are infrequent, want stickiness.
    let preselected = null;
    let preselectSource = 'default';
    if (preselectedTypeSlug) {
      preselected = fitting.find(d => d.slug === preselectedTypeSlug);
      if (preselected) preselectSource = 'url_param';
    } else if (preselectedTypeId) {
      preselected = fitting.find(d => String(d.lesson_type_id) === String(preselectedTypeId));
      if (preselected) preselectSource = 'url_param';
    }
    if (!preselected) {
      try {
        const lastId = localStorage.getItem('cc_last_lesson_type_id');
        if (lastId) {
          preselected = fitting.find(d => String(d.lesson_type_id) === lastId);
          if (preselected) preselectSource = 'localStorage';
        }
      } catch (_) { /* localStorage may be unavailable in private mode */ }
    }
    if (!preselected) preselected = fitting[0];
    select.value = String(preselected.lesson_type_id);
    document.getElementById('mdDurationPicker').style.display = 'flex';
    const usualHint = document.getElementById('mdUsualHint');
    if (usualHint) usualHint.style.display = preselectSource === 'localStorage' ? 'block' : 'none';
    applyLessonTypeToModal(preselected, isGuest, needsProfileFields);
    window.posthog && posthog.capture('duration_selected', {
      lesson_type_slug: preselected.slug,
      duration_minutes: preselected.duration_minutes,
      price_pence: preselected.price_pence,
      was_preselected: true,
      source: preselectSource,
      fits: true,
      all_options: durations.map(d => d.slug)
    });

    select.onchange = function () {
      const lt = durations.find(d => String(d.lesson_type_id) === select.value);
      if (!lt || !lt.fits) return; // disabled options shouldn't be selectable
      // Manual change clears the "using your usual" hint.
      const usualHintInner = document.getElementById('mdUsualHint');
      if (usualHintInner) usualHintInner.style.display = 'none';
      applyLessonTypeToModal(lt, isGuest, needsProfileFields);
      window.posthog && posthog.capture('duration_selected', {
        lesson_type_slug: lt.slug,
        duration_minutes: lt.duration_minutes,
        price_pence: lt.price_pence,
        was_preselected: false,
        source: 'manual',
        fits: true,
        all_options: durations.map(d => d.slug)
      });
    };
  } catch (err) {
    console.error('durations-for-slot failed:', err);
    document.getElementById('mdLoadingRow').style.display = 'none';
    document.getElementById('mdNoFitText').textContent = 'Could not load lesson options. Please try another slot.';
    document.getElementById('mdNoFitRow').style.display = 'flex';
  }
}

function formatHours(mins) {
  const h = mins / 60;
  return h % 1 === 0 ? `${h} hour${h !== 1 ? 's' : ''}` : `${h.toFixed(1)} hours`;
}

// Persist the last-picked lesson type so a returning learner sees their usual
// duration preselected on the next booking. No expiry "” driving lessons are
// infrequent and we want stickiness across weeks/months.
function setLastLessonType(lt) {
  if (!lt || !lt.id) return;
  try { localStorage.setItem('cc_last_lesson_type_id', String(lt.id)); } catch (_) {}
}

function closeBookModal() {
  const wasSuccess = document.getElementById('bookSuccessStep').style.display !== 'none';
  window.posthog && posthog.capture('booking_modal_closed', {
    completed: wasSuccess,
    had_duration_selected: !!selectedLessonType
  });
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

// â”€â”€â”€ Repeat weekly logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Check conflicts. The /available endpoint caps each request at 31 days,
  // so chunk by date span: max 4 weekly dates per request (â‰¤21 days span).
  repeatConflicts = [];
  try {
    const ltId = selectedLessonType ? selectedLessonType.id : '';
    const instId = pendingSlot.instructor_id;
    const pc = getLearnerPostcode();
    const allSlots = {};
    const CHUNK_WEEKS = 4;
    for (let i = 0; i < dates.length; i += CHUNK_WEEKS) {
      const chunk = dates.slice(i, i + CHUNK_WEEKS);
      const from = chunk[0];
      const to = chunk[chunk.length - 1];
      const res = await ccAuth.fetchAuthed(`/api/slots?action=available&from=${from}&to=${to}&instructor_id=${instId}${ltId ? '&lesson_type_id=' + ltId : ''}${pc ? '&pickup_postcode=' + pc : ''}`);
      const data = await res.json();
      Object.assign(allSlots, data.slots || {});
    }
    for (let i = 1; i < dates.length; i++) {
      const dateSlots = allSlots[dates[i]] || [];
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
    document.getElementById('repeatTotal').textContent = `Total: ${totalStr} (${weeks} Ã— ${perStr})`;
    document.getElementById('repeatTotal').style.display = 'block';
  } else {
    document.getElementById('repeatTotal').style.display = 'none';
  }

  // Update balance check for credit path visibility
  if (!paymentsEnabled) {
    // Free booking mode "” always show credit path, hide pay path
    document.getElementById('modalCreditPath').style.display = 'block';
    document.getElementById('modalPayPath').style.display = 'none';
    // Update deduction text to indicate free booking
    document.getElementById('mdDeductHours').textContent = 'free "” no credits required';
  } else {
    const hasCreds = balanceMinutes >= totalMins;
    document.getElementById('modalCreditPath').style.display = hasCreds ? 'block' : 'none';
    document.getElementById('modalPayPath').style.display = hasCreds ? 'none' : 'block';
    updateBalanceLine(totalMins);
  }
}

function updateBalanceLine(deductMins) {
  const el = document.getElementById('mdBalanceLine');
  if (!el) return;
  const fmt = m => (m / 60).toFixed(1).replace(/\.0$/, '') + 'h';
  const after = Math.max(0, balanceMinutes - deductMins);
  el.textContent = `You have ${fmt(balanceMinutes)} "” ${fmt(after)} remaining after this booking.`;
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

// â”€â”€â”€ Confirm with credit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    setLastLessonType(selectedLessonType);
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

// â”€â”€â”€ Claim-as-free-trial (guest CTA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Routes the guest to /free-trial.html carrying the chosen instructor + date as
// hints. The trial handler enforces strict duration matching, so the slot itself
// cannot be force-converted "” the guest re-picks a real trial slot on the
// dedicated page. Eligibility (one-trial-per-email/phone) is checked at submit
// time by the existing free-trial handler, not pre-flighted here.
function handleClaimTrialClick(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!pendingSlot) return;
  window.posthog && posthog.capture('claim_trial_cta_clicked', {
    instructor_id: pendingSlot.instructor_id,
    date: pendingSlot.date,
    lesson_type_slug: selectedLessonType?.slug
  });
  const params = new URLSearchParams();
  if (pendingSlot.instructor_id) params.set('instructor_id', pendingSlot.instructor_id);
  if (pendingSlot.date) params.set('date', pendingSlot.date);
  window.location.href = '/free-trial.html' + (params.toString() ? '?' + params.toString() : '');
}

// â”€â”€â”€ Pay & book (Stripe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function confirmPayAndBook() {
  if (!pendingSlot) return;
  // Save profile fields first if shown (phone/pickup for incomplete profiles)
  if (auth && !(await saveProfileFieldsFromModal())) return;

  const btn = document.getElementById('btnPayAndBook');
  const label = document.getElementById('payBtnLabel');
  const spinner = document.getElementById('paySpinner');
  const ltPrice = selectedLessonType ? selectedLessonType.price_pence : DEFAULT_PRICE_PENCE;
  const isGuest = !auth;

  // Guest validation "” inline per-field errors
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
  setLastLessonType(selectedLessonType);
  window.posthog && posthog.capture('booking_pay_initiated', { method: 'stripe', is_guest: isGuest, lesson_type_slug: selectedLessonType?.slug });

  try {
    if (isGuest) {
      // Guest checkout "” no auth required
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
    const priceStr = 'Â£' + (ltPrice / 100).toFixed(2);
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

  const balanceEl = document.getElementById('successBalance');
  if (balanceEl && balanceMinutes > 0) {
    balanceEl.textContent = `Hours remaining: ${(balanceMinutes / 60).toFixed(1)}h`;
    balanceEl.style.display = 'block';
  } else if (balanceEl) {
    balanceEl.style.display = 'none';
  }

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

// â”€â”€â”€ Calendar download & subscribe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    showToast('Calendar file downloaded "” open it to add to your calendar', 'success');
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

// â”€â”€â”€ Cancel modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openCancelModal(bookingId, date, start, end, instructorName, hoursUntil, seriesId) {
  pendingCancel = { bookingId, date, start, end, instructorName, hoursUntil, seriesId: seriesId || null };
  const dateDisplay = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('cmDate').textContent = dateDisplay;
  document.getElementById('cmTime').textContent = `${start} "“ ${end}`;
  document.getElementById('cmInstructor').textContent = instructorName;

  const willGet = hoursUntil >= 48;
  const policyEl = document.getElementById('cancelPolicyNote');
  policyEl.className = 'cancel-policy' + (willGet ? ' safe' : '');
  policyEl.innerHTML = willGet
    ? 'âœ“ You are cancelling more than 48 hours before the lesson. <strong>Your lesson will be returned automatically.</strong>'
    : 'âš  This lesson is within 48 hours. <strong>Your lesson will be forfeited</strong> in line with the cancellation policy.';

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
      policyEl.innerHTML = 'âœ“ Each lesson in the series will be assessed individually. Lessons 48+ hours away will be refunded.';
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

// â”€â”€â”€ Reschedule flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Show confirmation modal with old â†’ new times
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

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Slot reservation countdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Inline field validation helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
init();


// â”€â”€ CSP-friendly event delegation for dynamically rendered handlers â”€â”€
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'open-book-modal') {
    openBookModal(target);
  }
});

// â”€â”€ Static handlers previously inline in the HTML â”€â”€
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
