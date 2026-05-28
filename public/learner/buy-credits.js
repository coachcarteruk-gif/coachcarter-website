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
  var BULK_TIERS_ENABLED = false;
  var PRICING_LOADED = false;
  var PRICING_ERROR = '';
  var pricingRequestSeq = 0;

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

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHtml(id, value) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function setDisplay(id, value) {
    var el = document.getElementById(id);
    if (el) el.style.display = value;
  }

  function resetPricingState() {
    PRICING_LOADED = false;
    PRICE_PER_HOUR_PENCE = 0;
    DISCOUNT_TIERS = [];
    MAX_HOURS = 36;
    BULK_TIERS_ENABLED = false;
    PRICING_ERROR = '';
  }

  function buyCreditsPath() {
    var path = '/learner/buy-credits.html';
    if (currentInstructorId) path += '?instructor_id=' + encodeURIComponent(currentInstructorId);
    return path;
  }

  function checkoutIsAllowed() {
    return !!currentInstructorId && PRICING_LOADED && !checkoutBusy;
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

  function renderSelectedPricingState() {
    var name = selectedInstructorName();
    var guestLinks = ' <a href="/learner/login.html?redirect=' + encodeURIComponent(buyCreditsPath()) + '" style="color:var(--accent);font-weight:700">Sign in</a> to buy or view your balance.';
    if (!name) {
      setText('creditsTitle', 'Choose an instructor.');
      if (isAuthed) {
        setText('creditsSubtitle', 'Select an instructor to see their current hourly rate and available credit packages.');
      } else {
        setHtml('creditsSubtitle', 'Select an instructor to see their current hourly rate and available credit packages.' + guestLinks);
      }
      setText('balanceLabel', 'Hours with selected instructor');
      setText('pricingRateValue', 'Choose instructor');
      setText('packagesLabel', 'Choose an instructor');
      setText('packagesNote', 'Credit pricing appears after you choose an instructor.');
      setText('packagesDividerText', 'Or choose hour packages');
      setDisplay('priceSummary', 'none');
      setText('btnLabel', 'Choose an instructor');
      return;
    }

    setText('creditsTitle', 'Credits for ' + name);
    if (isAuthed) {
      setText('creditsSubtitle', 'Prices below use ' + name + '\'s current server-side hourly rate.');
    } else {
      setHtml('creditsSubtitle', 'Prices below use ' + escapeHtml(name) + '\'s current server-side hourly rate.' + guestLinks);
    }
    setText('balanceLabel', 'Hours with ' + name);
    setText('pricingRateValue', PRICING_LOADED ? fmt(PRICE_PER_HOUR_PENCE) + '/hr' : 'Loading...');
    setDisplay('priceSummary', PRICING_LOADED ? 'block' : 'none');

    if (!PRICING_LOADED) {
      setText('packagesLabel', 'Loading pricing');
      setText('packagesNote', PRICING_ERROR || 'Fetching the latest instructor pricing.');
      setText('btnLabel', PRICING_ERROR ? 'Pricing unavailable' : 'Loading pricing...');
      return;
    }

    if (BULK_TIERS_ENABLED) {
      setText('packagesLabel', 'Choose a package');
      setText('packagesNote', 'Bulk discounts are available for ' + name + ' and are calculated from their hourly rate.');
      setText('packagesDividerText', 'Or save with hour packages');
    } else {
      setText('packagesLabel', 'Choose hours');
      setText('packagesNote', name + ' does not currently offer bulk discounts. Every option is priced at ' + fmt(PRICE_PER_HOUR_PENCE) + '/hr.');
      setText('packagesDividerText', 'Or choose more hours');
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

  function renderNeutralBalance() {
    setText('balanceLabel', 'Hours with selected instructor');
    setText('balanceValue', '-');
    setText('balanceUnit', 'hours');
  }

  async function loadBalance() {
    if (!currentInstructorId) {
      renderNeutralBalance();
      return;
    }
    try {
      var url = '/api/credits?action=balance';
      if (currentInstructorId) url += '&instructor_id=' + encodeURIComponent(currentInstructorId);
      var res = await ccAuth.fetchAuthed(url);
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load balance');

      var mins = data.selected_instructor_balance_minutes != null ? data.selected_instructor_balance_minutes : 0;
      var hrs = (mins / 60);
      var hrsStr = hrs % 1 === 0 ? String(hrs) : hrs.toFixed(1);
      var label = document.getElementById('balanceLabel');
      if (label) label.textContent = 'Hours with ' + selectedInstructorName();
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
    var requestId = ++pricingRequestSeq;
    if (!currentInstructorId) {
      resetPricingState();
      renderSelectedPricingState();
      updateCheckoutAvailability();
      return;
    }

    resetPricingState();
    renderSelectedPricingState();
    updateCheckoutAvailability();

    try {
      var url = '/api/credits?action=bulk-pricing&t=' + Date.now();
      url += '&instructor_id=' + encodeURIComponent(currentInstructorId);
      var res = await fetch(url);
      var data = await res.json();
      if (requestId !== pricingRequestSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
      PRICE_PER_HOUR_PENCE = data.hourly_pence;
      DISCOUNT_TIERS = Array.isArray(data.discount_tiers) ? data.discount_tiers : [];
      MAX_HOURS = data.max_hours || 36;
      BULK_TIERS_ENABLED = data.bulk_tiers_enabled === true;
      PRICING_LOADED = Number.isFinite(PRICE_PER_HOUR_PENCE) && PRICE_PER_HOUR_PENCE > 0;
    } catch (err) {
      if (requestId !== pricingRequestSeq) return;
      console.error('Failed to load instructor pricing:', err);
      resetPricingState();
      PRICING_ERROR = 'Could not load pricing for this instructor. Please choose another instructor or try again.';
    } finally {
      if (requestId === pricingRequestSeq) {
        renderSelectedPricingState();
        updateCheckoutAvailability();
      }
    }
  }

  // /api/lesson-types is still loaded for the per-lesson-type "single lesson"
  // shortcut cards (Standard, 2-Hour, etc.). These cards trigger the SAME
  // bulk-credits checkout (api/credits.js), so their displayed price is
  // computed from the bulk hourly rate × duration — NOT from lt.price_pence —
  // to keep page = receipt.
  async function loadLessonTypes() {
    if (!currentInstructorId) {
      lessonTypes = [];
      return;
    }
    try {
      var res = await ccAuth.fetchAuthed('/api/lesson-types?action=list&instructor_id=' + encodeURIComponent(currentInstructorId));
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
      renderSelectedPricingState();
      updateCheckoutAvailability();
    }
  }

  function renderPackageCards() {
    var container = document.getElementById('packages');
    var singleLink = document.getElementById('singleLessonLink');
    if (!container) return;

    if (!currentInstructorId || !PRICING_LOADED) {
      container.innerHTML = '<div class="pkg-card" aria-disabled="true">' +
        '<div class="pkg-left">' +
        '<div class="pkg-title">' + (PRICING_ERROR ? 'Pricing unavailable' : (currentInstructorId ? 'Loading pricing' : 'Choose an instructor')) + '</div>' +
        '<div class="pkg-detail">' + (PRICING_ERROR || (currentInstructorId ? 'Fetching the latest hourly rate' : 'Prices appear after selection')) + '</div>' +
        '</div>' +
        '</div>';
      if (singleLink) singleLink.innerHTML = '';
      return;
    }

    var pkgs = PACKAGE_HOURS.filter(function (h) { return h >= 6 && h <= MAX_HOURS; });
    container.innerHTML = pkgs.map(function (h) {
      var totals = calcTotal(h);
      var perHr = Math.round(PRICE_PER_HOUR_PENCE * (1 - totals.pct / 100));
      var isPopular = BULK_TIERS_ENABLED && h === 12;
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
    if (!grid) return;
    if (!currentInstructorId || !PRICING_LOADED || lessonTypes.length === 0) {
      grid.innerHTML = '';
      if (section) section.style.display = 'none';
      if (divider) divider.style.display = 'none';
      return;
    }

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
    renderSelectedPricingState();

    if (!currentInstructorId || !PRICING_LOADED) {
      updateCheckoutAvailability();
      return;
    }

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
    instructorSelect.addEventListener('change', async function () {
      var parsed = parseInt(instructorSelect.value, 10);
      currentInstructorId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      updateCheckoutAvailability();
      await loadBulkPricing();
      await loadLessonTypes();
      renderPackageCards();
      renderSingleLessonCards();
      selectPkg(qty);
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

  // Bulk pricing and instructor-scoped lesson types must resolve before package
  // cards render, otherwise the page could show prices or lesson cards that do
  // not match the selected instructor.
  loadInstructors().then(function () {
    return loadLessonTypes();
  }).then(function () {
    return loadBulkPricing();
  }).then(function () {
    renderPackageCards();
    renderSingleLessonCards();
    selectPkg(qty); // re-render summary now that real prices are loaded
    if (isAuthed) loadBalance();
  });

  loadProgrammePrice();
})();
