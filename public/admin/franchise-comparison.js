(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var WEEKS_PER_YEAR = 52;

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

    // CoachCarter-only toggles. Both are discounts now: applied (negative) only when ON.
    var wrapAdj = 0, dashcamAdj = 0;
    var wrappedEl = $(prefix + '_wrapped');
    var dashcamEl = $(prefix + '_dashcam');
    if (wrappedEl) wrapAdj    = wrappedEl.checked ? -25 : 0;
    if (dashcamEl) dashcamAdj = dashcamEl.checked ? -30 : 0;

    var insuranceWk  = num($(prefix + '_insurance'));
    var maintWk      = num($(prefix + '_maintenance'));
    var perHourCut   = num($(prefix + '_perHourCut'));
    var cutCapWk     = num($(prefix + '_cutCap'));
    var guaranteeCount = num($(prefix + '_guaranteeCount'));
    var guaranteeComp  = num($(prefix + '_guaranteeComp'));
    var guaranteeWeeks = num($(prefix + '_guaranteeWeeks'));

    var grossWeek = lessonsWk * avgPrice;
    var grossYear = grossWeek * WEEKS_PER_YEAR;

    // ── Franchise fee, broken into base + adjustments ──
    var baseAnnual         = baseFee * WEEKS_PER_YEAR;
    var wrappedAdjAnnual   = wrapAdj * WEEKS_PER_YEAR;        // +£ if NOT wrapped (cost)
    var dashcamAdjAnnual   = dashcamAdj * WEEKS_PER_YEAR;     // −£ if dashcam (saving)

    // Learner guarantee: weeks missed �- weekly compensation. Saves the instructor money.
    var weeksMet      = Math.min(Math.max(guaranteeWeeks, 0), WEEKS_PER_YEAR);
    var weeksMissed   = WEEKS_PER_YEAR - weeksMet;
    var guaranteeAnnual = weeksMissed * guaranteeComp;        // saving (subtracts from fee)

    // Net franchise fee: base + wrap adjustment + dashcam adjustment − guarantee savings.
    // Floored at 0 (instructor never billed less than zero), capped at gross (never goes negative).
    var netFeeAnnual = baseAnnual + wrappedAdjAnnual + dashcamAdjAnnual - guaranteeAnnual;
    if (netFeeAnnual < 0) netFeeAnnual = 0;
    var grossCap = grossYear;
    if (grossCap > 0 && netFeeAnnual > grossCap) netFeeAnnual = grossCap;

    var insuranceAnnual = insuranceWk * WEEKS_PER_YEAR;
    var maintAnnual     = maintWk * WEEKS_PER_YEAR;
    var adminAnnual     = adminHrs * avgPrice * WEEKS_PER_YEAR;

    var perHourCutWeekly = perHourCut * lessonsWk;
    if (cutCapWk > 0 && perHourCutWeekly > cutCapWk) {
      perHourCutWeekly = cutCapWk;
    }
    var perHourCutAnnual = perHourCutWeekly * WEEKS_PER_YEAR;

    var takeHome = grossYear - netFeeAnnual - insuranceAnnual - maintAnnual - adminAnnual - perHourCutAnnual;

    return {
      lessonsWk: lessonsWk,
      avgPrice: avgPrice,
      adminHrs: adminHrs,
      grossWeek: grossWeek,
      grossYear: grossYear,
      baseFee: baseFee,
      baseAnnual: baseAnnual,
      wrappedAdjAnnual: wrappedAdjAnnual,
      dashcamAdjAnnual: dashcamAdjAnnual,
      netFeeAnnual: netFeeAnnual,
      insuranceAnnual: insuranceAnnual,
      maintAnnual: maintAnnual,
      adminAnnual: adminAnnual,
      perHourCut: perHourCut,
      perHourCutAnnual: perHourCutAnnual,
      cutCapWk: cutCapWk,
      cutCapHit: cutCapWk > 0 && (perHourCut * lessonsWk) > cutCapWk,
      guaranteeCount: guaranteeCount,
      guaranteeComp: guaranteeComp,
      weeksMet: weeksMet,
      weeksMissed: weeksMissed,
      guaranteeAnnual: guaranteeAnnual,
      // For headline / live "effective fee" display - base + adjustments, before guarantee
      feeEffective: Math.max(0, baseFee + wrapAdj + dashcamAdj),
      takeHome: takeHome
    };
  }

  function renderColumn(prefix, c) {
    $(prefix + '_grossAmt').textContent  = fmt(c.grossYear);

    // Franchise fee parent (base) + children + net subtotal
    $(prefix + '_feeAmt').textContent    = '−' + fmt(c.baseAnnual);
    $(prefix + '_feeBaseDetail').textContent = fmt(c.baseFee) + '/wk �- ' + WEEKS_PER_YEAR;

    // Branding decals child (CC only). wrappedAdjAnnual is −£ when toggle ON (discount).
    var wrappedDiscountEl = $(prefix + '_wrappedDiscountAmt');
    if (wrappedDiscountEl) {
      if (c.wrappedAdjAnnual === 0) {
        wrappedDiscountEl.textContent = '£0';
        wrappedDiscountEl.className = 'val';
      } else {
        wrappedDiscountEl.textContent = '−' + fmt(Math.abs(c.wrappedAdjAnnual));
        wrappedDiscountEl.className = 'val value';
      }
    }

    // Dash cam child (CC only). dashcamAdjAnnual is −£ when fitted (saving).
    var dashcamDiscountEl = $(prefix + '_dashcamDiscountAmt');
    if (dashcamDiscountEl) {
      if (c.dashcamAdjAnnual === 0) {
        dashcamDiscountEl.textContent = '£0';
        dashcamDiscountEl.className = 'val';
      } else {
        dashcamDiscountEl.textContent = '−' + fmt(Math.abs(c.dashcamAdjAnnual));
        dashcamDiscountEl.className = 'val value';
      }
    }

    // Missed-guarantee savings child (both columns)
    if (c.guaranteeAnnual === 0) {
      $(prefix + '_guaranteeAmt').textContent = '£0';
      $(prefix + '_guaranteeAmt').className = 'val';
    } else {
      $(prefix + '_guaranteeAmt').textContent = '−' + fmt(c.guaranteeAnnual);
      $(prefix + '_guaranteeAmt').className = 'val value';
    }
    $(prefix + '_guaranteeDetail').textContent = c.weeksMissed + ' missed weeks �- ' + fmt(c.guaranteeComp);

    // Net franchise fee subtotal
    $(prefix + '_feeNetAmt').textContent = '−' + fmt(c.netFeeAnnual);

    $(prefix + '_insAmt').textContent    = '−' + fmt(c.insuranceAnnual);
    $(prefix + '_maintAmt').textContent  = '−' + fmt(c.maintAnnual);
    $(prefix + '_adminAmt').textContent  = '−' + fmt(c.adminAnnual);
    $(prefix + '_adminDetail').textContent = c.adminHrs + ' hrs/wk �- ' + fmt(c.avgPrice) + '/hr �- ' + WEEKS_PER_YEAR;

    $(prefix + '_cutAmt').textContent    = '−' + fmt(c.perHourCutAnnual);
    if (c.cutCapHit) {
      $(prefix + '_cutDetail').textContent = 'Capped at ' + fmt(c.cutCapWk) + '/wk �- ' + WEEKS_PER_YEAR + ' (would be ' + fmt(c.perHourCut * c.lessonsWk) + '/wk uncapped)';
    } else {
      $(prefix + '_cutDetail').textContent = fmt(c.perHourCut) + ' �- ' + c.lessonsWk + ' hrs/wk �- ' + WEEKS_PER_YEAR;
    }

    var monthlyEl = $(prefix + '_guaranteeMonthly');
    if (monthlyEl) {
      var monthly = c.guaranteeCount * 4;
      var monthlyStr = (Math.round(monthly * 10) / 10).toString();
      monthlyEl.textContent = '≈ ' + monthlyStr + ' new learners per month';
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

    // CC-only: per-toggle £ adjustment labels - always show the discount available
    var wrappedAdjEl = $('cc_wrappedAdj');
    var dashcamAdjEl = $('cc_dashcamAdj');
    if (wrappedAdjEl) wrappedAdjEl.textContent = '−£25/wk';
    if (dashcamAdjEl) dashcamAdjEl.textContent = '−£30/wk';

    // Headline strip - gross shown is RED's gross (acts as the baseline; CC may differ)
    // Show both grosses if they differ
    var grossText;
    if (Math.round(red.grossYear) === Math.round(cc.grossYear)) {
      grossText = fmt(red.grossYear);
    } else {
      grossText = fmt(red.grossYear) + ' / ' + fmt(cc.grossYear);
    }
    $('grossYearAmt').textContent = grossText;
    $('grossDetail').textContent =
      'RED: ' + red.lessonsWk + ' �- ' + fmt(red.avgPrice) +
      '  ·  CC: ' + cc.lessonsWk + ' �- ' + fmt(cc.avgPrice);

    // Headline delta
    var delta = cc.takeHome - red.takeHome;
    var headline = $('headlineValue');
    headline.textContent = (delta >= 0 ? '+' : '−') + '£' + Math.abs(Math.round(delta)).toLocaleString('en-GB');
    headline.classList.toggle('positive', delta >= 0);
    headline.classList.toggle('negative', delta < 0);

    var verdict = $('headlineVerdict');
    if (red.takeHome <= 0 && cc.takeHome <= 0) {
      verdict.textContent = 'Something looks off - both numbers come out below zero. Worth checking the inputs.';
    } else if (delta > Math.abs(red.takeHome) * 0.25) {
      verdict.textContent = 'A meaningful jump in your annual take-home, before factoring in the platform, brand, or support.';
    } else if (delta > 0) {
      verdict.textContent = 'Slightly more in your pocket each year - and that\'s before the platform, brand, and support are added in.';
    } else if (delta > -Math.abs(red.takeHome) * 0.05) {
      verdict.textContent = 'Roughly level on take-home. The difference comes down to the platform, brand, and support you\'d gain.';
    } else {
      verdict.textContent = 'On these numbers your current setup edges ahead. Worth tweaking the inputs to reflect your real situation.';
    }
  }

  // Wire up every input on both columns
  document.querySelectorAll('input[type="number"]').forEach(function (el) {
    el.addEventListener('input', recalc);
  });

  // Toggles on the CC column - re-run calc and refresh Yes/No labels
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
