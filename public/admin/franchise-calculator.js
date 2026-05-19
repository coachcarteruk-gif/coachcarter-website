(function () {
  'use strict';

  // Auth gate — redirect to admin login if not authed.
  // Skipped on localhost / preview hosts so the calculator works for design review.
  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host === '';
  if (!isLocal) {
    var hasAdmin = !!localStorage.getItem('cc_admin');
    var hasInstructor = (document.cookie || '').indexOf('cc_instructor=') !== -1;
    if (!hasAdmin && !hasInstructor) {
      window.location.href = '/admin/login.html?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
  }

  var $ = function (id) { return document.getElementById(id); };
  var WEEKS_PER_YEAR = 50;

  function fmt(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '£' + Math.abs(Math.round(n)).toLocaleString('en-GB');
  }
  function num(el) {
    var v = parseFloat(el.value);
    return isNaN(v) ? 0 : v;
  }

  // Compute one column. Returns object with everything we need to render + the take-home figure.
  function computeColumn(prefix) {
    var lessonsWk    = num($(prefix + '_lessonsWk'));
    var avgPrice     = num($(prefix + '_avgPrice'));
    var adminHrs     = num($(prefix + '_adminHrs'));
    var baseFee      = num($(prefix + '_franchiseFee'));

    // CoachCarter-only toggles. Adjust the franchise fee before any downstream maths.
    var wrapAdj = 0, dashcamAdj = 0;
    var wrappedEl = $(prefix + '_wrapped');
    var dashcamEl = $(prefix + '_dashcam');
    if (wrappedEl) wrapAdj = wrappedEl.checked ? 0 : 25;       // +£25/wk if NOT wrapped
    if (dashcamEl) dashcamAdj = dashcamEl.checked ? -30 : 0;   // −£30/wk if dash cam fitted

    var franchiseWk = baseFee + wrapAdj + dashcamAdj;
    if (franchiseWk < 0) franchiseWk = 0;
    var insuranceWk  = num($(prefix + '_insurance'));
    var maintWk      = num($(prefix + '_maintenance'));
    var perHourCut   = num($(prefix + '_perHourCut'));
    var cutCapWk     = num($(prefix + '_cutCap'));
    var grossWeek = lessonsWk * avgPrice;
    var grossYear = grossWeek * WEEKS_PER_YEAR;

    // Franchise fee capped at weekly gross
    var feeEffective = Math.min(franchiseWk, grossWeek);
    var feeAnnual    = feeEffective * WEEKS_PER_YEAR;

    var insuranceAnnual = insuranceWk * WEEKS_PER_YEAR;
    var maintAnnual     = maintWk * WEEKS_PER_YEAR;
    // Admin time costed at the lesson price (hourly opportunity cost)
    var adminAnnual     = adminHrs * avgPrice * WEEKS_PER_YEAR;
    // Per-hour cut: £X taken from each teaching hour, capped at cutCapWk if set (0 = no cap)
    var perHourCutWeekly = perHourCut * lessonsWk;
    if (cutCapWk > 0 && perHourCutWeekly > cutCapWk) {
      perHourCutWeekly = cutCapWk;
    }
    var perHourCutAnnual = perHourCutWeekly * WEEKS_PER_YEAR;

    var takeHome = grossYear - feeAnnual - insuranceAnnual - maintAnnual - adminAnnual - perHourCutAnnual;

    return {
      lessonsWk: lessonsWk,
      avgPrice: avgPrice,
      adminHrs: adminHrs,
      grossWeek: grossWeek,
      grossYear: grossYear,
      feeAnnual: feeAnnual,
      feeEffective: feeEffective,
      franchiseWk: franchiseWk,
      insuranceAnnual: insuranceAnnual,
      maintAnnual: maintAnnual,
      adminAnnual: adminAnnual,
      perHourCut: perHourCut,
      perHourCutAnnual: perHourCutAnnual,
      cutCapWk: cutCapWk,
      cutCapHit: cutCapWk > 0 && (perHourCut * lessonsWk) > cutCapWk,
      takeHome: takeHome
    };
  }

  function renderColumn(prefix, c) {
    $(prefix + '_grossAmt').textContent  = fmt(c.grossYear);
    $(prefix + '_feeAmt').textContent    = '−' + fmt(c.feeAnnual);
    $(prefix + '_insAmt').textContent    = '−' + fmt(c.insuranceAnnual);
    $(prefix + '_maintAmt').textContent  = '−' + fmt(c.maintAnnual);
    $(prefix + '_adminAmt').textContent  = '−' + fmt(c.adminAnnual);
    $(prefix + '_adminDetail').textContent = c.adminHrs + ' hrs/wk × ' + fmt(c.avgPrice) + '/hr × ' + WEEKS_PER_YEAR;

    $(prefix + '_cutAmt').textContent    = '−' + fmt(c.perHourCutAnnual);
    if (c.cutCapHit) {
      $(prefix + '_cutDetail').textContent = 'Capped at ' + fmt(c.cutCapWk) + '/wk × ' + WEEKS_PER_YEAR + ' (would be ' + fmt(c.perHourCut * c.lessonsWk) + '/wk uncapped)';
    } else {
      $(prefix + '_cutDetail').textContent = fmt(c.perHourCut) + ' × ' + c.lessonsWk + ' hrs/wk × ' + WEEKS_PER_YEAR;
    }

    $(prefix + '_takeHome').textContent  = fmt(c.takeHome);
  }

  function recalc() {
    var red = computeColumn('red');
    var cc  = computeColumn('cc');

    renderColumn('red', red);
    renderColumn('cc',  cc);

    // CC-only: live effective weekly fee under the toggles
    var effEl = $('cc_effectiveFee');
    if (effEl) effEl.textContent = fmt(cc.feeEffective) + '/wk';

    // CC-only: per-toggle £ adjustment labels
    var wrappedEl = $('cc_wrapped');
    var dashcamEl = $('cc_dashcam');
    var wrappedAdjEl = $('cc_wrappedAdj');
    var dashcamAdjEl = $('cc_dashcamAdj');
    if (wrappedEl && wrappedAdjEl) {
      wrappedAdjEl.textContent = wrappedEl.checked ? '+£0/wk' : '+£25/wk';
    }
    if (dashcamEl && dashcamAdjEl) {
      dashcamAdjEl.textContent = dashcamEl.checked ? '−£30/wk' : '−£0/wk';
    }

    // Headline strip — gross shown is RED's gross (acts as the baseline; CC may differ)
    // Show both grosses if they differ
    var grossText;
    if (Math.round(red.grossYear) === Math.round(cc.grossYear)) {
      grossText = fmt(red.grossYear);
    } else {
      grossText = fmt(red.grossYear) + ' / ' + fmt(cc.grossYear);
    }
    $('grossYearAmt').textContent = grossText;
    $('grossDetail').textContent =
      'RED: ' + red.lessonsWk + ' × ' + fmt(red.avgPrice) +
      '  ·  CC: ' + cc.lessonsWk + ' × ' + fmt(cc.avgPrice);

    // Headline delta
    var delta = cc.takeHome - red.takeHome;
    var headline = $('headlineValue');
    headline.textContent = (delta >= 0 ? '+' : '−') + '£' + Math.abs(Math.round(delta)).toLocaleString('en-GB');
    headline.classList.toggle('positive', delta >= 0);
    headline.classList.toggle('negative', delta < 0);

    var verdict = $('headlineVerdict');
    if (red.takeHome <= 0 && cc.takeHome <= 0) {
      verdict.textContent = 'Both columns lose money — sense-check the inputs.';
    } else if (delta > Math.abs(red.takeHome) * 0.25) {
      verdict.textContent = 'Strong CoachCarter advantage on cash alone — before counting the platform, AI tools, or brand.';
    } else if (delta > 0) {
      verdict.textContent = 'CoachCarter edges ahead on cash. The non-cash side (platform, funnel, support) widens the gap.';
    } else if (delta > -Math.abs(red.takeHome) * 0.05) {
      verdict.textContent = 'Roughly level on cash. The case sits in the platform features and brand.';
    } else {
      verdict.textContent = 'RED comes out ahead on these inputs. Worth pressure-testing the assumptions on either side.';
    }
  }

  // Wire up every input on both columns
  document.querySelectorAll('input[type="number"]').forEach(function (el) {
    el.addEventListener('input', recalc);
  });

  // Toggles on the CC column — re-run calc and refresh Yes/No labels
  function syncToggleLabel(checkboxId, labelId) {
    var cb = $(checkboxId);
    var lbl = $(labelId);
    if (!cb || !lbl) return;
    var update = function () { lbl.textContent = cb.checked ? 'Yes' : 'No'; };
    cb.addEventListener('change', function () { update(); recalc(); });
    update();
  }
  syncToggleLabel('cc_wrapped', 'cc_wrappedLabel');
  syncToggleLabel('cc_dashcam', 'cc_dashcamLabel');

  recalc();
})();
