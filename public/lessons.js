(function () {
  'use strict';

// CONFIG SYSTEM
let SITE_CONFIG = {};

async function loadConfig() {
  try {
    const res = await fetch('/api/config?t=' + Date.now());
    SITE_CONFIG = await res.json();
    applyConfig();
  } catch (err) {
    console.error('Failed to load config from API, trying file fallback:', err);
    try {
      const res = await fetch('/config.json?t=' + Date.now());
      SITE_CONFIG = await res.json();
      applyConfig();
    } catch (err2) {
      console.error('Config fallback also failed:', err2);
      initWithDefaults();
    }
  }
}

function initWithDefaults() {
  PACKAGES.push(
    { hrs: 10, discount: 0.08, price: 506 },
    { hrs: 20, discount: 0.12, price: 968 },
    { hrs: 30, discount: 0.15, price: 1403 },
    { hrs: 40, discount: 0.18, price: 1804 },
    { hrs: 50, discount: 0.21, price: 2173 }
  );
  renderPackages();
  updatePkg(2);
}

function applyConfig() {
  if (!SITE_CONFIG.pricing || !SITE_CONFIG.content) {
    console.warn('Config missing required sections');
    initWithDefaults();
    return;
  }

  const p = SITE_CONFIG.pricing;
  const c = SITE_CONFIG.content;

  const paygPriceEl = document.getElementById('payg-price-display');
  const paygLessonPrice = p.payg_lesson_price || (p.payg_hourly ? p.payg_hourly * 1.5 : 90);
  if (paygPriceEl) paygPriceEl.textContent = '£' + paygLessonPrice;

  if (c.hero && c.hero.stats) {
    document.getElementById('hero-stat-1-value').textContent = c.hero.stats[0]?.value || '£' + paygLessonPrice;
    document.getElementById('hero-stat-1-label').textContent = c.hero.stats[0]?.label || 'Per 1.5hr lesson';
    document.getElementById('hero-stat-2-value').textContent = c.hero.stats[1]?.value || '15%';
    document.getElementById('hero-stat-2-label').textContent = c.hero.stats[1]?.label || 'Max discount on\nbulk packages';
    document.getElementById('hero-stat-3-value').textContent = c.hero.stats[2]?.value || '£' + p.core_programme.toLocaleString();
    document.getElementById('hero-stat-3-label').textContent = c.hero.stats[2]?.label || 'Full Test Ready Guarantee\nprogramme';
    document.getElementById('hero-stat-4-value').textContent = c.hero.stats[3]?.value || c.business?.programme_duration?.replace(' weeks', 'wk') || '18wk';
    document.getElementById('hero-stat-4-label').textContent = c.hero.stats[3]?.label || 'Structured programme\nto test day';
  }

  // Guarantee elements may not exist (section moved to learner-journey.html)
  const corePriceEl = document.getElementById('core-price-display');
  if (corePriceEl) corePriceEl.textContent = '£' + p.core_programme.toLocaleString();

  const totalCoreEl = document.getElementById('total-core-display');
  if (totalCoreEl) totalCoreEl.textContent = '£' + p.core_programme.toLocaleString();

  const rp = p.retake_price || 349;
  addonPrices = { 1: rp, 2: rp, 3: rp };
  const ap1 = document.getElementById('addon-price-1'); if (ap1) ap1.textContent = '+£' + rp;
  const ap2 = document.getElementById('addon-price-2'); if (ap2) ap2.textContent = '+£' + rp;
  const ap3 = document.getElementById('addon-price-3'); if (ap3) ap3.textContent = '+£' + rp;
  const ta1 = document.getElementById('total-addon-1-display'); if (ta1) ta1.textContent = '£' + rp;
  const ta2 = document.getElementById('total-addon-2-display'); if (ta2) ta2.textContent = '£' + rp;
  const ta3 = document.getElementById('total-addon-3-display'); if (ta3) ta3.textContent = '£' + rp;

  basePrice = p.core_programme;

  if (c.hero) {
    const headlineEl = document.getElementById('hero-headline');
    if (headlineEl && c.hero.headline) {
      headlineEl.innerHTML = c.hero.headline.replace('.', '.<br><em>') + '</em>';
    }
    const subheadEl = document.getElementById('hero-subheadline');
    if (subheadEl && c.hero.subheadline) {
      subheadEl.textContent = c.hero.subheadline;
    }
  }

  if (c.sections) {
    document.getElementById('section-payg-title').textContent = c.sections.payg?.title || 'Pay As You Go';
    document.getElementById('section-payg-subtitle').textContent = c.sections.payg?.subtitle || 'Maximum flexibility.';
    document.getElementById('section-packages-title').textContent = c.sections.packages?.title || 'Bulk Hour Packages';
    document.getElementById('section-packages-subtitle').textContent = c.sections.packages?.subtitle || 'Buy more hours up front and save.';
    const sgt = document.getElementById('section-guarantee-title');
    if (sgt) sgt.textContent = c.sections.guarantee?.title || 'The Test Ready Guarantee';
    const sgs = document.getElementById('section-guarantee-subtitle');
    if (sgs) sgs.textContent = c.sections.guarantee?.subtitle || '18 weeks to your driving licence.';
  }

  if (c.features) {
    const paygFeaturesList = document.getElementById('payg-features-list');
    if (paygFeaturesList && c.features.payg) {
      paygFeaturesList.innerHTML = c.features.payg.map(f => `<li class="payg-feature">${f}</li>`).join('');
    }
    const coreFeaturesList = document.getElementById('core-features-list');
    if (coreFeaturesList && c.features.core) {
      coreFeaturesList.innerHTML = c.features.core.map(f => `<li class="base-feature">${f}</li>`).join('');
    }
  }

  if (c.cta) {
    document.getElementById('nav-cta-primary').textContent = c.cta.primary || 'Book a Lesson';
    document.getElementById('hero-cta').textContent = 'View all options →';
    document.getElementById('btn-payg').textContent = c.cta.payg_button || `Book £${p.payg_hourly} lesson →`;
    document.getElementById('btn-package').textContent = c.cta.package_button || 'Buy this package →';
    const btnGuarantee = document.getElementById('btn-guarantee');
    if (btnGuarantee) btnGuarantee.textContent = c.cta.guarantee_button || 'Continue to Booking →';
    document.getElementById('cta-primary').textContent = c.cta.primary || 'Book a lesson now';
    document.getElementById('cta-secondary').textContent = c.cta.secondary || 'Talk to us first';
  }

  if (c.business) {
    const guaranteeNote = document.getElementById('guarantee-note');
    if (guaranteeNote && c.business.guarantee_note) {
      guaranteeNote.innerHTML = '✓ ' + c.business.guarantee_note;
    }
    const footerText = document.getElementById('footer-text');
    if (footerText && c.business.footer_text) {
      footerText.innerHTML = c.business.footer_text.replace(/(Privacy|Terms)/g, '<a href="#">$1</a>');
    }
    const ctaSecondary = document.getElementById('cta-secondary');
    if (ctaSecondary && c.business.contact_email) {
      ctaSecondary.href = 'mailto:' + c.business.contact_email;
    }
  }

  if (p.bulk_packages && Array.isArray(p.bulk_packages)) {
    PACKAGES.length = 0;
    p.bulk_packages.forEach(pkg => {
      PACKAGES.push({ hrs: pkg.hrs, price: pkg.price, discount: pkg.discount });
    });
    renderPackages();
    updatePkg(currentPkgIndex || 2);
  }

  updateComparisonTable(p);
}

function updateComparisonTable(pricing) {
  // Comparison table removed — function kept as no-op for safety
}

function renderPackages() {
  const grid = document.getElementById('packages-grid');
  if (!grid) return;
  grid.innerHTML = PACKAGES.map((pkg, i) =>
    '<div class="pkg-card ' + (i === 4 ? 'popular' : '') + ' ' + (i === currentPkgIndex ? 'active' : '') + '" data-action="select-pkg" data-idx="' + i + '">' +
      '<div class="pkg-hrs">' + pkg.hrs + '</div>' +
      '<div class="pkg-hrs-label">hours</div>' +
      '<div class="pkg-discount">' + (pkg.discount * 100) + '% off</div>' +
      '<div class="pkg-total-price">£' + pkg.price.toLocaleString() + '</div>' +
      '<div class="pkg-per-hr">£' + (pkg.price / pkg.hrs).toFixed(2) + ' / hr</div>' +
    '</div>'
  ).join('');
}

loadConfig();

// PACKAGE DATA
const PACKAGES = [];
const BASE_RATE = 60;
let currentPkgIndex = 2;

// CALCULATOR STATE
let basePrice = 2400;
let addonPrices = { 1: 349, 2: 349, 3: 349 };
let addonTiers = { 1: 'retake_2', 2: 'retake_3', 3: 'retake_4' };

function getSelectedRetakes() {
  return [1,2,3].filter(i => document.getElementById('addon-card-' + i)?.classList.contains('selected'));
}

function fmt(n) {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function updatePkg(idx) {
  idx = parseInt(idx);
  currentPkgIndex = idx;
  const pkg = PACKAGES[idx];
  if (!pkg) return;

  const _lessonPrice = SITE_CONFIG.pricing?.payg_lesson_price || (SITE_CONFIG.pricing?.payg_hourly ? SITE_CONFIG.pricing.payg_hourly * 1.5 : 90);
  const std = pkg.hrs * (_lessonPrice / 1.5);
  const saving = std - pkg.price;
  const perHr = pkg.price / pkg.hrs;

  document.getElementById('pkg-hrs-display').textContent = pkg.hrs + ' hrs';
  document.getElementById('pkg-std-price').textContent = fmt(std);
  document.getElementById('pkg-discount-pct').textContent = (pkg.discount * 100) + '%';
  document.getElementById('pkg-saving').textContent = '−' + fmt(saving);
  document.getElementById('pkg-per-hr').textContent = fmt(perHr);
  document.getElementById('pkg-total').textContent = fmt(pkg.price);

  document.querySelectorAll('.pkg-card').forEach((card, i) => {
    card.classList.toggle('active', i === idx);
  });
}

function selectPkg(idx, card) {
  document.getElementById('pkg-slider').value = idx;
  updatePkg(idx);
}

function scrollToPackages() {
  document.getElementById('packages').scrollIntoView({ behavior: 'smooth' });
}

// Primary booking flow — sends users to the learner portal
function bookFreeTrial() {
  const session = JSON.parse(localStorage.getItem('cc_learner') || 'null');
  if (session) {
    window.location.href = '/learner/book.html';
  } else {
    window.location.href = '/learner/login.html?redirect=/learner/book.html';
  }
}

// Setmore kept as hidden fallback
function openSetmoreBooking() {
  const setmoreButton = document.getElementById('Anywhere_button_iframe');
  if (setmoreButton) {
    setmoreButton.click();
  } else {
    window.open('https://coachcarteruk.setmore.com/services/f92268da-e2cc-4661-8cdd-82afa1b767a0', '_blank');
  }
}

function toggleAddon(addon, element) {
  const isActive = element.classList.contains('selected');
  if (isActive) {
    for (let i = addon; i <= 3; i++) {
      const card = document.getElementById('addon-card-' + i);
      if (card) card.classList.remove('selected');
      const cb = document.getElementById('checkbox-' + i);
      if (cb) cb.textContent = '';
      const row = document.getElementById('addon-row-' + i);
      if (row) row.style.display = 'none';
    }
  } else {
    for (let i = 1; i < addon; i++) {
      if (!document.getElementById('addon-card-' + i)?.classList.contains('selected')) return;
    }
    element.classList.add('selected');
    document.getElementById('checkbox-' + addon).textContent = '✓';
    document.getElementById('addon-row-' + addon).style.display = 'flex';
  }
  updateTotal();
}

function updateTotal() {
  let total = basePrice;
  for (let i = 1; i <= 3; i++) {
    if (document.getElementById('addon-card-' + i)?.classList.contains('selected')) {
      total += addonPrices[i];
    }
  }
  const totalEl = document.getElementById('total-amount');
  if (totalEl) totalEl.textContent = '£' + total.toLocaleString();
}

async function startCheckout(type, pkgIndex = null) {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    let lineItems, metadata, customFields;
    const p = SITE_CONFIG.pricing || { payg_lesson_price: 90, core_programme: 2400 };
    const _paygLesson = p.payg_lesson_price || (p.payg_hourly ? p.payg_hourly * 1.5 : 90);

    if (type === 'payg') {
      lineItems = [{
        price_data: { currency: 'gbp', unit_amount: _paygLesson * 100, product_data: { name: 'Driving Lesson — Pay As You Go', description: 'Single 1.5hr lesson with CoachCarter' } },
        quantity: 1
      }];
      metadata = { package_type: 'payg' };
      customFields = [{ key: 'provisional_licence', label: { type: 'custom', custom: 'Provisional licence number' }, type: 'text', optional: false }];
    } else if (type === 'bulk') {
      const pkg = PACKAGES[pkgIndex || currentPkgIndex];
      if (!pkg) throw new Error('No package selected');
      lineItems = [{
        price_data: { currency: 'gbp', unit_amount: pkg.price * 100, product_data: { name: pkg.hrs + ' Hour Package', description: pkg.hrs + ' hours of driving instruction — ' + (pkg.discount * 100) + '% off' } },
        quantity: 1
      }];
      metadata = { package_type: 'bulk', hours: pkg.hrs, discount: pkg.discount };
      customFields = [{ key: 'provisional_licence', label: { type: 'custom', custom: 'Provisional licence number' }, type: 'text', optional: false }];
    }

    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items: lineItems, metadata: metadata, custom_fields: customFields, success_url: window.location.origin + '/success.html?session_id={CHECKOUT_SESSION_ID}', cancel_url: window.location.origin + '/' })
    });

    if (!response.ok) throw new Error('Failed to create checkout');
    const { url } = await response.json();
    window.location.href = url;
  } catch (err) {
    console.error('Checkout error:', err);
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Something went wrong. Please try again or contact us directly.');
  }
}

async function startCalculatorCheckout() {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    let lineItems = [];
    let metadata = {};
    let customFields = [];

    lineItems.push({
      price_data: { currency: 'gbp', unit_amount: basePrice * 100, product_data: { name: 'Core Programme — 18 Week Guarantee', description: '18 weeks, practical test booked, instructor performance-paid' } },
      quantity: 1
    });

    const selectedRetakes = getSelectedRetakes();
    const retakeCount = selectedRetakes.length;
    const retakeLabels = ['2nd', '3rd', '4th'];
    const tierNames = ['core_only', 'core_plus_1', 'core_plus_2', 'core_plus_3'];
    const tierName = tierNames[retakeCount] || 'core_only';
    const packageName = retakeCount === 0 ? 'Core Programme' : 'Core + ' + retakeCount + ' Pre-paid Retake' + (retakeCount > 1 ? 's' : '');
    const totalHours = (SITE_CONFIG.pricing?.core_hours || 30) + retakeCount * 15;

    selectedRetakes.forEach((slot, idx) => {
      lineItems.push({
        price_data: { currency: 'gbp', unit_amount: addonPrices[slot] * 100, product_data: { name: retakeLabels[idx] + ' Retake Cover', description: '15 hrs tuition + DVSA test fee included' } },
        quantity: 1
      });
    });

    metadata = { package_type: tierName, package_name: packageName, total_hours: totalHours.toString(), retake_coverage: retakeCount.toString(), base_price: basePrice.toString(), addon_price: (retakeCount * (addonPrices[1] || 349)).toString(), estimated_profit: calculateProfit(tierName).toString() };
    customFields = [
      { key: 'provisional_licence', label: { type: 'custom', custom: 'Provisional licence number' }, type: 'text', optional: false },
      { key: 'has_test_booked', label: { type: 'custom', custom: 'Do you already have a practical test booked?' }, type: 'dropdown', dropdown: { options: [{ label: 'No, I need you to book it', value: 'needstest' }, { label: 'Yes, I have a test date', value: 'hastest' }, { label: "I'm not sure / need help", value: 'unsure' }] } },
      { key: 'dvsa_reference', label: { type: 'custom', custom: 'DVSA reference or preferred start date' }, type: 'text', optional: true }
    ];

    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items: lineItems, metadata: metadata, custom_fields: customFields, success_url: window.location.origin + '/success.html?session_id={CHECKOUT_SESSION_ID}', cancel_url: window.location.origin + '/#guarantee' })
    });

    if (!response.ok) throw new Error('Failed to create checkout');
    const { url } = await response.json();
    window.location.href = url;
  } catch (err) {
    console.error('Checkout error:', err);
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Something went wrong. Please try again or contact us directly.');
  }
}

function calculateProfit(tier) {
  const profits = { 'core_only': 430, 'core_plus_1': 489, 'core_plus_2': 548, 'core_plus_3': 607 };
  return profits[tier] || 430;
}

// SCROLL REVEAL
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ENQUIRY FORM HANDLER
document.getElementById('enquiry-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('enq-submit');
  const statusDiv = document.getElementById('enquiry-status');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';
  statusDiv.className = 'enquiry-status';
  statusDiv.style.display = 'none';

  const formData = {
    name: document.getElementById('enq-name').value.trim(),
    email: document.getElementById('enq-email').value.trim(),
    phone: document.getElementById('enq-phone').value.trim(),
    enquiryType: document.getElementById('enq-type').value,
    message: document.getElementById('enq-message').value.trim(),
    marketing: document.getElementById('enq-marketing').checked,
    submittedAt: new Date().toISOString()
  };

  try {
    const response = await fetch('/api/enquiries?action=submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const result = await response.json();
    if (response.ok) {
      statusDiv.textContent = '✓ Message sent! We\'ll be in touch within 24 hours.';
      statusDiv.className = 'enquiry-status success';
      document.getElementById('enquiry-form').reset();
      statusDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      throw new Error(result.error || 'Failed to send enquiry');
    }
  } catch (err) {
    console.error('Enquiry error:', err);
    statusDiv.textContent = 'Something went wrong. Please email us directly at fraser@coachcarter.uk';
    statusDiv.className = 'enquiry-status error';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});


document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action="select-pkg"]');
  if (t) selectPkg(parseInt(t.dataset.idx, 10), t);
});
(function wire() {
  var bind = function (id, fn, ev) { var el = document.getElementById(id); if (el) el.addEventListener(ev || 'click', fn); };
  bind('hero-cta', scrollToPackages);
  bind('btn-payg', bookFreeTrial);
  bind('pkg-slider', function () { updatePkg(this.value); }, 'input');
  bind('btn-package', function () { startCheckout('bulk', currentPkgIndex); });
  bind('cta-primary', function () { startCheckout('payg'); });
})();
})();
