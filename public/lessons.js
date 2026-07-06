(function () {
  'use strict';

// CONFIG SYSTEM
let SITE_CONFIG = {};
const LEGACY_MARKETING_INSTRUCTOR_ID = 1;

// Pull live per-hour rate from /api/lesson-types for the legacy CoachCarter
// marketing instructor. Final booking prices are confirmed by the live
// booking/checkout flow for the selected instructor.
// Falls back to whatever config.json says if the API is unavailable.
async function loadLivePricing() {
  try {
    const res = await fetch('/api/lesson-types?action=list&school_id=1&instructor_id=' + encodeURIComponent(LEGACY_MARKETING_INSTRUCTOR_ID) + '&t=' + Date.now());
    if (!res.ok) return null;
    const data = await res.json();
    const types = Array.isArray(data) ? data : (data.lesson_types || data.types || []);
    // Prefer the standard 90-minute lesson; otherwise pick the smallest active duration.
    const active = types.filter(t => t.active !== false && t.duration_minutes && t.price_pence);
    if (!active.length) return null;
    const standard = active.find(t => t.duration_minutes === 90) || active.sort((a, b) => a.duration_minutes - b.duration_minutes)[0];
    const pricePerHourPence = Math.round(standard.price_pence / (standard.duration_minutes / 60));
    return {
      hourly: pricePerHourPence / 100,
      lesson_price: Math.round(pricePerHourPence * 1.5) / 100,
      duration_minutes: standard.duration_minutes
    };
  } catch (err) {
    console.warn('Live pricing fetch failed, falling back to config:', err);
    return null;
  }
}

// Pull live bulk-credit pricing from the same selected-instructor endpoint
// api/credits.js uses server-side. This mirrors the legacy CoachCarter
// marketing checkout context; learners choosing another instructor see their
// final rate in the booking/buy-credit flow. Pre-PR-J the numbers came from
// public/config.json, which can drift from
// schools.config.pricing). Falls back to config.json's bulk_packages if the
// API is unavailable, which is the pre-PR-J behaviour.
async function loadLiveBulkPricing() {
  try {
    const res = await fetch('/api/credits?action=bulk-pricing&school_id=1&instructor_id=' + encodeURIComponent(LEGACY_MARKETING_INSTRUCTOR_ID) + '&t=' + Date.now());
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.hourly_pence) return null;
    // discount_tiers comes sorted descending by min_hours (first match wins).
    return {
      hourly_pence: data.hourly_pence,
      discount_tiers: Array.isArray(data.discount_tiers) ? data.discount_tiers : []
    };
  } catch (err) {
    console.warn('Live bulk pricing fetch failed, falling back to config:', err);
    return null;
  }
}

// Mirror api/_pricing-helpers.js::getDiscountPct - tiers sorted desc, first match wins.
function pickDiscountPct(hours, tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return 0;
  const hit = tiers.find(t => hours >= t.min_hours);
  return hit ? Number(hit.discount_pct) || 0 : 0;
}

// Replace the marketing config's bulk_packages with server-priced packages
// derived from the live hourly rate + tiers. Keeps the same hour buckets the
// marketing page advertises (10/20/30/40/50) but prices them from the source
// the checkout endpoint will use. If overlay fails the page renders whatever
// config.json shipped - same as pre-PR-J behaviour.
function overlayServerBulkPackages(configData, live) {
  if (!configData || !live || !configData.pricing || !Array.isArray(configData.pricing.bulk_packages)) return;
  const hourlyPence = live.hourly_pence;
  configData.pricing.bulk_packages = configData.pricing.bulk_packages.map(pkg => {
    const hrs = Number(pkg.hrs);
    if (!hrs) return pkg;
    const fullPence = Math.round(hourlyPence * hrs);
    const discountPct = pickDiscountPct(hrs, live.discount_tiers);
    const discountAmtPence = Math.round(fullPence * discountPct / 100);
    const totalPence = fullPence - discountAmtPence;
    return {
      hrs,
      price: Math.round(totalPence / 100),          // £ for display only
      discount: discountPct / 100                    // decimal (0.08 = 8%)
    };
  });
}

async function loadConfig() {
  let configData = null;
  try {
    const res = await fetch('/api/config?t=' + Date.now());
    configData = await res.json();
  } catch (err) {
    console.error('Failed to load config from API, trying file fallback:', err);
    try {
      const res = await fetch('/config.json?t=' + Date.now());
      configData = await res.json();
    } catch (err2) {
      console.error('Config fallback also failed:', err2);
    }
  }

  // Overlay live pricing for the public CoachCarter instructor. Final selected-
  // instructor pricing is confirmed inside the live booking/buy-credit flows.
  // Fetch both overlays in parallel - both are independent of each other and of configData.
  const [live, liveBulk] = await Promise.all([loadLivePricing(), loadLiveBulkPricing()]);
  if (configData && live) {
    configData.pricing = configData.pricing || {};
    configData.pricing.payg_hourly = live.hourly;
    configData.pricing.payg_lesson_price = live.lesson_price;
  }
  if (configData && liveBulk) {
    overlayServerBulkPackages(configData, liveBulk);
  }

  if (configData) {
    SITE_CONFIG = configData;
    applyConfig();
  } else {
    initWithDefaults();
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

  // Hero stats reduced 2026-04-28 - TRG hidden, so stats 3 & 4 now show "Free trial"
  // and "DVSA approved" instead of programme price/duration. Stage 2 retires
  // self-serve credit package messaging, so stat 2 stays direct-booking focused.
  const hourly = p.payg_hourly || (p.payg_lesson_price ? p.payg_lesson_price / 1.5 : 60);
  const stat1El = document.getElementById('hero-stat-1-value');
  const stat1LabelEl = document.getElementById('hero-stat-1-label');
  if (stat1El) stat1El.textContent = '£' + hourly;
  if (stat1LabelEl) stat1LabelEl.innerHTML = 'From per hour,<br>school default';
  const stat2El = document.getElementById('hero-stat-2-value');
  const stat2LabelEl = document.getElementById('hero-stat-2-label');
  if (stat2El) stat2El.textContent = 'Online';
  if (stat2LabelEl) stat2LabelEl.innerHTML = 'Direct booking<br>available';

  // TRG / Core Programme / calculator addon DOM was removed from lessons.html
  // 2026-04-28 (TRG hidden) and the JS hooks were retired 2026-05-19 (PR-J).
  // The config still carries core_programme / retake_price for the
  // learner-journey.html page; nothing on /lessons.html reads them.

  // Hero headline only - subheadline NO LONGER overridden from config (was reintroducing
  // TRG copy from old config.json values). 2026-04-28.
  if (c.hero) {
    const headlineEl = document.getElementById('hero-headline');
    if (headlineEl && c.hero.headline) {
      headlineEl.innerHTML = c.hero.headline.replace('.', '.<br><em>') + '</em>';
    }
  }

  if (c.sections) {
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    setText('section-payg-title', c.sections.payg?.title);
    setText('section-payg-subtitle', c.sections.payg?.subtitle);
    setText('section-packages-title', 'Existing Lesson Credit');
    setText('section-packages-subtitle', 'Existing Lesson Credit still works for eligible bookings. New self-serve credit packages are retired, so new learners can book a lesson and pay directly.');
    setText('section-guarantee-title', c.sections.guarantee?.title);
    setText('section-guarantee-subtitle', c.sections.guarantee?.subtitle);
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
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    setText('nav-cta-primary', c.cta.primary);
    // hero-cta text is set in HTML ("Book your free trial →"); don't override from config.
    setText('btn-payg', c.cta.payg_button);
    setText('btn-package', 'Book a lesson →');
    setText('btn-guarantee', c.cta.guarantee_button);
    setText('cta-primary', c.cta.primary);
    setText('cta-secondary', c.cta.secondary);
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
  // Comparison table removed - function kept as no-op for safety
}

function renderPackages() {
  const grid = document.getElementById('packages-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="pkg-card active" aria-disabled="true">'
    + '<div class="pkg-hrs">LC</div>'
    + '<div class="pkg-hrs-label">Lesson Credit</div>'
    + '<div class="pkg-discount">existing balances only</div>'
    + '<div class="pkg-total-price">Book directly</div>'
    + '<div class="pkg-per-hr">Pay-and-book remains available</div>'
    + '</div>';
}

loadConfig();

// PACKAGE DATA
const PACKAGES = [];
let currentPkgIndex = 2;
function fmt(n) {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function updatePkg(idx) {
  currentPkgIndex = parseInt(idx);
  document.getElementById('pkg-hrs-display').textContent = 'Lesson Credit';
  document.getElementById('pkg-std-price').textContent = '-';
  document.getElementById('pkg-discount-pct').textContent = '-';
  document.getElementById('pkg-saving').textContent = '-';
  document.getElementById('pkg-per-hr').textContent = '-';
  document.getElementById('pkg-total').textContent = 'Book directly';

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

// Primary booking flow - sends users to the learner portal
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

// Retired bulk-package CTA handler. Kept for old inline event hooks, but now
// routes users into booking instead of creating Lesson Credit checkout.
async function startBulkCheckout(pkgIndex) {
  bookFreeTrial();
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
    website: document.getElementById('enq-website')?.value || '',
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
  bind('btn-payg', bookFreeTrial);                      // PAYG section is hidden but binding kept harmless
  bind('pkg-slider', function () { updatePkg(this.value); }, 'input');
  bind('btn-package', function () { startBulkCheckout(currentPkgIndex); });
  // cta-primary ("Book a lesson now") - sends learners to the credit-funded
  // book.html flow instead of the retired legacy PAYG Stripe session (PR-J).
  bind('cta-primary', bookFreeTrial);
})();
})();
