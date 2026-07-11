(function () {
  'use strict';


// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_PRICE_PENCE = 8250; // fallback if lesson-types API fails
const RECURRING_BLOCK_MIN_LESSONS = 4;
const RECURRING_BLOCK_MAX_LESSONS = 12;

// ─── State ───────────────────────────────────────────────────────────────────
let auth          = null; // null when browsing as guest; { user, ... } when logged in
let creditBalance = 0;
let balanceMinutes = 0;
let selectedInstructorBalanceMinutes = 0;
let paymentsEnabled = true; // assume true until balance API tells us otherwise
let instructors   = [];
let lessonTypes   = [];
// True when lesson-type prices came back instructor-scoped (and learner-scoped
// when signed in), i.e. the exact three-level effective price checkout will
// charge. Only then do we show prices on the length buttons - with "All
// instructors" the API returns school list prices that a per-instructor
// rate override could differ from.
let lessonTypePricesExact = false;
let selectedLessonType = null; // current lesson type object
let selectedDate  = null;
let selectedSlot  = null;
let slotCache     = {}; // dateStr -> [slot, ...]
let loadedRanges  = [];
let feedFrom      = null; // Date: start of loaded window (always today)
let feedTo        = null; // Date: end of currently loaded window
const PLATFORM_MAX_DAYS = 84; // ceiling on instructors.max_booking_days_ahead
const FEED_DEFAULT_DAYS = 28; // fallback when instructor windows are unknown
let dateGridExpanded = false; // date grid shows 6 weeks until expanded

// Learner-facing booking window (July 2026): each instructor's
// max_booking_days_ahead IS the window; 84 days is the platform ceiling.
function instructorWindowDays(instructorId) {
  const inst = instructors.find(i => String(i.id) === String(instructorId));
  const days = parseInt(inst && inst.max_booking_days_ahead, 10);
  if (!Number.isFinite(days) || days <= 0) return FEED_DEFAULT_DAYS;
  return Math.min(days, PLATFORM_MAX_DAYS);
}

// Effective feed window: the chosen instructor's window, or the widest
// window across the school when browsing "All instructors" (the server
// still filters each slot by its own instructor's window).
function feedMaxDays() {
  const selected = document.getElementById('instructorFilter')?.value;
  if (selected) return instructorWindowDays(selected);
  if (!instructors.length) return FEED_DEFAULT_DAYS;
  return Math.max(...instructors.map(i => instructorWindowDays(i.id)));
}

function feedWindowWeeksLabel() {
  const days = feedMaxDays();
  const weeks = Math.max(1, Math.round(days / 7));
  return days < 7 ? `${days} day${days === 1 ? '' : 's'}` : `${weeks} week${weeks === 1 ? '' : 's'}`;
}
let pendingSlot   = null;
// Request-to-book mode: the pending slot's instructor confirms each booking
// personally. Set from the slot dataset, re-confirmed by durations-for-slot.
let slotRequestMode = false;
let socialVideoOption = { available: false, discountPct: 5 };
let pendingCancel = null;
let preselectedTypeSlug = null;
let preselectedInstructorSlug = null;
let preselectedTypeId = null;
let prefilledName = null; // from ?name= URL param (shareable booking link)
let pendingReschedule = null; // { bookingId, date, start, end, instructorName, instructorId }
let locationCheckTimer = null;
let lastBookingId = null;
let recurringAnchorBookingId = null;
let recurringAnchorContext = null;
let recurringLessonCount = RECURRING_BLOCK_MIN_LESSONS;
let recurringPreview = null;
let recurringPreviewBusy = false;
let recurringCommitBusy = false;
let recurringConfirmMode = 'credit';
let learnerProfile = { phone: '', pickup_address: '' };
let testDateAvailability = null;
let selectedTestDateStart = null;
let hasFreeTrialSlot = false; // true if current school has a lesson_type with slug='trial'
// Slot-first state: full list of selectable lesson types (excludes 'trial')
// and the smallest active duration in minutes - used as the provisional feed duration.
let availableLessonTypes = [];
let slotFeedDuration = 60; // sensible default; updated from availableLessonTypes
let slotFeedLessonTypeId = null; // id of the lesson type whose duration we use for grid spacing

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
  const reservedMoveBookingId = params.get('reserved_move'); // ?reserved_move=BOOKING_ID
  const reservedBankReturn = params.get('reserved_bank_checkout') === '1' || params.get('reserved_bank_cancelled') === '1';
  const reservedBankCancelled = params.get('reserved_bank_cancelled') === '1';
  const reservedBankBlockId = params.get('block_id');
  if (params.get('paid') === '1') {
    const paidMsg = auth
      ? 'Payment successful - your lesson is booked! Check your email for details.'
      : 'Booking confirmed! Check your email for details and a link to manage your bookings.';
    document.body.classList.add('cc-paid-return');
    showToast(paidMsg, 'success');
    const paidPrompt = document.getElementById('reservedWeeklyPaidPrompt');
    if (paidPrompt) paidPrompt.style.display = 'block';
    window.history.replaceState({}, '', '/learner/book.html');
  }
  if (params.get('requested') === '1') {
    showToast('Request sent! The instructor has up to 48 hours to confirm — we\'ll text and email you either way. Your card has only been authorised, not charged.', 'success');
    window.history.replaceState({}, '', '/learner/book.html');
  }
  if (params.get('cancelled') === '1') {
    showToast('Payment cancelled - the slot has been released.', '');
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
  const testDateBtn = document.getElementById('btnBookTestDate');
  if (testDateBtn) testDateBtn.onclick = confirmTestDateBooking;
  const handleSocialVideoToggle = function () {
    if (selectedLessonType) {
      applyLessonTypeToModal(selectedLessonType, !auth, !auth && false);
      updateDeductDisplay();
      updateBookButtonState();
    }
  };
  const socialVideoCheckbox = document.getElementById('mdSocialVideoConsent');
  if (socialVideoCheckbox) socialVideoCheckbox.onchange = handleSocialVideoToggle;
  const socialInfoModal = document.getElementById('socialVideoInfoModal');
  const closeSocialInfo = () => socialInfoModal && socialInfoModal.classList.remove('open');
  const socialMore = document.getElementById('mdSocialVideoMore');
  if (socialMore) socialMore.onclick = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    if (socialInfoModal) socialInfoModal.classList.add('open');
  };
  const socialInfoClose = document.getElementById('socialVideoInfoClose');
  const socialInfoCloseX = document.getElementById('socialVideoInfoCloseX');
  if (socialInfoClose) socialInfoClose.onclick = closeSocialInfo;
  if (socialInfoCloseX) socialInfoCloseX.onclick = closeSocialInfo;
  const successRecurringBtn = document.getElementById('btnOpenRecurringFromSuccess');
  if (successRecurringBtn) successRecurringBtn.onclick = () => openRecurringBlockModal('success');
  const paidRecurringBtn = document.getElementById('btnOpenRecurringFromPaid');
  if (paidRecurringBtn) paidRecurringBtn.onclick = handlePaidRecurringPrompt;
  document.getElementById('recurringBlockClose').onclick = closeRecurringBlockModal;
  document.getElementById('recurringBlockCloseX').onclick = closeRecurringBlockModal;
  document.getElementById('recurringMinus').onclick = () => setRecurringLessonCount(recurringLessonCount - 1);
  document.getElementById('recurringPlus').onclick = () => setRecurringLessonCount(recurringLessonCount + 1);
  document.querySelectorAll('[data-recurring-lessons]').forEach(btn => {
    btn.addEventListener('click', () => setRecurringLessonCount(parseInt(btn.dataset.recurringLessons, 10)));
  });
  document.getElementById('btnConfirmRecurringBlock').onclick = confirmRecurringBlock;
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
  document.getElementById('recurringBlockModal').addEventListener('click', e => { if (e.target === document.getElementById('recurringBlockModal')) closeRecurringBlockModal(); });
  document.getElementById('cancelModal').addEventListener('click', e => { if (e.target === document.getElementById('cancelModal')) closeCancelModal(); });
  document.getElementById('rescheduleModal').addEventListener('click', e => { if (e.target === document.getElementById('rescheduleModal')) closeRescheduleModal(); });
  if (socialInfoModal) socialInfoModal.addEventListener('click', e => { if (e.target === socialInfoModal) closeSocialInfo(); });

  // Close modals on Escape key
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('recurringBlockModal').classList.contains('open')) closeRecurringBlockModal();
    else if (socialInfoModal && socialInfoModal.classList.contains('open')) closeSocialInfo();
    else if (document.getElementById('bookModal').classList.contains('open')) closeBookModal();
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
    if (reservedBankReturn) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/learner/login.html?redirect=' + redirect;
      return;
    }
    // Spectator-mode banner: show guest hint, suppress the "No hours on your account" banner
    // (it reads as broken for someone who has no account at all).
    const guestBanner = document.getElementById('guestBanner');
    if (guestBanner) guestBanner.style.display = 'flex';
    Promise.all([loadInstructors(), loadLessonTypes()])
      .then(async () => {
        preselectInstructor();
        // Re-load lesson types now that instructors are known, so
        // offered_lesson_types filtering and instructor-exact pricing apply
        if (preselectedInstructorSlug || preselectedInstructorId || instructors.length === 1) await loadLessonTypes();
        initFeed();
        window.posthog && posthog.capture('booking_page_viewed', { is_guest: true, has_type_preselect: !!preselectedTypeSlug });
      });
    return;
  }

  Promise.all([loadBalance(), loadInstructors(), loadUpcoming(), loadPendingRequests(), loadLearnerProfile(), loadLessonTypes()])
    .then(async () => {
      preselectInstructor();
      // Re-load lesson types now that instructors are known, so
      // offered_lesson_types filtering and instructor-exact pricing apply
      if (preselectedInstructorSlug || preselectedInstructorId || instructors.length === 1) await loadLessonTypes();
      await loadTestDateAvailability();
      initFeed();
      renderTestDatePanel();
      showPostcodePromptIfNeeded();

      if (reservedBankReturn) {
        await handleReservedBankReturn(reservedBankBlockId, { cancelled: reservedBankCancelled });
      }

      // Activate reschedule / reserved move mode if the URL points at an existing booking.
      const moveBookingId = reservedMoveBookingId || rescheduleBookingId;
      if (moveBookingId && auth) {
        try {
          const res = await ccAuth.fetchAuthed('/api/slots?action=my-bookings');
          const data = await res.json();
          if (res.ok) {
            const booking = (data.upcoming || []).find(b => String(b.id) === moveBookingId);
            if (booking) {
              // Pre-select the instructor filter to show only their slots
              const sel = document.getElementById('instructorFilter');
              if (sel.querySelector(`option[value="${booking.instructor_id}"]`)) {
                sel.value = String(booking.instructor_id);
                await loadLessonTypes();
                chooseLessonTypeForExistingBooking(booking);
                loadedRanges = []; slotCache = {}; selectedDate = null; clearSelectedSlot();
                await initFeed();
              } else {
                chooseLessonTypeForExistingBooking(booking);
                loadedRanges = []; slotCache = {}; selectedDate = null; clearSelectedSlot();
                await initFeed();
              }
              startRescheduleMode(
                booking.id,
                booking.scheduled_date,
                booking.start_time.slice(0, 5),
                booking.end_time.slice(0, 5),
                booking.instructor_name,
                booking.instructor_id,
                !!reservedMoveBookingId,
                booking.pickup_address || '',
                booking.dropoff_address || ''
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

async function loadSelectedInstructorBalance(slot) {
  selectedInstructorBalanceMinutes = 0;
  if (!auth || !slot || !slot.instructor_id) return;
  try {
    const res = await ccAuth.fetchAuthed(`/api/credits?action=balance&instructor_id=${encodeURIComponent(slot.instructor_id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load instructor balance');
    selectedInstructorBalanceMinutes = data.selected_instructor_balance_minutes || 0;
    if (data.payments_enabled !== undefined) paymentsEnabled = !!data.payments_enabled;
  } catch {
    selectedInstructorBalanceMinutes = 0;
  }
}

function formatBalanceHours(mins) {
  const hrs = mins / 60;
  return hrs % 1 === 0 ? `${hrs} hr${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hrs`;
}

function updateCreditBadge() {
  // Hide credits banner for guests (they have no account - guestBanner covers this case)
  // and when payments are disabled.
  document.getElementById('noCreditsBanner').style.display = (auth && paymentsEnabled && balanceMinutes === 0) ? 'flex' : 'none';
}

// ─── Lesson Types ───────────────────────────────────────────────────────────
async function loadLessonTypes() {
  try {
    let url = '/api/lesson-types?action=list';
    // Pass instructor_id so the API can filter to only that instructor's offered lesson types.
    // Also pass learner_id when available for per-learner custom pricing.
    // When the school only has one instructor, "All instructors" means that
    // instructor - scope the request to them so prices are checkout-exact.
    const instrId = document.getElementById('instructorFilter')?.value
      || (instructors.length === 1 ? String(instructors[0].id) : '');
    if (instrId) {
      url += '&instructor_id=' + instrId;
      if (auth && auth.user && auth.user.id) url += '&learner_id=' + auth.user.id;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    lessonTypePricesExact = !!instrId;
    lessonTypes = data.lesson_types || [];
    hasFreeTrialSlot = lessonTypes.some(lt => lt && lt.slug === 'trial');
    availableLessonTypes = lessonTypes.filter(lt => lt && lt.slug !== 'trial');
    choosePageLessonType();
    renderLessonLengthControls();
  } catch (err) {
    console.error('Failed to load lesson types:', err);
    lessonTypePricesExact = false;
    lessonTypes = [{ id: null, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: DEFAULT_PRICE_PENCE, colour: '#3b82f6' }];
    availableLessonTypes = lessonTypes.slice();
    choosePageLessonType();
    renderLessonLengthControls();
  }
}

function normaliseLessonType(lt) {
  if (!lt) return null;
  return { ...lt, id: lt.id || lt.lesson_type_id };
}

function choosePageLessonType() {
  if (!availableLessonTypes.length) {
    selectedLessonType = null;
    slotFeedLessonTypeId = null;
    return;
  }

  let chosen = null;
  if (selectedLessonType && selectedLessonType.id) {
    chosen = availableLessonTypes.find(lt => String(lt.id || lt.lesson_type_id) === String(selectedLessonType.id));
  }
  if (!chosen && preselectedTypeSlug) {
    chosen = availableLessonTypes.find(lt => lt.slug === preselectedTypeSlug);
  }
  if (!chosen && preselectedTypeId) {
    chosen = availableLessonTypes.find(lt => String(lt.id || lt.lesson_type_id) === String(preselectedTypeId));
  }
  if (!chosen) {
    try {
      const lastId = localStorage.getItem('cc_last_lesson_type_id');
      if (lastId) chosen = availableLessonTypes.find(lt => String(lt.id || lt.lesson_type_id) === String(lastId));
    } catch (_) {}
  }
  if (!chosen) {
    chosen = availableLessonTypes.reduce((a, b) => (a.duration_minutes <= b.duration_minutes ? a : b));
  }

  selectedLessonType = normaliseLessonType(chosen);
  slotFeedDuration = selectedLessonType.duration_minutes;
  slotFeedLessonTypeId = selectedLessonType.id;
}

function chooseLessonTypeForExistingBooking(booking) {
  if (!booking || !availableLessonTypes.length) return false;
  const bookingTypeId = booking.lesson_type_id == null ? '' : String(booking.lesson_type_id);
  const bookingDuration = parseInt(booking.duration_minutes, 10) || 0;
  let chosen = null;

  if (bookingTypeId) {
    chosen = availableLessonTypes.find(lt => String(lt.id || lt.lesson_type_id) === bookingTypeId);
  }
  if (!chosen && bookingDuration > 0) {
    chosen = availableLessonTypes.find(lt => parseInt(lt.duration_minutes, 10) === bookingDuration);
  }
  if (!chosen) return false;

  selectedLessonType = normaliseLessonType(chosen);
  slotFeedDuration = selectedLessonType.duration_minutes;
  slotFeedLessonTypeId = selectedLessonType.id;
  return true;
}

function lessonLengthLabel(lt) {
  if (!lt) return 'Lesson';
  const mins = Number(lt.duration_minutes || 0);
  if (mins > 0 && mins % 60 === 0) return `${mins / 60} hr`;
  if (mins > 60 && mins % 60 === 30) return `${Math.floor(mins / 60)}½ hr`;
  return `${mins} min`;
}

function renderLessonLengthControls() {
  const container = document.getElementById('lessonLengthControls');
  if (!container) return;
  if (!availableLessonTypes.length) {
    container.innerHTML = '<button class="lesson-length-option" type="button" disabled>No lesson lengths available</button>';
    return;
  }
  container.innerHTML = availableLessonTypes
    .slice()
    .sort((a, b) => a.duration_minutes - b.duration_minutes)
    .map(lt => {
      const id = lt.id || lt.lesson_type_id;
      const selected = selectedLessonType && String(selectedLessonType.id) === String(id);
      const locked = !!pendingReschedule && !selected;
      // Only show a price when it's the exact effective price checkout will
      // charge (instructor-scoped, per-learner rate applied when signed in).
      const price = lessonTypePricesExact && lt.price_pence > 0 ? ` · ${formatMoneyShort(lt.price_pence)}` : '';
      const label = `${lessonLengthLabel(lt)}${price}`;
      const fullLabel = `${lt.name || label}, ${formatHours(lt.duration_minutes)}${price ? `, ${formatMoneyShort(lt.price_pence)}` : ''}`;
      return `<button class="lesson-length-option" type="button"
        data-action="select-lesson-type"
        data-lesson-type-id="${esc(id)}"
        aria-pressed="${selected ? 'true' : 'false'}"
        ${locked ? 'disabled' : ''}
        aria-label="${esc(fullLabel)}">${esc(label)}</button>`;
    })
    .join('');
}

function selectLessonType(lessonTypeId) {
  if (pendingReschedule) {
    showToast('Rescheduled lessons keep their original duration.', '');
    return;
  }
  const next = availableLessonTypes.find(lt => String(lt.id || lt.lesson_type_id) === String(lessonTypeId));
  if (!next) return;
  selectedLessonType = normaliseLessonType(next);
  slotFeedDuration = selectedLessonType.duration_minutes;
  slotFeedLessonTypeId = selectedLessonType.id;
  // Keep selectedDate - ensureSelectedDate() falls back to the first
  // available date if the kept one has no slots at the new length.
  clearSelectedSlot();
  loadedRanges = [];
  slotCache = {};
  setLastLessonType(selectedLessonType);
  renderLessonLengthControls();
  initFeed();
  window.posthog && posthog.capture('booking_lesson_length_selected', {
    lesson_type_slug: selectedLessonType.slug,
    duration_minutes: selectedLessonType.duration_minutes
  });
}

// ─── Instructors ─────────────────────────────────────────────────────────────
async function loadInstructors() {
  try {
    const res = await ccAuth.fetchAuthed('/api/instructors?action=list');
    const data = await res.json();
    instructors = data.instructors || [];
    const sel = document.getElementById('instructorFilter');
    instructors.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.id; opt.textContent = String(i.name || '').trim().split(/\s+/)[0] || i.name;
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
    const filmingText = next.social_video_consent === true ? ' - filmed lesson' : '';
    document.getElementById('nextLessonDetail').textContent =
      `${dateStr} at ${next.start_time.slice(0,5)} with ${next.instructor_name}${filmingText}`;
    card.style.display = 'flex';
  } catch {}
}

// ─── Pending lesson requests card (request-to-book instructors) ──────────────
async function loadPendingRequests() {
  const card = document.getElementById('pendingRequestsCard');
  if (!card || !auth) return;
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=my-requests');
    if (!res.ok) { card.style.display = 'none'; return; }
    const data = await res.json();
    const pending = (data.requests || []).filter(r => r.status === 'pending');
    if (pending.length === 0) { card.style.display = 'none'; return; }

    card.innerHTML = pending.map(r => {
      const dateStr = new Date(String(r.scheduled_date).slice(0, 10) + 'T00:00:00Z')
        .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
      const timeStr = String(r.start_time || '').slice(0, 5);
      const holdStr = r.payment_method === 'card_hold' ? 'card authorised — charged only if accepted' : 'credit held — returned if declined';
      return `<div class="next-lesson-card" style="border-style:dashed">
        <div>
          <span class="next-lesson-label">Requested — awaiting ${esc(firstName(r.instructor_name || 'instructor'))}</span>
          <span class="next-lesson-detail">${esc(dateStr)} at ${esc(timeStr)} · ${esc(holdStr)}</span>
        </div>
        <button type="button" class="next-lesson-link" data-action="withdraw-request" data-request-id="${r.id}"
          style="background:none;border:none;cursor:pointer;font:inherit;color:inherit">Withdraw</button>
      </div>`;
    }).join('');
    card.style.display = 'block';
  } catch { card.style.display = 'none'; }
}

async function withdrawRequestFromCard(requestId, btn) {
  if (!confirm('Withdraw this request? Your held payment will be released straight away.')) return;
  btn.disabled = true;
  btn.textContent = 'Withdrawing…';
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=withdraw-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: parseInt(requestId, 10) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Withdraw failed');
    showToast('Request withdrawn — your held payment has been released.', 'success');
    loadBalance();
  } catch (err) {
    showToast(err.message || 'Withdraw failed. Please try again.', 'error');
  }
  loadPendingRequests();
  initFeed();
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

function selectedTestDateInstructorId() {
  const selected = document.getElementById('instructorFilter')?.value || '';
  if (selected) return selected;
  return instructors.length === 1 ? String(instructors[0].id) : '';
}

function hasSavedTestDetails() {
  return !!(learnerProfile.test_date && learnerProfile.test_time);
}

async function loadTestDateAvailability() {
  testDateAvailability = null;
  selectedTestDateStart = null;
  if (!auth || !hasSavedTestDetails()) {
    renderTestDatePanel();
    return;
  }
  const instructorId = selectedTestDateInstructorId();
  if (!instructorId) {
    renderTestDatePanel();
    return;
  }
  try {
    const url = '/api/slots?action=test-date-availability&instructor_id=' + encodeURIComponent(instructorId);
    const res = await ccAuth.fetchAuthed(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load test date options');
    testDateAvailability = data;
    const recommended = (data.options || []).find(o => o.recommended && o.fits)
      || (data.options || []).find(o => o.fits)
      || null;
    selectedTestDateStart = recommended ? recommended.start_time : null;
  } catch (err) {
    testDateAvailability = { error: err.message || 'Could not load test date options' };
  }
  renderTestDatePanel();
}

function renderTestDatePanel() {
  const panel = document.getElementById('testDatePanel');
  if (!panel) return;
  if (!auth) {
    panel.classList.remove('is-visible');
    return;
  }
  panel.classList.add('is-visible');
  const meta = document.getElementById('testDateMeta');
  const status = document.getElementById('testDateStatus');
  const controls = document.getElementById('testDateControls');
  const optionsEl = document.getElementById('testDateStartOptions');
  const btn = document.getElementById('btnBookTestDate');

  if (!hasSavedTestDetails()) {
    meta.innerHTML = '';
    controls.style.display = 'none';
    status.innerHTML = 'Add your practical test date and time in <a href="/learner/profile.html" style="color:var(--accent)">Profile</a> to unlock this booking option.';
    return;
  }

  const dateText = new Date(learnerProfile.test_date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  meta.innerHTML = [
    '<span>Date ' + esc(dateText) + '</span>',
    '<span>Test ' + esc(String(learnerProfile.test_time || '').slice(0, 5)) + '</span>',
    '<span>Centre ' + esc(learnerProfile.test_centre || 'Not set') + '</span>'
  ].join('');

  if (learnerProfile.test_instructor_booked) {
    controls.style.display = 'none';
    status.textContent = 'Your profile says your test instructor is already booked.';
    return;
  }

  const instructorId = selectedTestDateInstructorId();
  if (!instructorId) {
    controls.style.display = 'none';
    status.textContent = 'Choose an instructor above to check test date lesson times.';
    return;
  }

  if (!testDateAvailability) {
    controls.style.display = 'none';
    status.textContent = 'Checking test date lesson times...';
    return;
  }
  if (testDateAvailability.error) {
    controls.style.display = 'none';
    status.textContent = testDateAvailability.error;
    return;
  }

  controls.style.display = 'grid';
  const options = testDateAvailability.options || [];
  optionsEl.innerHTML = options.map(o => {
    const selected = o.start_time === selectedTestDateStart;
    const label = o.start_time + '-' + o.end_time + (o.recommended ? ' recommended' : '');
    const unavailable = !o.fits;
    return '<button class="test-date-option" type="button" data-action="select-test-date-start" data-start="' + esc(o.start_time) + '" ' +
      'aria-pressed="' + (selected ? 'true' : 'false') + '" ' +
      (unavailable ? 'disabled' : '') + '>' + esc(label) + '</button>';
  }).join('');
  const canUseCredit = !!testDateAvailability.can_use_credit;
  const price = formatMoney(testDateAvailability.price_pence || 0);
  btn.disabled = !selectedTestDateStart;
  btn.textContent = canUseCredit ? 'Book with credit' : 'Pay ' + price + ' & book';
  status.textContent = options.some(o => o.fits)
    ? 'Choose a start close to 45 minutes before your practical test.'
    : 'No matching test date lesson time is currently available with this instructor.';
}

async function confirmTestDateBooking() {
  if (!testDateAvailability || !selectedTestDateStart) return;
  if (!(await saveProfileFieldsFromModal())) return;
  const pickup = (learnerProfile.pickup_address || '').trim();
  if (!pickup) {
    showToast('Save your pickup address before booking your test date lesson.', 'error');
    showPostcodePromptIfNeeded();
    return;
  }
  const btn = document.getElementById('btnBookTestDate');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = testDateAvailability.can_use_credit ? 'Booking...' : 'Redirecting...';
  try {
    const body = {
      instructor_id: testDateAvailability.instructor_id,
      start_time: selectedTestDateStart,
      pickup_address: pickup
    };
    const action = testDateAvailability.can_use_credit ? 'book-test-date' : 'checkout-test-date';
    const res = await ccAuth.fetchAuthed('/api/slots?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Could not book test date lesson');
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    learnerProfile.test_instructor_booked = true;
    selectedInstructorBalanceMinutes = data.balance_minutes || 0;
    showToast('Test date lesson booked.', 'success');
    renderTestDatePanel();
    loadUpcoming();
  } catch (err) {
    showToast(err.message || 'Could not book test date lesson.', 'error');
    btn.disabled = false;
    btn.textContent = oldText;
  }
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
    showToast('Pickup postcode saved - filtering slots by travel time', 'success');

    // Re-fetch slots with travel filter now active
    loadedRanges = [];
    slotCache = {};
    selectedDate = null;
    clearSelectedSlot();
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
function extractPostcodeForQuery(address) {
  const match = String(address || '').match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return match ? match[1].toUpperCase().replace(/\s+/g, '+') : null;
}

function resolveBookingPickupAddress(isGuest) {
  if (isGuest) return (document.getElementById('mdGuestPickup')?.value || '').trim();
  const profileInput = document.getElementById('mdProfilePickup');
  return (learnerProfile.pickup_address || profileInput?.value || '').trim();
}

function resolveBookingDropoffAddress(isGuest) {
  const mode = document.getElementById('mdDropoffMode')?.value || 'same';
  if (mode === 'same') return null;
  if (mode === 'home' && !isGuest) return (learnerProfile.pickup_address || '').trim() || null;
  return null;
}

function getActivePickupPostcode(isGuest) {
  return extractPostcodeForQuery(resolveBookingPickupAddress(isGuest));
}

function syncBookingLocationControls(isGuest) {
  const pickupRow = document.getElementById('bookingPickupRow');
  const pickupPreview = document.getElementById('mdHomePickupPreview');
  const dropoffMode = document.getElementById('mdDropoffMode');
  const dropoffHomeOption = dropoffMode?.querySelector('option[value="home"]');

  if (pickupRow) pickupRow.style.display = isGuest ? 'none' : '';
  if (pickupPreview) pickupPreview.textContent = !isGuest && learnerProfile.pickup_address ? learnerProfile.pickup_address : '';
  if (dropoffHomeOption) dropoffHomeOption.hidden = isGuest || !learnerProfile.pickup_address;
  if (dropoffMode && dropoffHomeOption?.hidden && dropoffMode.value === 'home') dropoffMode.value = 'same';
}

function scheduleLocationDurationCheck(isGuest) {
  if (!pendingSlot || pendingReschedule) return;
  clearTimeout(locationCheckTimer);
  const hint = document.getElementById('mdLocationCheckHint');
  if (hint) hint.style.display = 'block';
  locationCheckTimer = setTimeout(() => {
    loadDurationsForSlot(pendingSlot, isGuest, !isGuest && !isProfileComplete());
  }, 450);
}

function validateBookingLocations(isGuest) {
  const pickup = resolveBookingPickupAddress(isGuest);
  if (!pickup) {
    showToast('Please enter a pickup address.', 'error');
    return null;
  }
  const dropoff = resolveBookingDropoffAddress(isGuest);
  return { pickup_address: pickup, dropoff_address: dropoff };
}

function syncRescheduleLocationControls() {
  if (!pendingReschedule) return;
  const pickupMode = document.getElementById('rmPickupMode');
  const pickupPreview = document.getElementById('rmPickupPreview');
  const dropoffMode = document.getElementById('rmDropoffMode');
  const homePickup = learnerProfile.pickup_address || '';

  const noPickupOption = pickupMode?.querySelector('option[value=""]');
  const currentPickupOption = pickupMode?.querySelector('option[value="current"]');
  const homePickupOption = pickupMode?.querySelector('option[value="home"]');
  const currentDropoffOption = dropoffMode?.querySelector('option[value="current"]');
  const homeDropoffOption = dropoffMode?.querySelector('option[value="home"]');
  if (noPickupOption) noPickupOption.hidden = !!(pendingReschedule.pickupAddress || homePickup);
  if (currentPickupOption) currentPickupOption.hidden = !pendingReschedule.pickupAddress;
  if (homePickupOption) homePickupOption.hidden = !homePickup;
  if (currentDropoffOption) currentDropoffOption.hidden = !pendingReschedule.dropoffAddress;
  if (homeDropoffOption) homeDropoffOption.hidden = !homePickup;
  if (pickupMode && pickupMode.selectedOptions[0]?.hidden) {
    pickupMode.value = pendingReschedule.pickupAddress ? 'current' : (homePickup ? 'home' : '');
  }
  if (dropoffMode && dropoffMode.selectedOptions[0]?.hidden) dropoffMode.value = 'same';
  if (pickupPreview) {
    const value = pickupMode?.value === 'home' ? homePickup
      : pickupMode?.value === 'current' ? (pendingReschedule.pickupAddress || '')
      : '';
    pickupPreview.textContent = value;
  }
}

function resolveReschedulePickupAddress() {
  const mode = document.getElementById('rmPickupMode')?.value || 'current';
  if (mode === 'home') return (learnerProfile.pickup_address || '').trim();
  if (mode === 'current') return (pendingReschedule?.pickupAddress || learnerProfile.pickup_address || '').trim();
  return '';
}

function resolveRescheduleDropoffAddress() {
  const mode = document.getElementById('rmDropoffMode')?.value || 'same';
  if (mode === 'same') return null;
  if (mode === 'home') return (learnerProfile.pickup_address || '').trim() || null;
  if (mode === 'current') return (pendingReschedule?.dropoffAddress || '').trim() || null;
  return null;
}

async function onFilterChange() {
  loadedRanges = []; slotCache = {};
  // Keep selectedDate so comparing instructors/lengths doesn't bounce the
  // learner back to the first available date; ensureSelectedDate() falls
  // back only when the kept date has no slots under the new filter.
  clearSelectedSlot();
  await loadLessonTypes();
  if (auth) await loadTestDateAvailability();
  initFeed();
}

async function initFeed() {
  choosePageLessonType();
  renderLessonLengthControls();
  feedFrom = new Date(); feedFrom.setHours(0,0,0,0);
  feedTo = clampToApiWindow(addDaysLocal(feedFrom, feedMaxDays()));
  slotCache = {};
  loadedRanges = [];
  dateGridExpanded = false;
  showLoading();

  const instructorId = document.getElementById('instructorFilter').value;

  // When a specific instructor is chosen, fetch their full learner window
  // in one go so learners don't need to reveal later dates manually,
  // and so the empty state ("No slots with X") reflects the whole window
  // rather than just the first chunk.
  if (instructorId) {
    const fullTo = clampToApiWindow(addDaysLocal(feedFrom, feedMaxDays()));
    const ok = await fetchFeedSlots(feedFrom, fullTo);
    if (ok === false) return;
    feedTo = fullTo;
    renderFeed();
    return;
  }

  // No specific instructor - still fetch the complete learner window immediately.
  const ok = await fetchFeedSlots(feedFrom, feedTo);
  if (ok === false) return;
  renderFeed();
}

async function fetchFeedSlots(fromDate, toDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  let from = fmtDate(fromDate < today ? today : fromDate);
  let to = fmtDate(toDate);
  const maxDate = fmtDate(apiWindowMaxDateLocal());
  if (from > maxDate) return true;
  if (to > maxDate) to = maxDate;

  const instructorId = document.getElementById('instructorFilter').value;
  // The page-level lesson length sets the rendered slot length. The later
  // durations-for-slot call remains the server validation before booking.
  const ltId = slotFeedLessonTypeId || (selectedLessonType && selectedLessonType.id) || '';
  const cacheKey = `${from}|${to}|${instructorId}|${ltId}|mdo`;
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

function getDateRangeStrings(fromDate, toDate) {
  const dates = [];
  if (!fromDate || !toDate) return dates;
  let cursor = new Date(fromDate);
  cursor.setHours(0,0,0,0);
  const end = new Date(toDate);
  end.setHours(0,0,0,0);
  while (cursor <= end) {
    dates.push(fmtDate(cursor));
    cursor = addDaysLocal(cursor, 1);
  }
  return dates;
}

function getVisibleSlotsFromCache(cache) {
  const allSlots = [];
  const fromStr = fmtDate(feedFrom);
  const toStr = fmtDate(feedTo);
  for (const ds in (cache || {})) {
    if (ds < fromStr || ds > toStr) continue;
    for (const s of cache[ds]) allSlots.push(s);
  }
  allSlots.sort(sortSlots);
  return allSlots;
}

function getAvailableDateStrings(cache) {
  return getDateRangeStrings(feedFrom, feedTo)
    .filter(ds => cache && cache[ds] && cache[ds].length > 0);
}

function sortSlots(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
  return String(a.instructor_name || '').localeCompare(String(b.instructor_name || ''));
}

function ensureSelectedDate(cache) {
  const availableDates = getAvailableDateStrings(cache);
  if (selectedDate && availableDates.includes(selectedDate)) return selectedDate;
  selectedDate = availableDates[0] || null;
  return selectedDate;
}

function dateDisplayParts(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const isToday = dateStr === fmtDate(today);
  const isTomorrow = dateStr === fmtDate(addDaysLocal(today, 1));
  return {
    day: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : DAY_SHORT[d.getDay()],
    date: `${d.getDate()} ${MON_SHORT[d.getMonth()]}`,
    full: d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
  };
}

function learnerTestDateString() {
  return learnerProfile && learnerProfile.test_date ? String(learnerProfile.test_date).slice(0, 10) : '';
}

function isLearnerTestDate(dateStr) {
  return !!dateStr && learnerTestDateString() === dateStr;
}

function testDateMarkerHTML() {
  return '<span class="date-cell-test-badge" aria-hidden="true">TEST</span>';
}

/* Week-by-week date grid (Mon–Sun) covering the whole booking window.
   Days without availability stay visible but disabled so learners can map
   slots onto their weekly routine and see fully-booked days at a glance. */
function renderDateGrid(cache) {
  const dates = getDateRangeStrings(feedFrom, feedTo);
  if (!dates.length) return '';
  const todayStr = fmtDate(new Date());
  const cells = [];
  const cellDates = []; // parallel to cells

  for (const ds of dates) {
    const d = new Date(ds + 'T00:00:00');
    const count = (cache && cache[ds] && cache[ds].length) || 0;
    const dayNum = d.getDate();
    const todayClass = ds === todayStr ? ' date-cell-today' : '';
    const testDateClass = isLearnerTestDate(ds) ? ' date-cell-test' : '';
    const testDateBadge = isLearnerTestDate(ds) ? testDateMarkerHTML() : '';

    if (!count) {
      const testDateLabel = isLearnerTestDate(ds) ? ' aria-label="Your driving test date"' : '';
      cells.push(`<span class="date-cell date-cell-off${todayClass}${testDateClass}"${testDateLabel}><span class="date-cell-num">${dayNum}</span>${testDateBadge}</span>`);
      cellDates.push(ds);
      continue;
    }
    const selected = ds === selectedDate;
    const parts = dateDisplayParts(ds);
    const label = `${parts.full}, ${count} slot${count === 1 ? '' : 's'} available${isLearnerTestDate(ds) ? ', your driving test date' : ''}`;
    cells.push(`<button class="date-cell date-cell-open${todayClass}${testDateClass}" type="button"
      data-action="select-date"
      data-date="${esc(ds)}"
      aria-pressed="${selected ? 'true' : 'false'}"
      ${selected ? 'aria-current="date"' : ''}
      aria-label="${esc(label)}">
      <span class="date-cell-num">${dayNum}</span><span class="date-cell-dot" aria-hidden="true"></span>${testDateBadge}
    </button>`);
    cellDates.push(ds);
  }

  // Long windows (up to 12 weeks) would render a wall of rows that pushes
  // the time slots below the fold — collapse to 6 weeks until expanded.
  const COLLAPSED_DATES = 6 * 7;
  if (!dateGridExpanded && selectedDate && dates.indexOf(selectedDate) >= COLLAPSED_DATES) {
    dateGridExpanded = true;
  }
  let visibleCells = cells;
  let visibleDates = cellDates;
  let expandBtn = '';
  if (!dateGridExpanded && cells.length > COLLAPSED_DATES) {
    visibleCells = cells.slice(0, COLLAPSED_DATES);
    visibleDates = cellDates.slice(0, COLLAPSED_DATES);
    expandBtn = `<button class="date-grid-more" type="button" data-action="expand-date-grid">Show later dates</button>`;
  }

  const todayYear = new Date().getFullYear();
  const body = [];
  let currentMonthKey = null;
  let monthCellCount = 0;
  const blankCell = '<span class="date-cell date-cell-blank" aria-hidden="true"></span>';
  const padMonthRow = () => {
    while (monthCellCount % 7 !== 0) {
      body.push(blankCell);
      monthCellCount++;
    }
  };
  for (let i = 0; i < visibleCells.length; i++) {
    const ds = visibleDates[i];
    const monthKey = ds.slice(0, 7); // YYYY-MM
    if (monthKey !== currentMonthKey) {
      if (currentMonthKey) padMonthRow();
      const d = new Date(ds + 'T00:00:00');
      const yearSuffix = d.getFullYear() !== todayYear ? ` ${d.getFullYear()}` : '';
      body.push(`<span class="date-grid-month">${esc(d.toLocaleDateString('en-GB', { month: 'long' }))}${yearSuffix}</span>`);
      currentMonthKey = monthKey;
      monthCellCount = 0;
      const leadBlanks = (d.getDay() + 6) % 7; // Monday-first column index
      for (let j = 0; j < leadBlanks; j++) {
        body.push(blankCell);
        monthCellCount++;
      }
    }
    body.push(visibleCells[i]);
    monthCellCount++;
  }
  if (currentMonthKey) padMonthRow();

  const header = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map(dl => `<span class="date-grid-head">${dl}</span>`).join('');
  return `<div class="date-grid" role="group" aria-label="Choose a date">${header}${body.join('')}</div>${expandBtn}`;
}

function slotStartMinutes(slot) {
  const [h, m] = String(slot.start_time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTimeDisplay(time) {
  return String(time || '').slice(0, 5);
}

function slotKeyFromParts(date, start, instructorId, transmissionType) {
  return `${date || ''}|${start || ''}|${instructorId || ''}|${normaliseTransmissionType(transmissionType) || ''}`;
}

function slotKeyFromDataset(dataset) {
  return slotKeyFromParts(dataset.date, dataset.start, dataset.instructorId, dataset.transmissionType);
}

function slotKeyFromSlot(slot) {
  return slotKeyFromParts(slot.date, slot.start_time, slot.instructor_id, slot.transmission_type);
}

function renderTimeGroups(slotsForDate, opts) {
  opts = opts || {};
  if (!selectedDate) return '';
  const selectedParts = dateDisplayParts(selectedDate);
  if (!slotsForDate.length) {
    return `<div class="calendar-empty">
      <h3>No times on ${esc(selectedParts.day.toLowerCase() === 'today' || selectedParts.day.toLowerCase() === 'tomorrow' ? selectedParts.day : selectedParts.date)}</h3>
      <p>Choose another date above or check back later.</p>
    </div>`;
  }

  const groups = [
    { key: 'morning', label: 'Morning', slots: [] },
    { key: 'afternoon', label: 'Afternoon', slots: [] },
    { key: 'evening', label: 'Evening', slots: [] }
  ];
  for (const slot of slotsForDate.slice().sort(sortSlots)) {
    const mins = slotStartMinutes(slot);
    if (mins < 12 * 60) groups[0].slots.push(slot);
    else if (mins < 17 * 60) groups[1].slots.push(slot);
    else groups[2].slots.push(slot);
  }

  const showInstructor = opts.showInstructor;
  const selectedLength = selectedLessonType ? `${formatHours(selectedLessonType.duration_minutes)} lesson` : 'lesson';
  const html = groups
    .filter(group => group.slots.length > 0)
    .map(group => {
      const buttons = group.slots.map(s => {
        const transmission = normaliseTransmissionType(s.transmission_type) || 'both';
        const instructorName = s.instructor_name || 'Instructor';
        const avatar = s.instructor_avatar
          ? `<span class="slot-avatar"><img src="${esc(s.instructor_avatar)}" alt=""></span>`
          : `<span class="slot-avatar">${esc((instructorName || '?')[0])}</span>`;
        const onRequest = !!s.request_to_book;
        const requestTag = onRequest ? ' · <span class="slot-on-request">On request</span>' : '';
        const meta = (showInstructor
          ? `${avatar}${esc(firstName(instructorName))} · ${esc(transmissionLabel(transmission))}`
          : esc(transmissionLabel(transmission))) + requestTag;
        const accessible = `${onRequest ? 'Request' : 'Select'} ${formatTimeDisplay(s.start_time)} with ${instructorName}, ${transmissionLabel(transmission)}, ${selectedLength}${onRequest ? ', instructor confirms each booking' : ''}`;
        const isSelected = !!selectedSlot && slotKeyFromSlot(s) === slotKeyFromDataset(selectedSlot);
        return `<button class="time-slot-button" type="button"
          data-action="select-slot"
          data-instructor-id="${esc(s.instructor_id)}"
          data-date="${esc(s.date)}"
          data-start="${esc(s.start_time)}"
          data-end="${esc(s.end_time)}"
          data-transmission-type="${esc(transmission)}"
          data-instructor-name="${esc(instructorName)}"
          data-request-to-book="${onRequest ? '1' : ''}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
          aria-label="${esc(accessible)}">
          <span class="time-slot-main">${esc(formatTimeDisplay(s.start_time))}</span>
          <span class="time-slot-meta">${meta}</span>
        </button>`;
      }).join('');
      return `<section class="time-group" aria-labelledby="timeGroup${group.key}">
        <h3 class="time-group-title" id="timeGroup${group.key}">${group.label}</h3>
        <div class="time-button-grid">${buttons}</div>
      </section>`;
    })
    .join('');
  return `<div class="time-groups">${html}</div>`;
}

function renderBookingCalendar(cache, opts) {
  opts = opts || {};
  ensureSelectedDate(cache);
  const slotsForDate = ((cache && cache[selectedDate]) || []).slice().sort(sortSlots);
  const dateGrid = renderDateGrid(cache);
  const selectedParts = dateDisplayParts(selectedDate);
  const slotCount = slotsForDate.length;
  const testDateNote = isLearnerTestDate(selectedDate) ? '<span class="selected-date-test-note">Test date</span>' : '';
  const selectedDateHeading = `<div class="selected-date-heading" data-selected-date-heading>
    <strong>${esc(selectedParts.full)}${testDateNote}</strong>
    <span>${slotCount} time${slotCount === 1 ? '' : 's'} available</span>
  </div>`;
  const timeGroups = renderTimeGroups(slotsForDate, opts);
  const live = document.getElementById('bookingLiveRegion');
  if (live && selectedDate) {
    live.textContent = `Showing ${slotCount} time${slotCount === 1 ? '' : 's'} for ${selectedParts.full}`;
  }
  return `<div class="booking-calendar">${dateGrid}${selectedDateHeading}${timeGroups}</div>`;
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  clearSelectedSlot();
  renderFeed();
}

function slotDatasetFromButton(buttonEl) {
  return {
    instructorId: buttonEl.dataset.instructorId || '',
    date: buttonEl.dataset.date || '',
    start: buttonEl.dataset.start || '',
    end: buttonEl.dataset.end || '',
    transmissionType: normaliseTransmissionType(buttonEl.dataset.transmissionType) || 'both',
    instructorName: buttonEl.dataset.instructorName || 'Instructor',
    requestToBook: buttonEl.dataset.requestToBook === '1'
  };
}

function setPressedSlotState() {
  document.querySelectorAll('[data-action="select-slot"]').forEach(button => {
    const isSelected = !!selectedSlot && slotKeyFromDataset(button.dataset) === slotKeyFromDataset(selectedSlot);
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

function selectedSlotDateLabel() {
  if (!selectedSlot || !selectedSlot.date) return '';
  const parts = dateDisplayParts(selectedSlot.date);
  return parts.day === 'Today' || parts.day === 'Tomorrow' ? parts.day : parts.full.replace(/\s+\d{4}$/, '');
}

function renderSelectedSlotSummary() {
  const summary = document.getElementById('selectedSlotSummary');
  const page = document.querySelector('.page');
  if (!summary || !page) return;

  if (!selectedSlot) {
    summary.classList.remove('is-visible');
    page.classList.remove('has-selected-slot');
    return;
  }

  const title = document.getElementById('selectedSlotTitle');
  const meta = document.getElementById('selectedSlotMeta');
  const cta = document.getElementById('selectedSlotContinue');
  const dateLabel = selectedSlotDateLabel();
  const lengthLabel = selectedLessonType ? formatHours(selectedLessonType.duration_minutes) : 'Selected length';
  const transmission = transmissionLabel(selectedSlot.transmissionType);
  title.textContent = `${dateLabel} at ${formatTimeDisplay(selectedSlot.start)}`;
  meta.textContent = selectedSlot.requestToBook
    ? `${selectedSlot.instructorName} · ${lengthLabel} · ${transmission} · Instructor confirms — payment held, not taken`
    : `${selectedSlot.instructorName} · ${lengthLabel} · ${transmission} · Credit or payment checked next`;
  cta.textContent = pendingReschedule ? 'Move lesson' : (selectedSlot.requestToBook ? 'Request this slot' : 'Book this slot');
  summary.classList.add('is-visible');
  page.classList.add('has-selected-slot');
}

function clearSelectedSlot() {
  selectedSlot = null;
  setPressedSlotState();
  renderSelectedSlotSummary();
}

function selectSlotFromButton(buttonEl) {
  selectedSlot = slotDatasetFromButton(buttonEl);
  selectedDate = selectedSlot.date || selectedDate;
  setPressedSlotState();
  renderSelectedSlotSummary();
  const live = document.getElementById('bookingLiveRegion');
  if (live) {
    live.textContent = `Selected ${formatTimeDisplay(selectedSlot.start)} with ${selectedSlot.instructorName}. Continue to review.`;
  }
}

function continueSelectedSlot() {
  if (!selectedSlot) return;
  openBookModal({ dataset: selectedSlot });
}

// Legacy helper retained for older fallback surfaces; cards are real buttons.
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
    const transmission = normaliseTransmissionType(s.transmission_type) || 'both';
    const avatar = s.instructor_avatar
      ? `<span class="slot-avatar"><img src="${esc(s.instructor_avatar)}" alt=""></span>`
      : `<span class="slot-avatar">${esc((s.instructor_name || '?')[0])}</span>`;
    const accessible = `Select ${timeStr} with ${s.instructor_name || 'Instructor'}, ${transmissionLabel(transmission)}`;
    const isSelected = !!selectedSlot && slotKeyFromSlot(s) === slotKeyFromDataset(selectedSlot);
    html += `<button class="feed-card" type="button" data-action="select-slot"
      data-instructor-id="${s.instructor_id}"
      data-date="${s.date}"
      data-start="${s.start_time}"
      data-end="${s.end_time}"
      data-transmission-type="${transmission}"
      data-instructor-name="${esc(s.instructor_name || '')}"
      aria-pressed="${isSelected ? 'true' : 'false'}"
      aria-label="${esc(accessible)}">
      <div class="feed-card-accent" style="background:${colour}"></div>
      <div class="feed-card-body">
        <div class="feed-card-time">${timeStr}</div>
        <div class="feed-card-instructor">${avatar} ${esc(firstName(s.instructor_name) || 'Instructor')}</div>
        <div class="feed-card-meta">${transmissionLabel(transmission)}</div>
      </div>
      <svg class="feed-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
    </button>`;
  }
  html += '</div>';
  return html;
}

function renderFeed() {
  const allSlots = getVisibleSlotsFromCache(slotCache);

  if (allSlots.length === 0) {
    const chosenId = document.getElementById('instructorFilter').value;
    const chosen = instructors.find(i => String(i.id) === String(chosenId));
    if (chosen) {
      document.getElementById('calContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h3>No slots with ${esc(firstName(chosen.name))} in the next ${feedWindowWeeksLabel()}.</h3>
          <p>Try a different lesson type, choose another instructor, or check back later.</p>
        </div>`;
    } else {
      document.getElementById('calContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h3>No slots available</h3>
          <p>No slots found in the next ${feedWindowWeeksLabel()}. Try a different lesson type or check back later.</p>
        </div>`;
    }
    updateFeedFooter(0);
    return;
  }

  const showInstructor = !document.getElementById('instructorFilter').value;
  document.getElementById('calContent').innerHTML = renderBookingCalendar(slotCache, { showInstructor });
  updateFeedFooter(allSlots.length);
}

function updateFeedFooter(slotCount) {
  const footer = document.getElementById('feedFooter');
  const status = document.getElementById('feedStatus');
  const btn = document.getElementById('btnLoadMore');
  if (footer) footer.style.display = 'none';
  if (status) status.textContent = '';
  if (btn) {
    btn.hidden = true;
    btn.style.display = 'none';
  }
}

async function loadMoreSlots() {
  return;
}
window.loadMoreSlots = loadMoreSlots;

function showLoading() { document.getElementById('calContent').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading available slots…</p></div>'; document.getElementById('feedFooter').style.display = 'none'; }
function showError(msg) { document.getElementById('calContent').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${msg}</p></div>`; document.getElementById('feedFooter').style.display = 'none'; }

// ─── Book modal ──────────────────────────────────────────────────────────────
// Apply a chosen lesson type to all the price/duration/credit/pay UI inside
// the modal. Called from openBookModal after dropdown selection (or auto-pick
// when only one option fits). Pure UI write - no side effects beyond the DOM
// and selectedLessonType.
function applyLessonTypeToModal(lt, isGuest, needsProfileFields) {
  selectedLessonType = { ...lt, id: lt.id || lt.lesson_type_id };
  const ltDuration = lt.duration_minutes;
  // Recompute pendingSlot.end_time to match the picked duration. Backend
  // handlers (handleBook, handleCheckoutSlot, handleCheckoutSlotGuest) read
  // start_time + end_time from the body - they must reflect the user's choice,
  // not the grid's smallest-duration end-time.
  if (pendingSlot && pendingSlot.start_time) {
    const [h, m] = pendingSlot.start_time.split(':').map(Number);
    const startMins = h * 60 + m;
    const endMins = startMins + ltDuration;
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    pendingSlot.end_time = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    document.getElementById('mdTime').textContent = `${pendingSlot.start_time} – ${pendingSlot.end_time}`;
  }
  const ltHrs = ltDuration / 60;
  const ltHrsStr = ltHrs % 1 === 0 ? `${ltHrs} hour${ltHrs !== 1 ? 's' : ''}` : `${ltHrs.toFixed(1)} hours`;
  document.getElementById('mdDuration').textContent = ltHrsStr;
  refreshSocialVideoOption();
  const chargeMins = socialVideoChargeMinutes(ltDuration);
  document.getElementById('mdDeductHours').textContent = formatHours(chargeMins);
  const ltPrice = lt.price_pence != null ? lt.price_pence : DEFAULT_PRICE_PENCE;
  const ltPriceStr = formatMoney(socialVideoPrice(ltPrice));
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
    document.getElementById('mdDeductHours').textContent = 'free - no credits required';
    document.getElementById('bookBtnLabel').textContent = 'Confirm booking';
    document.getElementById('bookSpinner').style.display = 'none';
    document.getElementById('btnConfirmBook').disabled = false;
  } else {
    const hasCreds = selectedInstructorBalanceMinutes >= chargeMins;
    document.getElementById('modalCreditPath').style.display = hasCreds ? 'block' : 'none';
    document.getElementById('modalPayPath').style.display = hasCreds ? 'none' : 'block';
    if (hasCreds) {
      document.getElementById('bookBtnLabel').textContent = 'Confirm booking';
      document.getElementById('bookSpinner').style.display = 'none';
      document.getElementById('btnConfirmBook').disabled = false;
    }
    updateBalanceLine(chargeMins);
  }

  applyRequestModeUi(isGuest, ltPriceStr, chargeMins);
}

// Request-to-book modal chrome: swap the book/pay copy for hold copy and hide
// weekly repeats (requests are single-slot). Restores defaults when the modal
// is reused for an instant-book instructor.
let requestUiApplied = false;
function applyRequestModeUi(isGuest, ltPriceStr, chargeMins) {
  const repeatSection = document.getElementById('repeatSection');
  const creditNote = document.getElementById('mdCreditNote');
  const payNote = document.getElementById('mdPayNote');
  const instructorFirst = firstName(pendingSlot?.instructor_name || 'The instructor');

  if (slotRequestMode) {
    requestUiApplied = true;
    if (repeatSection) repeatSection.style.display = 'none';
    document.getElementById('bookBtnLabel').textContent = 'Send request';
    document.getElementById('payBtnLabel').textContent = `Request — hold ${ltPriceStr}`;
    if (creditNote) {
      creditNote.innerHTML = `${esc(instructorFirst)} confirms each booking personally. We'll hold `
        + `<strong id="mdDeductHours">${esc(formatHours(chargeMins))}</strong> from your balance while they decide `
        + `(up to 48 hours) — returned in full if they can't make it.`;
    }
    if (payNote) {
      payNote.innerHTML = `${esc(instructorFirst)} confirms each booking personally. We'll hold `
        + `<strong id="mdPayAmount">${esc(ltPriceStr)}</strong> on your card — it's <strong>only charged if they accept</strong>. `
        + `If they decline or don't respond within 48 hours, the hold simply disappears. No charge.`;
    }
  } else if (requestUiApplied) {
    // Only rebuild the default copy if a previous request-mode render
    // replaced it — avoids clobbering path-specific text (e.g. the
    // payments-disabled 'free' override) on ordinary opens.
    requestUiApplied = false;
    if (repeatSection && !isGuest) repeatSection.style.display = '';
    if (creditNote) {
      creditNote.innerHTML = `This will use <strong id="mdDeductHours">${esc(formatHours(chargeMins))}</strong> from your balance. `
        + `Cancel 48+ hours before and it returns automatically.`;
    }
    if (payNote) {
      payNote.innerHTML = `You have no lessons on your account. Pay <strong id="mdPayAmount">${esc(ltPriceStr)}</strong> now and we'll book this slot instantly. `
        + `Cancel 48+ hours before and it returns as a lesson credit.`;
    }
    if (!paymentsEnabled) {
      const deduct = document.getElementById('mdDeductHours');
      if (deduct) deduct.textContent = 'free - no credits required';
    }
  }
}

function openBookModal(el) {
  const isGuest = !auth;
  const needsProfileFields = !isGuest && !isProfileComplete();

  // Reschedule mode bypasses the duration picker - rescheduled bookings keep their original duration.
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
    transmission_type: el.dataset.transmissionType,
    instructor_name: el.dataset.instructorName
  };
  slotRequestMode = el.dataset.requestToBook === '1' || el.dataset.requestToBook === true;
  socialVideoOption = { available: false, discountPct: 5 };
  const socialVideoCheckbox = document.getElementById('mdSocialVideoConsent');
  if (socialVideoCheckbox) socialVideoCheckbox.checked = false;
  const socialVideoWrap = document.getElementById('socialVideoOption');
  if (socialVideoWrap) socialVideoWrap.style.display = 'none';
  selectedInstructorBalanceMinutes = 0;
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
  document.getElementById('mdDate').textContent = dateDisplay;
  document.getElementById('mdTime').textContent = pendingSlot.start_time;
  document.getElementById('mdInstructor').textContent = pendingSlot.instructor_name;
  document.getElementById('mdTransmission').textContent = transmissionLabel(pendingSlot.transmission_type);
  const pickupMode = document.getElementById('mdPickupMode');
  if (pickupMode) pickupMode.value = 'home';
  const dropoffMode = document.getElementById('mdDropoffMode');
  if (dropoffMode) dropoffMode.value = 'same';
  syncBookingLocationControls(isGuest);

  // Reset duration-picker UI to loading state.
  document.getElementById('mdDurationPicker').style.display = 'none';
  document.getElementById('mdSingleTypeRow').style.display = 'none';
  document.getElementById('mdNoFitRow').style.display = 'none';
  document.getElementById('mdLoadingRow').style.display = 'flex';
  document.getElementById('mdDuration').textContent = ' - ';
  document.getElementById('modalCreditPath').style.display = 'none';
  document.getElementById('modalPayPath').style.display = 'none';
  document.getElementById('btnPayAndBook').disabled = true;
  document.getElementById('btnConfirmBook') && (document.getElementById('btnConfirmBook').disabled = true);

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
    syncRepeatWindowOptions();
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
  document.getElementById('mdDurationPicker').style.display = 'none';
  document.getElementById('mdSingleTypeRow').style.display = 'none';
  document.getElementById('mdNoFitRow').style.display = 'none';
  document.getElementById('mdLoadingRow').style.display = 'flex';
  document.getElementById('modalCreditPath').style.display = 'none';
  document.getElementById('modalPayPath').style.display = 'none';
  document.getElementById('btnPayAndBook').disabled = true;
  const creditBtn = document.getElementById('btnConfirmBook');
  if (creditBtn) creditBtn.disabled = true;
  try {
    const selectedBalancePromise = isGuest ? Promise.resolve() : loadSelectedInstructorBalance(slot);
    let url = `/api/slots?action=durations-for-slot&instructor_id=${encodeURIComponent(slot.instructor_id)}&date=${encodeURIComponent(slot.date)}&start_time=${encodeURIComponent(slot.start_time)}`;
    if (slot.transmission_type) url += `&transmission_type=${encodeURIComponent(slot.transmission_type)}`;
    if (!isGuest && auth && auth.user && auth.user.id) url += `&learner_id=${encodeURIComponent(auth.user.id)}`;
    const pc = getActivePickupPostcode(isGuest);
    if (pc) url += `&pickup_postcode=${encodeURIComponent(pc)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load durations');
    await selectedBalancePromise;
    // Authoritative request-to-book flag (dataset may be stale after the
    // instructor flips the toggle).
    slotRequestMode = !!data.request_to_book;
    socialVideoOption = {
      available: slotRequestMode ? false : !!data.social_video_opt_in,
      discountPct: Number(data.social_video_discount_pct || 5),
    };

    const durations = (data.durations || [])
      .filter(d => d && d.slug !== 'trial')
      .slice()
      .sort((a, b) => a.duration_minutes - b.duration_minutes);
    const fitting = durations.filter(d => d.fits);

    document.getElementById('mdLoadingRow').style.display = 'none';
    const hint = document.getElementById('mdLocationCheckHint');
    if (hint) hint.style.display = 'none';

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
                       : reasons.includes('advance') ? 'this date is outside the instructor\'s booking window'
                       : 'no lesson lengths fit this slot';
      document.getElementById('mdNoFitText').textContent = reasonText;
      document.getElementById('mdNoFitRow').style.display = 'flex';
      document.getElementById('mdDuration').textContent = ' - ';
      document.getElementById('modalCreditPath').style.display = 'none';
      document.getElementById('modalPayPath').style.display = 'none';
      // Disable both confirm paths; user has to close + pick another slot.
      document.getElementById('btnPayAndBook').disabled = true;
      const credBtn = document.getElementById('btnConfirmBook');
      if (credBtn) credBtn.disabled = true;
      return;
    }

    const requestedId = selectedLessonType && selectedLessonType.id ? String(selectedLessonType.id) : '';
    const validatedType = requestedId
      ? fitting.find(d => String(d.lesson_type_id) === requestedId)
      : fitting[0];

    if (!validatedType) {
      const requested = requestedId
        ? durations.find(d => String(d.lesson_type_id) === requestedId)
        : null;
      const reason = requested && requested.reason;
      const reasonText = reason === 'travel' ? 'travel time prevents this lesson length here'
                       : reason === 'clash' ? 'this length clashes with an existing booking'
                       : reason === 'window' ? 'this lesson length runs outside the instructor\'s available window'
                       : reason === 'notice' ? 'this time is too short notice for that length'
                       : reason === 'advance' ? 'this date is outside the instructor\'s booking window'
                       : reason === 'not_offered' ? 'this instructor does not offer that length'
                       : 'the selected lesson length does not fit this time';
      document.getElementById('mdNoFitText').textContent = `${selectedLessonType ? selectedLessonType.name : 'Selected lesson'}: ${reasonText}. Choose another time or lesson length.`;
      document.getElementById('mdNoFitRow').style.display = 'flex';
      document.getElementById('mdDuration').textContent = ' - ';
      document.getElementById('modalCreditPath').style.display = 'none';
      document.getElementById('modalPayPath').style.display = 'none';
      document.getElementById('btnPayAndBook').disabled = true;
      const credBtn = document.getElementById('btnConfirmBook');
      if (credBtn) credBtn.disabled = true;
      window.posthog && posthog.capture('selected_duration_no_fit', {
        instructor_id: slot.instructor_id,
        date: slot.date,
        start_time: slot.start_time,
        lesson_type_slug: selectedLessonType?.slug,
        reason: reason || null
      });
      return;
    }

    // Auto-collapse when there's only one option for the school AND only one fits.
    if (durations.length === 1 && fitting.length === 1) {
      document.getElementById('mdSingleType').textContent = `${fitting[0].name} - ${formatHours(fitting[0].duration_minutes)} - £${(fitting[0].price_pence / 100).toFixed(2)}`;
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

    // Render dropdown - fitting options first, non-fitting disabled with a reason suffix.
    select.innerHTML = '';
    for (const d of fitting) {
      const opt = document.createElement('option');
      opt.value = String(d.lesson_type_id);
      opt.textContent = `${d.name} - ${formatHours(d.duration_minutes)} - £${(d.price_pence / 100).toFixed(2)}`;
      select.appendChild(opt);
    }
    for (const d of durations.filter(d => !d.fits)) {
      const opt = document.createElement('option');
      opt.value = String(d.lesson_type_id);
      opt.disabled = true;
      const why = d.reason === 'travel' ? 'travel' : d.reason === 'clash' ? 'clash' : d.reason === 'window' ? 'too long' : d.reason === 'notice' ? 'short notice' : d.reason === 'advance' ? 'too far ahead' : d.reason === 'not_offered' ? 'not offered' : 'unavailable';
      opt.textContent = `${d.name} - ${formatHours(d.duration_minutes)} - unavailable (${why})`;
      select.appendChild(opt);
    }
    // Preselect order: page-level lesson length → ?type= URL slug →
    // cc_last_lesson_type_id (returning learner default) → first fitting
    // (smallest). No expiry on localStorage; lessons are infrequent.
    let preselected = null;
    let preselectSource = 'default';
    if (selectedLessonType && selectedLessonType.id) {
      preselected = fitting.find(d => String(d.lesson_type_id) === String(selectedLessonType.id));
      if (preselected) preselectSource = 'page_control';
    }
    if (!preselected && preselectedTypeSlug) {
      preselected = fitting.find(d => d.slug === preselectedTypeSlug);
      if (preselected) preselectSource = 'url_param';
    } else if (!preselected && preselectedTypeId) {
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
    const hint = document.getElementById('mdLocationCheckHint');
    if (hint) hint.style.display = 'none';
    document.getElementById('mdLoadingRow').style.display = 'none';
    document.getElementById('mdNoFitText').textContent = 'Could not load lesson options. Please try another slot.';
    document.getElementById('mdNoFitRow').style.display = 'flex';
    document.getElementById('modalCreditPath').style.display = 'none';
    document.getElementById('modalPayPath').style.display = 'none';
  }
}

function formatHours(mins) {
  const h = mins / 60;
  return h % 1 === 0 ? `${h} hour${h !== 1 ? 's' : ''}` : `${h.toFixed(1)} hours`;
}

function formatMoney(pence) {
  return String.fromCharCode(163) + ((Number(pence) || 0) / 100).toFixed(2);
}

// £55 rather than £55.00 - for compact UI like the length buttons
function formatMoneyShort(pence) {
  const p = Number(pence) || 0;
  return p % 100 === 0 ? String.fromCharCode(163) + (p / 100) : formatMoney(p);
}

function socialVideoConsentChecked() {
  const cb = document.getElementById('mdSocialVideoConsent');
  return !!(socialVideoOption.available && cb && cb.checked);
}

function socialVideoAgeConfirmed() {
  return socialVideoConsentChecked();
}

function socialVideoSelected() {
  return socialVideoConsentChecked();
}

function socialVideoPrice(pricePence) {
  const price = Number(pricePence) || 0;
  if (!socialVideoSelected()) return price;
  const pct = Number(socialVideoOption.discountPct || 5);
  return Math.max(0, Math.round(price * (100 - pct) / 100));
}

function socialVideoChargeMinutes(durationMinutes) {
  const minutes = Number(durationMinutes) || 0;
  if (!socialVideoSelected()) return minutes;
  const pct = Number(socialVideoOption.discountPct || 5);
  return Math.max(1, Math.round(minutes * (100 - pct) / 100));
}

function refreshSocialVideoOption() {
  const wrap = document.getElementById('socialVideoOption');
  const cb = document.getElementById('mdSocialVideoConsent');
  const priceEl = document.getElementById('mdSocialVideoPrice');
  if (!wrap || !cb || !priceEl || !selectedLessonType) return;
  wrap.style.display = socialVideoOption.available ? 'block' : 'none';
  if (!socialVideoOption.available) {
    cb.checked = false;
  }
  const base = Number(selectedLessonType.price_pence || DEFAULT_PRICE_PENCE);
  const pct = Number(socialVideoOption.discountPct || 5);
  const discounted = Math.max(0, Math.round(base * (100 - pct) / 100));
  priceEl.textContent = socialVideoOption.available
    ? `Tick this box to make ${formatMoney(base)} become ${formatMoney(discounted)} for this booking.`
    : '';
}

function validateSocialVideoEligibility() {
  return true;
}

function firstName(value) {
  const text = String(value || '').trim();
  return text.split(/\s+/)[0] || text;
}

function normaliseTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['manual', 'automatic', 'both'].includes(text) ? text : null;
}

function transmissionLabel(value) {
  switch (normaliseTransmissionType(value)) {
    case 'automatic': return 'Auto';
    case 'both': return 'Manual or auto';
    default: return 'Manual';
  }
}

// Persist the last-picked lesson type so a returning learner sees their usual
// duration preselected on the next booking. No expiry - driving lessons are
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
  clearTimeout(locationCheckTimer);
  document.getElementById('bookModal').classList.remove('open');
  document.getElementById('repeatToggle').checked = false;
  document.getElementById('repeatOptions').classList.remove('open');
  setRepeatWeeks(4, { skipUpdate: true });
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
  syncRepeatCountButtons();
  if (open) updateRepeatDates();
  updateDeductDisplay();
}

function getRepeatWeeks() {
  if (!document.getElementById('repeatToggle').checked) return 1;
  return parseInt(document.getElementById('repeatWeeksSelect').value, 10);
}

function syncRepeatCountButtons() {
  const select = document.getElementById('repeatWeeksSelect');
  if (!select) return;
  document.querySelectorAll('.repeat-count-btn').forEach(btn => {
    const selected = btn.dataset.repeatWeeks === select.value;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

function maxRepeatLessonsForPendingSlot() {
  if (!pendingSlot || !pendingSlot.date) return 4;
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const slotDate = new Date(pendingSlot.date + 'T00:00:00Z');
  const offsetDays = Math.max(0, Math.round((slotDate - today) / (24 * 60 * 60 * 1000)));
  const windowDays = instructorWindowDays(pendingSlot.instructor_id);
  return Math.max(1, Math.min(4, Math.floor((windowDays - offsetDays) / 7) + 1));
}

function syncRepeatWindowOptions() {
  const maxWeeks = maxRepeatLessonsForPendingSlot();
  const repeatSection = document.getElementById('repeatSection');
  const repeatToggle = document.getElementById('repeatToggle');
  const select = document.getElementById('repeatWeeksSelect');
  if (!repeatSection || !repeatToggle || !select) return maxWeeks;

  const canRepeat = maxWeeks >= 2;
  repeatSection.style.display = canRepeat ? '' : 'none';
  if (!canRepeat) {
    repeatToggle.checked = false;
    document.getElementById('repeatOptions')?.classList.remove('open');
  }

  Array.from(select.options).forEach(option => {
    const fits = parseInt(option.value, 10) <= maxWeeks;
    option.disabled = !fits;
    option.hidden = !fits;
  });
  document.querySelectorAll('.repeat-count-btn').forEach(btn => {
    const fits = parseInt(btn.dataset.repeatWeeks, 10) <= maxWeeks;
    btn.disabled = !fits;
    btn.hidden = !fits;
  });

  const current = parseInt(select.value, 10);
  if (!Number.isFinite(current) || current < 2 || current > maxWeeks) {
    select.value = String(Math.min(4, Math.max(2, maxWeeks)));
  }
  syncRepeatCountButtons();
  return maxWeeks;
}

function setRepeatWeeks(weeks, opts) {
  opts = opts || {};
  const select = document.getElementById('repeatWeeksSelect');
  if (!select) return;
  const maxWeeks = maxRepeatLessonsForPendingSlot();
  if (weeks > maxWeeks) weeks = maxWeeks;
  select.value = String(weeks);
  syncRepeatCountButtons();
  if (!opts.skipUpdate && document.getElementById('repeatToggle')?.checked) {
    updateRepeatDates();
  }
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
  // so chunk by date span: max 4 weekly dates per request (≤21 days span).
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
      const tx = pendingSlot.transmission_type ? '&transmission_type=' + encodeURIComponent(pendingSlot.transmission_type) : '';
      const res = await ccAuth.fetchAuthed(`/api/slots?action=available&from=${from}&to=${to}&instructor_id=${instId}${ltId ? '&lesson_type_id=' + ltId : ''}${pc ? '&pickup_postcode=' + pc : ''}${tx}`);
      const data = await res.json();
      Object.assign(allSlots, data.slots || {});
    }
    for (let i = 1; i < dates.length; i++) {
      const dateSlots = allSlots[dates[i]] || [];
      const hasSlot = dateSlots.some(s => s.start_time === pendingSlot.start_time && (!pendingSlot.transmission_type || s.transmission_type === pendingSlot.transmission_type));
      if (!hasSlot) repeatConflicts.push(dates[i]);
    }
  } catch {}

  // Render date list
  const container = document.getElementById('repeatDates');
  container.innerHTML = dates.map((d, i) => {
    const display = new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const isConflict = repeatConflicts.includes(d);
    const title = i === 0 ? 'First lesson' : `Lesson ${i + 1}`;
    return `<div class="repeat-date-item${isConflict ? ' conflict' : ''}">
      <span class="repeat-num">${i + 1}</span>
      <span class="repeat-date-copy">
        <span class="repeat-date-title">${title}</span>
        <span class="repeat-date-subtitle">${display} at ${pendingSlot.start_time}</span>
      </span>
      ${isConflict ? '<span class="repeat-date-status">Unavailable</span>' : ''}
    </div>`;
  }).join('');

  // Conflict warning
  const warning = document.getElementById('repeatConflictWarning');
  if (repeatConflicts.length > 0) {
    warning.textContent = `${repeatConflicts.length} repeat date${repeatConflicts.length === 1 ? '' : 's'} unavailable. Pick fewer lessons or choose another time.`;
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
  const chargeMins = socialVideoChargeMinutes(ltDuration);
  const totalMins = chargeMins * weeks;
  const totalHrs = totalMins / 60;
  const totalStr = totalHrs % 1 === 0 ? `${totalHrs} hours` : `${totalHrs.toFixed(1)} hours`;

  document.getElementById('mdDeductHours').textContent = totalStr;

  if (weeks > 1) {
    const perLesson = chargeMins / 60;
    const perStr = perLesson % 1 === 0 ? `${perLesson} hour${perLesson !== 1 ? 's' : ''}` : `${perLesson.toFixed(1)} hours`;
    document.getElementById('repeatTotal').textContent = `Total: ${totalStr} (${weeks} �- ${perStr})`;
    document.getElementById('repeatTotal').style.display = 'block';
  } else {
    document.getElementById('repeatTotal').style.display = 'none';
  }

  // Update balance check for credit path visibility
  if (!paymentsEnabled) {
    // Free booking mode - always show credit path, hide pay path
    document.getElementById('modalCreditPath').style.display = 'block';
    document.getElementById('modalPayPath').style.display = 'none';
    // Update deduction text to indicate free booking
    document.getElementById('mdDeductHours').textContent = 'free - no credits required';
  } else {
    const hasCreds = selectedInstructorBalanceMinutes >= totalMins;
    document.getElementById('modalCreditPath').style.display = hasCreds ? 'block' : 'none';
    document.getElementById('modalPayPath').style.display = hasCreds ? 'none' : 'block';
    updateBalanceLine(totalMins);
  }
}

function updateBalanceLine(deductMins) {
  const el = document.getElementById('mdBalanceLine');
  if (!el) return;
  const fmt = m => (m / 60).toFixed(1).replace(/\.0$/, '') + 'h';
  const balance = selectedInstructorBalanceMinutes || 0;
  const after = Math.max(0, balance - deductMins);
  const instructor = pendingSlot && pendingSlot.instructor_name ? ` with ${pendingSlot.instructor_name}` : '';
  el.textContent = `You have ${fmt(balance)}${instructor} - ${fmt(after)} remaining after this booking.`;
}

function updateBookButtonState() {
  const weeks = getRepeatWeeks();
  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  if (slotRequestMode) {
    label.textContent = 'Send request';
    btn.disabled = false;
    return;
  }
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

// ─── Send request with credit hold (request-to-book instructors) ─────────────
async function confirmRequestWithCredit(locations) {
  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  const spinner = document.getElementById('bookSpinner');
  btn.disabled = true; label.textContent = 'Sending request…'; spinner.style.display = 'block';

  try {
    const body = {
      instructor_id: pendingSlot.instructor_id,
      date: pendingSlot.date,
      start_time: pendingSlot.start_time,
      end_time: pendingSlot.end_time,
      transmission_type: pendingSlot.transmission_type,
      pickup_address: locations.pickup_address
    };
    if (selectedLessonType && selectedLessonType.id) body.lesson_type_id = selectedLessonType.id;
    const res = await ccAuth.fetchAuthed('/api/slots?action=request-slot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed');

    balanceMinutes = data.balance_minutes || 0;
    selectedInstructorBalanceMinutes = data.balance_minutes || 0;
    updateCreditBadge();
    setLastLessonType(selectedLessonType);
    window.posthog && posthog.capture('lesson_request_sent', { method: 'credit', lesson_type_slug: selectedLessonType?.slug });
    showRequestSuccess();
    refreshAfterBooking();
  } catch (err) {
    showToast(err.message || 'Request failed. Please try again.', 'error');
    btn.disabled = false;
    label.textContent = 'Send request';
    spinner.style.display = 'none';
  }
}

// ─── Confirm with credit ─────────────────────────────────────────────────────
async function confirmBookWithCredit() {
  if (!pendingSlot) return;
  // Save profile fields first if shown (phone/pickup for incomplete profiles)
  if (!(await saveProfileFieldsFromModal())) return;
  const locations = validateBookingLocations(false);
  if (!locations) return;
  if (!validateSocialVideoEligibility()) return;

  if (slotRequestMode) return confirmRequestWithCredit(locations);

  const btn = document.getElementById('btnConfirmBook');
  const label = document.getElementById('bookBtnLabel');
  const spinner = document.getElementById('bookSpinner');
  const weeks = getRepeatWeeks();
  btn.disabled = true; label.textContent = weeks > 1 ? `Booking ${weeks} lessons…` : 'Booking…'; spinner.style.display = 'block';

  try {
    const bookBody = { ...pendingSlot, pickup_address: locations.pickup_address };
    bookBody.social_video_consent = socialVideoConsentChecked();
    bookBody.social_video_age_confirmed = socialVideoAgeConfirmed();
    if (locations.dropoff_address) bookBody.dropoff_address = locations.dropoff_address;
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
    selectedInstructorBalanceMinutes = data.balance_minutes || 0;
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

// ─── Claim-as-free-trial (guest CTA) ─────────────────────────────────────────
// Routes the guest to /free-trial.html carrying the chosen instructor + date as
// hints. The trial handler enforces strict duration matching, so the slot itself
// cannot be force-converted - the guest re-picks a real trial slot on the
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

  // Guest validation - inline per-field errors
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
  const locations = validateBookingLocations(isGuest);
  if (!locations) return;
  if (!validateSocialVideoEligibility()) return;

  btn.disabled = true; label.textContent = 'Redirecting to payment…'; spinner.style.display = 'block';
  setLastLessonType(selectedLessonType);
  window.posthog && posthog.capture('booking_pay_initiated', { method: 'stripe', is_guest: isGuest, lesson_type_slug: selectedLessonType?.slug });

  try {
    if (slotRequestMode) {
      // Request-to-book: manual-capture checkout. Card is authorized now,
      // charged only if the instructor accepts.
      const requestBody = {
        instructor_id: pendingSlot.instructor_id,
        date: pendingSlot.date,
        start_time: pendingSlot.start_time,
        end_time: pendingSlot.end_time,
        transmission_type: pendingSlot.transmission_type,
        lesson_type_id: selectedLessonType?.id,
        pickup_address: locations.pickup_address
      };
      if (isGuest) {
        requestBody.guest_name  = document.getElementById('mdGuestName').value.trim();
        requestBody.guest_email = document.getElementById('mdGuestEmail').value.trim();
        requestBody.guest_phone = document.getElementById('mdGuestPhone').value.replace(/\s+/g, '').trim();
      }
      const res = await ccAuth.fetchAuthed('/api/slots?action=checkout-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      window.location.href = data.url;
      return;
    }
    if (isGuest) {
      // Guest checkout - no auth required
      const payBody = {
        ...pendingSlot,
        lesson_type_id: selectedLessonType?.id,
        dropoff_address: locations.dropoff_address || undefined,
        guest_name:           document.getElementById('mdGuestName').value.trim(),
        guest_email:          document.getElementById('mdGuestEmail').value.trim(),
        guest_phone:          document.getElementById('mdGuestPhone').value.replace(/\s+/g, '').trim(),
        guest_pickup_address: locations.pickup_address,
        social_video_consent: socialVideoConsentChecked(),
        social_video_age_confirmed: socialVideoAgeConfirmed()
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
      const payBody = { ...pendingSlot, pickup_address: locations.pickup_address };
      payBody.social_video_consent = socialVideoConsentChecked();
      payBody.social_video_age_confirmed = socialVideoAgeConfirmed();
      if (locations.dropoff_address) payBody.dropoff_address = locations.dropoff_address;
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
    const priceStr = formatMoney(socialVideoPrice(ltPrice));
    btn.disabled = false;
    label.textContent = slotRequestMode ? `Request — hold ${priceStr}` : `Pay ${priceStr} & book`;
    spinner.style.display = 'none';
  }
}

// Success state for a sent request (credit path — the card path returns via
// ?requested=1 after Stripe).
function showRequestSuccess() {
  const successStep = document.getElementById('bookSuccessStep');
  const dateDisplay = new Date(pendingSlot.date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', timeZone:'UTC' });
  successStep.querySelector('h2').textContent = 'Request sent!';
  successStep.querySelector('p').innerHTML = `We've asked <strong>${esc(pendingSlot.instructor_name)}</strong> about `
    + `<strong>${esc(dateDisplay)}</strong> at <strong>${esc(pendingSlot.start_time)}</strong>. `
    + `They have up to 48 hours to confirm — we'll text and email you either way. `
    + `Your credit is held until then and returned in full if they can't make it.`;

  const balanceEl = document.getElementById('successBalance');
  if (balanceEl) balanceEl.style.display = 'none';
  const reservedWeeklyPrompt = document.getElementById('reservedWeeklySuccessPrompt');
  if (reservedWeeklyPrompt) reservedWeeklyPrompt.style.display = 'none';
  const calSyncPrompt = document.getElementById('calSyncPrompt');
  if (calSyncPrompt) calSyncPrompt.style.display = 'none';
  const calSyncedNote = document.getElementById('calSyncedNote');
  if (calSyncedNote) calSyncedNote.style.display = 'none';
  recurringAnchorBookingId = null;
  recurringAnchorContext = null;

  document.getElementById('bookConfirmStep').style.display = 'none';
  successStep.style.display = 'block';
}

function showBookSuccess(weeks, dates) {
  const successStep = document.getElementById('bookSuccessStep');
  const isSingleBooking = !(weeks && weeks > 1);
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
  if (balanceEl && selectedInstructorBalanceMinutes > 0) {
    const instructor = pendingSlot && pendingSlot.instructor_name ? ` with ${pendingSlot.instructor_name}` : '';
    balanceEl.textContent = `Hours remaining${instructor}: ${(selectedInstructorBalanceMinutes / 60).toFixed(1)}h`;
    balanceEl.style.display = 'block';
  } else if (balanceEl) {
    balanceEl.style.display = 'none';
  }

  const reservedWeeklyPrompt = document.getElementById('reservedWeeklySuccessPrompt');
  if (reservedWeeklyPrompt) {
    reservedWeeklyPrompt.style.display = weeks && weeks > 1 ? 'none' : 'block';
  }
  recurringAnchorBookingId = isSingleBooking ? lastBookingId : null;
  recurringAnchorContext = isSingleBooking && pendingSlot ? {
    date: pendingSlot.date,
    start_time: pendingSlot.start_time,
    instructor_name: pendingSlot.instructor_name
  } : null;

  const showSync = shouldShowCalSync();
  document.getElementById('calSyncPrompt').style.display = showSync ? 'block' : 'none';
  document.getElementById('calSyncedNote').style.display = showSync ? 'none' : 'block';

  document.getElementById('bookConfirmStep').style.display = 'none';
  successStep.style.display = 'block';
}

function handlePaidRecurringPrompt() {
  window.location.href = auth ? '/learner/lessons.html' : '/learner/login.html';
}

async function handleReservedBankReturn(blockId, opts = {}) {
  if (!auth) return;
  if (!/^\d+$/.test(String(blockId || ''))) {
    showToast('Could not find that weekly block checkout.', 'error');
    window.history.replaceState({}, '', '/learner/book.html');
    return;
  }

  document.getElementById('bookModal').classList.remove('open');
  document.getElementById('recurringBlockModal').classList.add('open');
  document.getElementById('recurringBlockControls').style.display = 'none';
  document.getElementById('recurringBlockPreview').style.display = 'none';
  document.getElementById('recurringBlockConfirmed').style.display = 'none';
  document.getElementById('recurringBlockActions').style.display = 'flex';
  document.getElementById('btnConfirmRecurringBlock').style.display = 'none';
  document.getElementById('recurringBlockLoading').textContent = 'Checking weekly block payment...';
  document.getElementById('recurringBlockLoading').style.display = 'block';
  document.getElementById('recurringBlockPattern').textContent = 'Reserved Weekly Slot payment';
  document.getElementById('recurringBlockAnchorCopy').textContent = opts.cancelled
    ? 'Checkout was cancelled. We are checking whether the bank payment changed the block status.'
    : 'Checking the bank payment status for your weekly block.';

  try {
    const res = await ccAuth.fetchAuthed(`/api/slots?action=recurring-block-status&block_id=${encodeURIComponent(blockId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Could not load weekly block status');
    renderReservedBankStatus(data, opts);
  } catch (err) {
    document.getElementById('recurringBlockLoading').style.display = 'none';
    document.getElementById('recurringBlockConfirmed').style.display = 'block';
    document.getElementById('recurringBlockConfirmed').innerHTML = `
      <div class="recurring-status-box warn">${esc(err.message || 'Could not load weekly block status.')}</div>
    `;
    showToast(err.message || 'Could not load weekly block status.', 'error');
  } finally {
    window.history.replaceState({}, '', '/learner/book.html');
  }
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderReservedBankStatus(data, opts = {}) {
  const block = data.block || {};
  const items = data.items || [];
  const status = block.status || 'released';
  const dates = items.map(item => {
    const bookingSuffix = item.booking && item.booking.id ? ` <span>Booking #${esc(item.booking.id)}</span>` : '';
    return `<li>${esc(formatRecurringDate(item.date))} ${esc(item.start_time || '')}${bookingSuffix}</li>`;
  }).join('');
  const expiry = formatDateTime(block.expires_at);

  let title = 'Weekly block status';
  let copy = 'We could not confirm the latest status for this weekly block.';
  let tone = 'warn';
  let icon = '!';
  if (status === 'confirmed') {
    title = 'Weekly block booked.';
    copy = 'Your bank payment is confirmed and your Reserved Weekly Slot lessons are booked.';
    tone = 'good';
    icon = '✓';
  } else if (status === 'pending_payment') {
    title = 'Payment still processing.';
    copy = expiry
      ? `Your selected weekly slots are held while the bank payment finishes. The hold expires at ${expiry}; you do not need to try again yet.`
      : 'Your selected weekly slots are held while the bank payment finishes; you do not need to try again yet.';
    if (opts.cancelled) copy = 'Checkout was cancelled, but the bank payment has not failed yet. If you authorised the payment in your bank, it may still confirm shortly.';
  } else if (status === 'payment_failed') {
    title = 'Payment failed.';
    copy = 'The bank payment did not complete. The selected weekly slots have been released, so please choose the block again if you still want them.';
  } else if (status === 'expired') {
    title = 'Checkout expired.';
    copy = 'The checkout window closed before payment was confirmed. The selected weekly slots have been released, so please choose the block again if you still want them.';
  } else if (status === 'released') {
    title = 'We need to check this manually.';
    copy = 'We could not finish booking this weekly block. The selected slots are no longer held. If you authorised a bank payment, we will review it manually; this page does not trigger an automatic refund.';
  }

  document.getElementById('recurringBlockLoading').style.display = 'none';
  document.getElementById('recurringBlockPattern').textContent = `${block.instructor_name || 'Reserved Weekly Slot'} - ${block.selected_lessons || items.length || ''} lessons`;
  document.getElementById('recurringBlockAnchorCopy').textContent = block.lesson_type_name || 'Same instructor, same day, same time.';
  const confirmed = document.getElementById('recurringBlockConfirmed');
  confirmed.innerHTML = `
    <div class="modal-success-icon">${esc(icon)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(copy)}</p>
    ${dates ? `<ul class="recurring-confirmed-list">${dates}</ul>` : ''}
    <div class="recurring-status-box ${tone}">Status: ${esc(status.replace(/_/g, ' '))}</div>
    <button class="btn-done" type="button" id="recurringBankStatusDone">Done</button>
  `;
  confirmed.style.display = 'block';
  document.getElementById('recurringBlockActions').style.display = 'none';
  document.getElementById('recurringBankStatusDone').onclick = closeRecurringBlockModal;

  if (status === 'confirmed') {
    showToast('Weekly lesson block confirmed.', 'success');
    refreshAfterBooking();
  } else if (status === 'pending_payment') {
    showToast('Payment is still processing.', '');
  } else {
    showToast(copy, status === 'released' ? '' : 'error');
    refreshAfterBooking();
  }
}

function closeRecurringBlockModal() {
  document.getElementById('recurringBlockModal').classList.remove('open');
}

function clampRecurringLessons(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return RECURRING_BLOCK_MIN_LESSONS;
  return Math.max(RECURRING_BLOCK_MIN_LESSONS, Math.min(RECURRING_BLOCK_MAX_LESSONS, parsed));
}

function setRecurringLessonCount(value, opts = {}) {
  recurringLessonCount = clampRecurringLessons(value);
  document.getElementById('recurringLessonCountLabel').textContent = `${recurringLessonCount} lessons`;
  document.getElementById('recurringMinus').disabled = recurringLessonCount <= RECURRING_BLOCK_MIN_LESSONS;
  document.getElementById('recurringPlus').disabled = recurringLessonCount >= RECURRING_BLOCK_MAX_LESSONS;
  document.querySelectorAll('[data-recurring-lessons]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.recurringLessons, 10) === recurringLessonCount);
  });
  if (!opts.skipLoad && document.getElementById('recurringBlockModal').classList.contains('open')) {
    loadRecurringBlockPreview();
  }
}

function formatRecurringDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatMoneyPence(pence) {
  return String.fromCharCode(163) + (Number(pence || 0) / 100).toFixed(2);
}

function formatRecurringReason(reason) {
  switch (reason) {
    case 'booking_conflict': return 'Already booked';
    case 'recurring_hold_conflict': return 'Held by another weekly block';
    case 'blackout': return 'Instructor unavailable';
    case 'outside_availability': return 'No matching availability';
    default: return reason ? reason.replace(/_/g, ' ') : 'Unavailable';
  }
}

function setRecurringGate(message, tone = '') {
  const gate = document.getElementById('recurringBlockGate');
  gate.textContent = message || '';
  gate.className = 'recurring-status-box' + (tone ? ' ' + tone : '');
  gate.style.display = message ? 'block' : 'none';
}

function openRecurringBlockModal(source) {
  window.posthog && posthog.capture('recurring_block_preview_opened', { source });
  clearSlotTimer();
  document.getElementById('bookModal').classList.remove('open');
  document.getElementById('recurringBlockModal').classList.add('open');
  document.getElementById('recurringBlockConfirmed').style.display = 'none';
  document.getElementById('recurringBlockPreview').style.display = 'none';
  document.getElementById('recurringBlockActions').style.display = 'flex';
  document.getElementById('recurringBlockControls').style.display = 'block';
  document.getElementById('btnConfirmRecurringBlock').disabled = true;
  document.getElementById('btnConfirmRecurringBlock').style.display = '';
  document.getElementById('recurringConfirmSpinner').style.display = 'none';
  document.getElementById('recurringConfirmLabel').textContent = 'Confirm with Lesson Credit';
  recurringConfirmMode = 'credit';
  setRecurringLessonCount(recurringLessonCount || RECURRING_BLOCK_MIN_LESSONS, { skipLoad: true });
  updateRecurringAnchorCopy(null);

  if (!auth) {
    document.getElementById('recurringBlockControls').style.display = 'none';
    document.getElementById('recurringBlockLoading').style.display = 'none';
    setRecurringGate('Sign in first, then open My Lessons to reserve a weekly block from your confirmed booking.', 'warn');
    return;
  }
  if (!recurringAnchorBookingId) {
    document.getElementById('recurringBlockControls').style.display = 'none';
    document.getElementById('recurringBlockLoading').style.display = 'none';
    setRecurringGate('Open My Lessons after sign-in to choose the booking you want to use as the weekly pattern.', 'warn');
    return;
  }

  setRecurringGate('', '');
  loadRecurringBlockPreview();
}

function updateRecurringAnchorCopy(preview) {
  const pattern = document.getElementById('recurringBlockPattern');
  const copy = document.getElementById('recurringBlockAnchorCopy');
  const anchor = preview && preview.anchor;
  if (anchor) {
    const day = new Date(anchor.date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    pattern.textContent = `${anchor.instructor_name} - ${day} at ${anchor.start_time}`;
    copy.textContent = 'Same instructor, same day, same time. Unavailable weeks are skipped.';
  } else if (recurringAnchorContext) {
    const day = new Date(recurringAnchorContext.date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    pattern.textContent = `${recurringAnchorContext.instructor_name} - ${day} at ${recurringAnchorContext.start_time}`;
    copy.textContent = 'Same instructor, same day, same time. Unavailable weeks are skipped.';
  } else {
    pattern.textContent = 'Same instructor, same day, same time';
    copy.textContent = 'Choose 4-12 future weekly lessons to preview. Unavailable weeks are skipped.';
  }
}

async function loadRecurringBlockPreview() {
  if (!auth || !recurringAnchorBookingId || recurringPreviewBusy) return;
  recurringPreviewBusy = true;
  recurringPreview = null;
  document.getElementById('recurringBlockLoading').textContent = 'Loading weekly options...';
  document.getElementById('recurringBlockLoading').style.display = 'block';
  document.getElementById('recurringBlockPreview').style.display = 'none';
  document.getElementById('btnConfirmRecurringBlock').disabled = true;
  try {
    const url = `/api/slots?action=recurring-block-preview&booking_id=${encodeURIComponent(recurringAnchorBookingId)}&lessons=${encodeURIComponent(recurringLessonCount)}`;
    const res = await ccAuth.fetchAuthed(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Could not load weekly options');
    recurringPreview = data;
    updateRecurringAnchorCopy(data);
    renderRecurringBlockPreview();
  } catch (err) {
    document.getElementById('recurringBlockLoading').style.display = 'none';
    document.getElementById('recurringBlockPreview').style.display = 'block';
    document.getElementById('recurringBlockPreview').innerHTML = `<div class="recurring-status-box warn">${esc(err.message || 'Could not load weekly options.')}</div>`;
  } finally {
    recurringPreviewBusy = false;
  }
}

function renderRecurringBlockPreview() {
  if (!recurringPreview) return;
  document.getElementById('recurringBlockLoading').style.display = 'none';
  const previewEl = document.getElementById('recurringBlockPreview');
  previewEl.style.display = 'block';

  const credit = recurringPreview.credit || {};
  const pricing = recurringPreview.pricing || {};
  const hasEnoughCredit = !!credit.has_sufficient_credit;
  const canCreditCommit = !!(recurringPreview.can_commit && recurringPreview.credit && recurringPreview.credit.has_sufficient_credit && auth);
  const canBankCheckout = !!(recurringPreview.can_commit && recurringPreview.credit && !recurringPreview.credit.has_sufficient_credit && auth);
  recurringConfirmMode = canCreditCommit ? 'credit' : (canBankCheckout ? 'bank' : 'credit');
  const requiredHours = formatHours(credit.required_minutes || 0);
  const balanceHours = formatHours(credit.balance_minutes || 0);
  const totalPrice = formatMoneyPence(pricing.requested_total_price_pence || pricing.total_price_pence || 0);
  const selected = recurringPreview.selected_lessons || 0;
  const requested = recurringPreview.requested_lessons || recurringLessonCount;

  const weekRows = (recurringPreview.weeks || []).map(week => {
    const rowClass = week.selected ? ' selected' : (week.status === 'available' ? '' : ' unavailable');
    const label = week.selected ? 'Selected' : (week.status === 'available' ? 'Available' : 'Skipped');
    const detail = week.status === 'available'
      ? `${week.start_time} - ${week.end_time}`
      : formatRecurringReason(week.reason);
    return `<div class="recurring-week-row${rowClass}">
      <div class="recurring-week-main">
        <strong>${esc(formatRecurringDate(week.date))}</strong>
        <span>${esc(detail)}</span>
      </div>
      <span class="recurring-week-status">${esc(label)}</span>
    </div>`;
  }).join('');

  const availabilityBox = recurringPreview.can_commit
    ? `<div class="recurring-status-box good">${selected} future weekly lessons selected. Unavailable weeks are skipped and not stored.</div>`
    : `<div class="recurring-status-box warn">${selected} of ${requested} requested lessons are available. Pick fewer lessons or choose another slot pattern.</div>`;

  const creditBox = hasEnoughCredit
    ? `<div class="recurring-status-box good">You have ${esc(balanceHours)} Lesson Credit with this instructor. This block needs ${esc(requiredHours)} (${esc(totalPrice)}). You can confirm it now.</div>`
    : `<div class="recurring-status-box warn">You have ${esc(balanceHours)} Lesson Credit with this instructor. This block needs ${esc(requiredHours)} (${esc(totalPrice)}). You can pay upfront by bank; these slots are held for 10 minutes while checkout starts.</div>`;

  previewEl.innerHTML = `
    ${availabilityBox}
    ${creditBox}
    <div class="modal-section-title">Weekly preview</div>
    <div class="recurring-week-list">${weekRows}</div>
  `;

  document.getElementById('recurringConfirmLabel').textContent = canBankCheckout ? 'Pay upfront by bank' : 'Confirm with Lesson Credit';
  document.getElementById('btnConfirmRecurringBlock').disabled = !(canCreditCommit || canBankCheckout) || recurringCommitBusy;
}

async function confirmRecurringBlock() {
  if (recurringConfirmMode === 'bank') {
    return startRecurringBlockBankCheckout();
  }
  return confirmRecurringBlockWithCredit();
}

async function confirmRecurringBlockWithCredit() {
  if (!recurringPreview || recurringCommitBusy) return;
  const canCommit = !!(recurringPreview.can_commit && recurringPreview.credit && recurringPreview.credit.has_sufficient_credit && auth);
  if (!canCommit) return;

  recurringCommitBusy = true;
  const btn = document.getElementById('btnConfirmRecurringBlock');
  const label = document.getElementById('recurringConfirmLabel');
  const spinner = document.getElementById('recurringConfirmSpinner');
  btn.disabled = true;
  label.textContent = 'Confirming...';
  spinner.style.display = 'block';

  let confirmed = false;
  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=recurring-block-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anchor_booking_id: recurringAnchorBookingId,
        lessons: recurringLessonCount
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'SLOTS_UNAVAILABLE') {
        showToast('Some weekly slots changed. Review the refreshed preview.', 'error');
        if (data.preview) {
          recurringPreview = data.preview;
          updateRecurringAnchorCopy(data.preview);
          renderRecurringBlockPreview();
        } else {
          await loadRecurringBlockPreview();
        }
        return;
      }
      if (data.code === 'INSUFFICIENT_CREDIT') {
        showToast('Not enough same-instructor Lesson Credit for this block.', 'error');
        if (data.preview) {
          recurringPreview = data.preview;
          updateRecurringAnchorCopy(data.preview);
          renderRecurringBlockPreview();
        } else {
          await loadRecurringBlockPreview();
        }
        return;
      }
      throw new Error(data.message || data.error || 'Could not confirm weekly block');
    }

    selectedInstructorBalanceMinutes = data.balance_minutes || 0;
    loadCreditBalance();
    renderRecurringBlockConfirmed(data);
    confirmed = true;
    refreshAfterBooking();
    showToast('Weekly lesson block confirmed.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not confirm weekly block.', 'error');
  } finally {
    recurringCommitBusy = false;
    spinner.style.display = 'none';
    label.textContent = 'Confirm with Lesson Credit';
    if (recurringPreview && !confirmed) renderRecurringBlockPreview();
  }
}

async function startRecurringBlockBankCheckout() {
  if (!recurringPreview || recurringCommitBusy) return;
  const canCheckout = !!(recurringPreview.can_commit && recurringPreview.credit && !recurringPreview.credit.has_sufficient_credit && auth);
  if (!canCheckout) return;

  recurringCommitBusy = true;
  const btn = document.getElementById('btnConfirmRecurringBlock');
  const label = document.getElementById('recurringConfirmLabel');
  const spinner = document.getElementById('recurringConfirmSpinner');
  btn.disabled = true;
  label.textContent = 'Starting checkout...';
  spinner.style.display = 'block';

  try {
    const res = await ccAuth.fetchAuthed('/api/slots?action=recurring-block-bank-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anchor_booking_id: recurringAnchorBookingId,
        lessons: recurringLessonCount
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'SLOTS_UNAVAILABLE') {
        showToast('Some weekly slots changed. Review the refreshed preview.', 'error');
        if (data.preview) {
          recurringPreview = data.preview;
          updateRecurringAnchorCopy(data.preview);
          renderRecurringBlockPreview();
        } else {
          await loadRecurringBlockPreview();
        }
        return;
      }
      if (data.code === 'LESSON_CREDIT_AVAILABLE') {
        showToast('You now have enough same-instructor Lesson Credit for this block.', 'success');
        if (data.preview) {
          recurringPreview = data.preview;
          updateRecurringAnchorCopy(data.preview);
          renderRecurringBlockPreview();
        } else {
          await loadRecurringBlockPreview();
        }
        return;
      }
      throw new Error(data.message || data.error || 'Could not start bank checkout');
    }
    if (!data.url) throw new Error('Bank checkout did not return a payment link');
    window.location.href = data.url;
  } catch (err) {
    showToast(err.message || 'Could not start bank checkout.', 'error');
  } finally {
    recurringCommitBusy = false;
    spinner.style.display = 'none';
    if (recurringPreview) renderRecurringBlockPreview();
  }
}

function renderRecurringBlockConfirmed(data) {
  document.getElementById('recurringBlockControls').style.display = 'none';
  document.getElementById('recurringBlockPreview').style.display = 'none';
  document.getElementById('recurringBlockLoading').style.display = 'none';
  document.getElementById('btnConfirmRecurringBlock').disabled = true;
  document.getElementById('recurringBlockActions').style.display = 'none';
  const dates = (data.dates || []).map(d => `<li>${esc(formatRecurringDate(d))}</li>`).join('');
  const remaining = formatHours(data.balance_minutes || 0);
  const confirmed = document.getElementById('recurringBlockConfirmed');
  confirmed.innerHTML = `
    <div class="modal-success-icon">✓</div>
    <h2>Weekly block confirmed.</h2>
    <p>Your selected future lessons are booked with Lesson Credit.</p>
    <ul class="recurring-confirmed-list">${dates}</ul>
    <p>Remaining credit with this instructor: ${esc(remaining)}.</p>
    <button class="btn-done" type="button" id="recurringConfirmedDone">Done</button>
  `;
  confirmed.style.display = 'block';
  document.getElementById('recurringConfirmedDone').onclick = closeRecurringBlockModal;
}

function refreshAfterBooking() {
  // Clear cache and reload
  loadedRanges = []; slotCache = {};
  selectedDate = null;
  clearSelectedSlot();
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
    showToast('Calendar file downloaded - open it to add to your calendar', 'success');
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
    ? '✓ You are cancelling more than 48 hours before the lesson. <strong>Your lesson credit will be returned to your balance automatically.</strong>'
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
      policyEl.innerHTML = '✓ Each lesson in the series will be assessed individually. Lesson credit for lessons 48+ hours away will be returned to your balance.';
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
    document.getElementById('cancelSeriesInfo').textContent = 'All remaining lessons in this weekly series will be cancelled. Lesson credit returns apply per the 48-hour policy.';
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
    selectedDate = null;
    clearSelectedSlot();
    await Promise.all([loadUpcoming(), initFeed()]);
  } catch (err) {
    showToast(err.message || 'Cancellation failed.', 'error');
    btn.disabled = false;
    document.getElementById('cancelBtnLabel').textContent = cancelSeries ? 'Cancel series' : 'Cancel lesson';
  }
}

// ─── Reschedule flow ────────────────────────────────────────────────────────
function startRescheduleMode(bookingId, date, start, end, instructorName, instructorId, isReservedMove, pickupAddress, dropoffAddress) {
  pendingReschedule = {
    bookingId,
    date,
    start,
    end,
    instructorName,
    instructorId,
    isReservedMove: !!isReservedMove,
    pickupAddress: pickupAddress || '',
    dropoffAddress: dropoffAddress || ''
  };
  const dateStr = new Date(date + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
  document.getElementById('rescheduleBannerText').textContent = `${dateStr} at ${start} with ${instructorName}`;
  document.getElementById('rescheduleBanner').style.display = 'flex';
  renderLessonLengthControls();
  renderSelectedSlotSummary();
  showToast(isReservedMove ? 'Select an available replacement for your reserved lesson' : 'Select a new time slot below to reschedule your lesson', '');
}
window.startRescheduleMode = startRescheduleMode;

function cancelRescheduleMode() {
  pendingReschedule = null;
  document.getElementById('rescheduleBanner').style.display = 'none';
  renderLessonLengthControls();
  renderSelectedSlotSummary();
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
  const title = document.querySelector('#rescheduleModal h2');
  const note = document.querySelector('#rescheduleModal .modal-credit-note');
  if (title) title.textContent = pendingReschedule.isReservedMove ? 'Move reserved lesson?' : 'Reschedule lesson?';
  if (note) {
    note.textContent = pendingReschedule.isReservedMove
      ? 'No balance change. This moves one Reserved Weekly Slot occurrence and releases the old weekly slot.'
      : 'No balance change - your lesson is simply being moved to the new time.';
  }
  const locationFields = document.getElementById('rescheduleLocationFields');
  if (locationFields) locationFields.style.display = pendingReschedule.isReservedMove ? 'none' : 'block';
  const pickupMode = document.getElementById('rmPickupMode');
  if (pickupMode) pickupMode.value = pendingReschedule.pickupAddress ? 'current' : (learnerProfile.pickup_address ? 'home' : '');
  const dropoffMode = document.getElementById('rmDropoffMode');
  if (dropoffMode) dropoffMode.value = pendingReschedule.dropoffAddress ? 'current' : 'same';
  syncRescheduleLocationControls();
  document.getElementById('rescheduleBtnLabel').textContent = pendingReschedule.isReservedMove ? 'Move reserved lesson' : 'Move lesson';
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
  const isReservedMove = !!pendingReschedule?.isReservedMove;
  btn.disabled = true;
  document.getElementById('rescheduleBtnLabel').textContent = 'Moving…';
  document.getElementById('rescheduleSpinner').style.display = 'block';

  try {
    const action = isReservedMove ? 'reserved-policy-move' : 'reschedule';
    const body = {
      booking_id: pendingReschedule.bookingId,
      new_date: newSlot.date,
      new_start_time: newSlot.start_time
    };
    if (!isReservedMove) {
      const pickupAddress = resolveReschedulePickupAddress();
      const dropoffAddress = resolveRescheduleDropoffAddress();
      if (!pickupAddress) throw new Error('Please add a pickup address in your profile before rescheduling.');
      body.pickup_address = pickupAddress;
      body.dropoff_address = dropoffAddress;
    }
    const res = await ccAuth.fetchAuthed('/api/slots?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error);

    closeRescheduleModal();
    cancelRescheduleMode();
    showToast(data.message || (isReservedMove ? 'Reserved lesson moved successfully!' : 'Lesson rescheduled successfully!'), 'success');
    loadedRanges = []; slotCache = {};
    selectedDate = null;
    clearSelectedSlot();
    await Promise.all([loadUpcoming(), initFeed()]);
  } catch (err) {
    showToast(err.message || 'Reschedule failed.', 'error');
    btn.disabled = false;
    document.getElementById('rescheduleBtnLabel').textContent = isReservedMove ? 'Move reserved lesson' : 'Move lesson';
    document.getElementById('rescheduleSpinner').style.display = 'none';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDaysLocal(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function apiWindowMaxDateLocal() {
  const now = new Date();
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + feedMaxDays());
}
function clampToApiWindow(d) {
  const maxDate = apiWindowMaxDateLocal();
  return d > maxDate ? maxDate : d;
}
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

// ─── Boot ────────────────────────────────────────────────────────────────────
init();


// ── CSP-friendly event delegation for dynamically rendered handlers ──
document.addEventListener('click', function (e) {
  var target = e.target.closest('[data-action]');
  if (!target) return;
  var action = target.dataset.action;
  if (action === 'open-book-modal') {
    openBookModal(target);
  } else if (action === 'select-slot') {
    selectSlotFromButton(target);
  } else if (action === 'continue-selected-slot') {
    continueSelectedSlot();
  } else if (action === 'select-lesson-type') {
    selectLessonType(target.dataset.lessonTypeId);
  } else if (action === 'select-test-date-start') {
    selectedTestDateStart = target.dataset.start || null;
    renderTestDatePanel();
  } else if (action === 'select-date') {
    selectDate(target.dataset.date);
  } else if (action === 'expand-date-grid') {
    dateGridExpanded = true;
    renderFeed();
  } else if (action === 'set-repeat-weeks') {
    setRepeatWeeks(target.dataset.repeatWeeks);
  } else if (action === 'withdraw-request') {
    withdrawRequestFromCard(target.dataset.requestId, target);
  }
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
  var guestPickup = document.getElementById('mdGuestPickup');
  if (guestPickup) guestPickup.addEventListener('change', function () { scheduleLocationDurationCheck(true); });
  var pickupMode = document.getElementById('mdPickupMode');
  if (pickupMode) pickupMode.addEventListener('change', function () {
    syncBookingLocationControls(false);
    scheduleLocationDurationCheck(false);
  });
  var profilePickup = document.getElementById('mdProfilePickup');
  if (profilePickup) profilePickup.addEventListener('change', function () { scheduleLocationDurationCheck(false); });
  var dropoffMode = document.getElementById('mdDropoffMode');
  if (dropoffMode) dropoffMode.addEventListener('change', function () { syncBookingLocationControls(!auth); });
  var rmPickupMode = document.getElementById('rmPickupMode');
  if (rmPickupMode) rmPickupMode.addEventListener('change', syncRescheduleLocationControls);
  var rmDropoffMode = document.getElementById('rmDropoffMode');
  if (rmDropoffMode) rmDropoffMode.addEventListener('change', syncRescheduleLocationControls);
  var guestTerms = document.getElementById('mdGuestTerms');
  if (guestTerms) guestTerms.addEventListener('change', function () { clearFieldError(guestTerms); });
  var repeatToggle = document.getElementById('repeatToggle');
  if (repeatToggle) repeatToggle.addEventListener('change', toggleRepeatOptions);
  var repeatWeeks = document.getElementById('repeatWeeksSelect');
  if (repeatWeeks) repeatWeeks.addEventListener('change', function () { syncRepeatCountButtons(); updateRepeatDates(); });
  var cancelSeries = document.getElementById('cancelSeriesCheck');
  if (cancelSeries) cancelSeries.addEventListener('change', toggleCancelSeriesInfo);
  var cancelAck = document.getElementById('cancelAckCheck');
  if (cancelAck) cancelAck.addEventListener('change', toggleCancelBtn);
  var rescheduleModalClose = document.getElementById('rescheduleModalCancelBtn');
  if (rescheduleModalClose) rescheduleModalClose.addEventListener('click', closeRescheduleModal);
})();

})();
