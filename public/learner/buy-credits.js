(function () {
  'use strict';

  // Bulk credit pricing — fetched from /api/credits?action=bulk-pricing on load.
  // The server-side handleCheckout uses the SAME source (api/_pricing-helpers.js
  // calcBulkTotal), so what's displayed here will be exactly what Stripe charges.
  // Defaults below are placeholders only, used briefly before the fetch resolves
  // (and as a last-resort fallback if the endpoint is unreachable).
  var PRICE_PER_HOUR_PENCE = 5500;
  var DISCOUNT_TIERS = [];   // sorted DESCENDING by min_hours; first match wins
  var MAX_HOURS = 36;

  // Fixed package quantities offered on the page. Discount % is computed
  // from DISCOUNT_TIERS at render time, so the page reflects whatever the
  // school admin has configured.
  var PACKAGE_HOURS = [1.5, 12, 24, 36];

  function getDiscountPct(hours) {
    if (!DISCOUNT_TIERS.length) return 0;
    var tier = DISCOUNT_TIERS.find(function (t) { return hours >= t.min_hours; });
    return tier ? tier.discount_pct : 0;
  }

  function calcTotal(hours) {
    var full = Math.round(PRICE_PER_HOUR_PENCE * hours);
    var pct = getDiscountPct(hours);
    var saving = Math.round(full * pct / 100);
    return { full: full, pct: pct, saving: saving, total: full - saving };
  }

  function fmt(pence) {
    var pounds = (pence / 100).toFixed(2);
    return pence >= 100000 ? '\u00A3' + Number(pounds).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '\u00A3' + pounds;
  }

  var isAuthed = false;
  var qty = 12;
  var params = new URLSearchParams(window.location.search);
  var instructors = [];
  var checkoutBusy = false;
  var currentInstructorId = parseInt(params.get('instructor_id'), 10);
  if (!Number.isInteger(currentInstructorId) || currentInstructorId <= 0) {
    currentInstructorId = null;
  }

  function selectedInstructor() {
    if (!currentInstructorId) return null;
    return instructors.find(function (inst) { return Number(inst.id) === Number(currentInstructorId); }) || null;
  }

  function selectedInstructorName() {
    var inst = selectedInstructor();
    return inst ? inst.name : '';
  }

  function buyCreditsPath() {
    var path = '/learner/buy-credits.html';
    if (currentInstructorId) path += '?instructor_id=' + encodeURIComponent(currentInstructorId);
    return path;
  }

  function checkoutIsAllowed() {
    return !!currentInstructorId && !checkoutBusy;
  }

  function updateCheckoutAvailability() {
    var allowed = checkoutIsAllowed();
    var checkoutBtn = document.getElementById('btnCheckout');
    if (checkoutBtn) checkoutBtn.disabled = !allowed;
    document.querySelectorAll('.sl-buy-btn').forEach(function (btn) {
      btn.disabled = !allowed;
    });

    var help = document.getElementById('instructorHelp');
    if (help) {
      var name = selectedInstructorName();
      help.textContent = name
        ? 'Hours bought here will be held with ' + name + '.'
        : 'Choose an instructor before checkout. Hours are held against that instructor.';
    }
  }

  function requireInstructorSelection() {
    if (currentInstructorId) return true;
    showToast('Choose an instructor before checkout.', 'error');
    updateCheckoutAvailability();
    return false;
  }

  function initAuth() {
    // Spectator mode: prices and pricing tiers are public — only the buy
    // buttons gate on auth (existing requireAuth() calls below). The balance
    // card is hidden for guests and replaced with a "sign in to see balance"
    // hint, set up in initGuestUI().
    isAuthed = !!ccAuth.getAuth();
    return isAuthed;
  }

  function initGuestUI() {
    if (isAuthed) return;
    // Hide the personal balance card; show a sign-in hint banner in its place.
    var balanceCard = document.querySelector('.balance-card');
    if (balanceCard) balanceCard.style.display = 'none';
    var subtitle = document.querySelector('.subtitle');
    var redirect = encodeURIComponent(buyCreditsPath());
    if (subtitle) {
      subtitle.innerHTML = 'Browse our pricing — '
        + '<a href="/learner/login.html?redirect=' + redirect + '" style="color:var(--accent);font-weight:700">sign in</a>'
        + ' or '
        + '<a href="/free-trial.html" style="color:var(--accent);font-weight:700">try a free lesson</a>'
        + ' first.';
    }
  }

  async function loadBalance() {
    try {
      var url = '/api/credits?action=balance';
      if (currentInstructorId) url += '&instructor_id=' + encodeURIComponent(currentInstructorId);
      var res = await ccAuth.fetchAuthed(url);
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load balance');

      var mins = currentInstructorId && data.selected_instructor_balance_minutes != null
        ? data.selected_instructor_balance_minutes
        : (data.balance_minutes != null ? data.balance_minutes : (data.credit_balance || 0) * 90);
      var hrs = (mins / 60);
      var hrsStr = hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
      var label = document.getElementById('balanceLabel');
      if (label) label.textContent = selectedInstructorName() ? 'Hours with ' + selectedInstructorName() : 'Hours on account';
      document.getElementById('balanceValue').textContent = hrsStr;
      document.getElementById('balanceUnit').textContent = 'hours';
      if (window.posthog) posthog.capture('credits_page_viewed', { current_balance_hours: hrs, instructor_id: currentInstructorId || null });
    } catch (err) {
      document.getElementById('balanceValue').textContent = '?';
    }
  }

  var lessonTypes = [];

  // Fetch live bulk pricing (hourly rate + tiers). The server-side checkout
  // uses the SAME source, so what's rendered here is exactly what Stripe charges.
  async function loadBulkPricing() {
    try {
      var res = await fetch('/api/credits?action=bulk-pricing&t=' + Date.now());
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
      PRICE_PER_HOUR_PENCE = data.hourly_pence;
      DISCOUNT_TIERS = Array.isArray(data.discount_tiers) ? data.discount_tiers : [];
      MAX_HOURS = data.max_hours || 36;
    } catch (err) {
      console.error('Failed to load bulk pricing, using defaults:', err);
      // Fall through with hardcoded fallbacks — don't break the page if the
      // API is briefly unreachable. The server is the source of truth on
      // checkout regardless, so worst case the user sees stale numbers
      // momentarily before the API call resolves.
    }
  }

  // /api/lesson-types is still loaded for the per-lesson-type "single lesson"
  // shortcut cards (Standard, 2-Hour, etc.). These cards trigger the SAME
  // bulk-credits checkout (api/credits.js), so their displayed price is
  // computed from the bulk hourly rate × duration — NOT from lt.price_pence —
  // to keep page = receipt.
  async function loadLessonTypes() {
    try {
      var res = await ccAuth.fetchAuthed('/api/lesson-types?action=list');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error);
      lessonTypes = (data.lesson_types || []).filter(isPaidLessonType);
    } catch (err) {
      console.error('Failed to load lesson types:', err);
      lessonTypes = [];
    }
  }

  function isPaidLessonType(lt) {
    return !!lt && lt.active !== false && lt.slug !== 'trial';
  }

  async function loadInstructors() {
    var select = document.getElementById('instructorSelect');
    try {
      var res = await fetch('/api/instructors?action=list');
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load instructors');
      instructors = Array.isArray(data.instructors) ? data.instructors : [];

      var selectedExists = instructors.some(function (inst) { return Number(inst.id) === Number(currentInstructorId); });
      if (currentInstructorId && !selectedExists) currentInstructorId = null;

      if (select) {
        select.innerHTML = '';
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select an instructor';
        select.appendChild(placeholder);

        instructors.forEach(function (inst) {
          var opt = document.createElement('option');
          opt.value = String(inst.id);
          opt.textContent = inst.name;
          opt.selected = Number(inst.id) === Number(currentInstructorId);
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('Failed to load instructors:', err);
      instructors = [];
      currentInstructorId = null;
      if (select) select.innerHTML = '<option value="">Could not load instructors</option>';
    } finally {
      updateCheckoutAvailability();
    }
  }

  function renderPackageCards() {
    var container = document.getElementById('packages');
    var singleLink = document.getElementById('singleLessonLink');
    if (!container) return;
    var pkgs = PACKAGE_HOURS.filter(function (h) { return h >= 6; });
    container.innerHTML = pkgs.map(function (h) {
      var totals = calcTotal(h);
      var perHr = Math.round(PRICE_PER_HOUR_PENCE * (1 - totals.pct / 100));
      var isPopular = h === 12;
      var savePill = totals.pct > 0 ? '<span class="pkg-save">Save ' + totals.pct + '%</span>' : '';
      return '<div class="pkg-card' + (qty === h ? ' active' : '') + '" data-action="select-pkg" data-qty="' + h + '">' +
        (isPopular ? '<div class="popular-badge">Most popular</div>' : '') +
        '<div class="pkg-left">' +
        '<div class="pkg-title">' + h + ' hours ' + savePill + '</div>' +
        '<div class="pkg-detail">' + fmt(perHr) + '/hr</div>' +
        '</div>' +
        '<div class="pkg-right">' +
        '<div class="pkg-price">' + fmt(totals.total) + '</div>' +
        (totals.pct > 0 ? '<div class="pkg-was">' + fmt(totals.full) + '</div>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    if (singleLink) {
      var singleTotal = calcTotal(1.5).total;
      singleLink.innerHTML = '<button class="single-lesson-link" data-action="select-pkg" data-qty="1.5">Just need 1.5 hours? ' + fmt(singleTotal) + '</button>';
    }
  }

  function renderSingleLessonCards() {
    var section = document.getElementById('singleLessonsSection');
    var grid = document.getElementById('singleLessonsGrid');
    var divider = document.getElementById('packagesDivider');
    if (!grid || lessonTypes.length === 0) return;

    grid.innerHTML = lessonTypes.map(function (lt) {
      var hrs = lt.duration_minutes / 60;
      var hrsStr = hrs % 1 === 0 ? (hrs + ' hr' + (hrs !== 1 ? 's' : '')) : (hrs.toFixed(1) + ' hrs');
      // Compute display price from bulk hourly × duration — single-lesson
      // cards trigger the bulk-credits checkout, NOT a lesson-type purchase.
      // Using lt.price_pence here would silently mismatch what Stripe charges.
      var displayPence = Math.round(PRICE_PER_HOUR_PENCE * hrs);
      var price = fmt(displayPence);
      var colour = lt.colour || '#f58321';
      return '<div class="single-lesson-card" style="--lt-colour: ' + colour + '">' +
        '<div class="sl-name">' + lt.name + '</div>' +
        '<div class="sl-duration">' + hrsStr + '</div>' +
        '<div class="sl-price">' + price + '</div>' +
        '<button class="sl-buy-btn" style="background: ' + (lt.colour || 'var(--accent)') + '" data-action="buy-single" data-lesson-type-id="' + lt.id + '">Buy</button>' +
        '</div>';
    }).join('');

    section.style.display = 'block';
    divider.style.display = 'flex';
  }

  async function buySingleLesson(lessonTypeId, btn) {
    if (window.ccAuth && !window.ccAuth.requireAuth()) return;
    if (!requireInstructorSelection()) return;

    var lt = lessonTypes.find(function (t) { return t.id === lessonTypeId; });
    if (!lt) return;
    if (!isPaidLessonType(lt)) {
      showToast('Free trials are booked from the free trial page.', 'error');
      return;
    }

    var origText = btn.textContent;
    checkoutBusy = true;
    btn.disabled = true;
    btn.textContent = 'Loading\u2026';

    try {
      var hours = lt.duration_minutes / 60;
      var payload = { hours: hours, instructor_id: currentInstructorId };
      var res = await ccAuth.fetchAuthed('/api/credits?action=checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      window.location.href = data.url;
    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.', 'error');
      checkoutBusy = false;
      btn.disabled = false;
      btn.textContent = origText;
      updateCheckoutAvailability();
    }
  }

  function selectPkg(newQty) {
    qty = newQty;

    document.querySelectorAll('.pkg-card').forEach(function (card) {
      card.classList.toggle('active', parseFloat(card.dataset.qty) === qty);
    });

    var totals = calcTotal(qty);
    var hrsLabel = qty === 1 ? '1 hour' : (qty + ' hours');

    document.getElementById('summaryLine').textContent = hrsLabel + ' \u00D7 ' + fmt(PRICE_PER_HOUR_PENCE) + '/hr';
    document.getElementById('summarySubtotal').textContent = fmt(totals.full);

    var discountRow = document.getElementById('discountRow');
    if (totals.pct > 0) {
      discountRow.style.display = 'flex';
      document.getElementById('discountLabel').textContent = totals.pct + '% package discount';
      document.getElementById('discountValue').textContent = '\u2212' + fmt(totals.saving);
    } else {
      discountRow.style.display = 'none';
    }

    document.getElementById('totalValue').textContent = fmt(totals.total);
    document.getElementById('btnLabel').textContent = 'Buy ' + hrsLabel + ' \u2014 ' + fmt(totals.total);
    updateCheckoutAvailability();
  }

  // Event delegation for dynamically rendered pkg-card / buy-single buttons
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    if (action === 'select-pkg') {
      var q = parseFloat(target.dataset.qty);
      if (!isNaN(q)) selectPkg(q);
    } else if (action === 'buy-single') {
      var ltId = parseInt(target.dataset.lessonTypeId, 10);
      buySingleLesson(ltId, target);
    }
  });

  document.getElementById('btnCheckout').addEventListener('click', async function () {
    if (window.ccAuth && !window.ccAuth.requireAuth()) return;
    if (!requireInstructorSelection()) return;
    var btn = document.getElementById('btnCheckout');
    var label = document.getElementById('btnLabel');
    var spinner = document.getElementById('btnSpinner');

    checkoutBusy = true;
    btn.disabled = true;
    label.textContent = 'Redirecting to Stripe\u2026';
    spinner.style.display = 'block';
    var totals = calcTotal(qty);
    if (window.posthog) posthog.capture('credits_checkout_initiated', { hours: qty, total_pence: totals.total, instructor_id: currentInstructorId });

    try {
      var payload = { hours: qty, instructor_id: currentInstructorId };
      var res = await ccAuth.fetchAuthed('/api/credits?action=checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');

      window.location.href = data.url;
    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.', 'error');
      checkoutBusy = false;
      btn.disabled = false;
      var t2 = calcTotal(qty);
      var hrsLabel = qty === 1 ? '1 hour' : (qty + ' hours');
      label.textContent = 'Buy ' + hrsLabel + ' \u2014 ' + fmt(t2.total);
      spinner.style.display = 'none';
      updateCheckoutAvailability();
    }
  });

  var instructorSelect = document.getElementById('instructorSelect');
  if (instructorSelect) {
    instructorSelect.addEventListener('change', function () {
      var parsed = parseInt(instructorSelect.value, 10);
      currentInstructorId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      updateCheckoutAvailability();
      if (isAuthed) loadBalance();
    });
  }

  function showToast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  // ── Check for ?cancelled=true ─────────────────────────────────────────────
  if (params.get('cancelled') === 'true') {
    showToast('Payment cancelled — your balance is unchanged.', 'cancelled');
  }

  // ── Test Ready Guarantee price ────────────────────────────────────────────
  async function loadProgrammePrice() {
    try {
      var res = await ccAuth.fetchAuthed('/api/guarantee-price?t=' + Date.now());
      var data = await res.json();

      var price = data.current_price || 1500;
      var base = data.base_price || 1500;
      var cap = data.cap || 3000;

      document.getElementById('programmePrice').textContent = '\u00A3' + price.toLocaleString('en-GB');
      document.getElementById('programmeStartPrice').textContent = '\u00A3' + base.toLocaleString('en-GB');
      document.getElementById('programmeCurrentPrice').textContent = '\u00A3' + price.toLocaleString('en-GB');
      document.getElementById('programmeCapPrice').textContent = '\u00A3' + cap.toLocaleString('en-GB');
      document.getElementById('programmeComparePrice').textContent = '\u00A3' + price.toLocaleString('en-GB');

      var pct = base === cap ? 100 : Math.min(((price - base) / (cap - base)) * 100, 100);
      document.getElementById('programmeProgressFill').style.width = pct + '%';
    } catch (err) {
      console.warn('Could not load programme price:', err);
    }
  }

  initAuth();
  initGuestUI();
  selectPkg(12); // pre-renders summary with placeholder hourly rate

  // Bulk pricing must resolve before package cards / single-lesson cards render,
  // otherwise the page would flash placeholder prices that disagree with the
  // server. Lesson types load in parallel — they're only used for card metadata
  // (name, colour), not for pricing.
  Promise.all([loadBulkPricing(), loadLessonTypes(), loadInstructors()]).then(function () {
    renderPackageCards();
    renderSingleLessonCards();
    selectPkg(qty); // re-render summary now that real prices are loaded
    if (isAuthed) loadBalance();
  });

  loadProgrammePrice();
})();
