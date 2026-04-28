(function () {
  'use strict';

let currentConfig = {};
let hourlyRate = 60;

// Initialize
loadConfig();
loadDynamicPricing();

async function loadConfig() {
  try {
    const res = await fetch('/api/config?t=' + Date.now());
    currentConfig = await res.json();
    const source = currentConfig._source === 'db' ? 'database' : 'config file';
    populateForm();
    updateAllCalculations();
    showStatus('Config loaded from ' + source, 'success');
  } catch (err) {
    showStatus('Error loading config: ' + err.message, 'error');
    currentConfig = getDefaultConfig();
    populateForm();
    updateAllCalculations();
  }
}

function getDefaultConfig() {
  return {
    pricing: {
      payg_lesson_price: 90,
      core_programme: 2400,
      core_hours: 30,
      retake_price: 349,
      bulk_packages: [
        { hrs: 10, discount: 0.08, price: 506, per_hour: 50.6 },
        { hrs: 20, discount: 0.12, price: 968, per_hour: 48.4 },
        { hrs: 30, discount: 0.15, price: 1403, per_hour: 46.75 },
        { hrs: 40, discount: 0.18, price: 1804, per_hour: 45.1 },
        { hrs: 50, discount: 0.21, price: 2173, per_hour: 43.45 }
      ]
    },
    content: {
      hero: {
        headline: "Your licence. Your way.",
        subheadline: "Choose how you want to learn — from flexible pay-as-you-go to our fully guaranteed 18-week Test Ready Guarantee. Expert instructors, real results.",
        stats: [
          { value: "£90", label: "Per 1.5hr lesson" },
          { value: "21%", label: "Max discount on bulk packages" },
          { value: "£2,400", label: "Full Test Ready Guarantee programme" },
          { value: "18wk", label: "Structured programme to test day" }
        ]
      },
      sections: {
        payg: { title: "Pay As You Go", subtitle: "Maximum flexibility. Book when you need, cancel when life happens." },
        packages: { title: "Bulk Hour Packages", subtitle: "Buy more hours up front and save up to 21%. The more committed you are, the better the deal." },
        guarantee: { title: "The Test Ready Guarantee", subtitle: "18 weeks to your driving licence — or we keep going until you pass." }
      },
      features: {
        payg: ["Qualified ADI instructor every time", "Book online or by phone", "Lesson length to suit you", "Progress tracked between lessons", "Upgrade to a package anytime"],
        core: ["18-week structured programme", "~30 hours with expert instructor", "3 mock driving assessments included", "Practical test booked for you", "100% Money Back After First Lesson", "1st retake fully covered — 15 hrs tuition + test booking included"]
      },
      cta: {
        primary: "Book a Lesson",
        secondary: "Talk to us first",
        payg_button: "Book £60 lesson →",
        package_button: "Buy this package →",
        guarantee_button: "Continue to Booking →"
      },
      business: {
        pass_rate: "68%",
        programme_duration: "18 weeks",
        contact_email: "hello@coachcarter.com",
        guarantee_note: "In 2024 car practical test pass rate was 47%. Choose the protection that feels right for you.",
        footer_text: "© 2025 CoachCarter Driving School · Privacy · Terms · All prices include VAT where applicable."
      }
    },
    last_updated: new Date().toISOString()
  };
}

function populateForm() {
  const p = currentConfig.pricing;
  const c = currentConfig.content;

  // Pricing
  document.getElementById('paygHourly').value = p.payg_lesson_price || (p.payg_hourly ? p.payg_hourly * 1.5 : 90);
  document.getElementById('coreProgramme').value = p.core_programme;
  document.getElementById('coreHours').value = p.core_hours || 30;
  document.getElementById('retake1').value = p.retake_1;
  document.getElementById('retake2').value = p.retake_2;
  document.getElementById('retakeLifetime').value = p.retake_lifetime;

  // Bulk credit pricing (the live rate learners actually pay at checkout)
  const bulkHourlyPence = Number.isInteger(p.bulk_hourly_pence) ? p.bulk_hourly_pence : null;
  const bulkInput = document.getElementById('bulkHourlyRate');
  if (bulkInput) {
    bulkInput.value = bulkHourlyPence != null ? (bulkHourlyPence / 100).toFixed(2) : '';
  }
  renderBulkTiers(Array.isArray(p.bulk_discount_tiers) ? p.bulk_discount_tiers : []);
  
  // Hero
  document.getElementById('heroHeadline').value = c.hero.headline;
  document.getElementById('heroSubheadline').value = c.hero.subheadline;
  if (c.hero.stats) {
    document.getElementById('heroStat1Value').value = c.hero.stats[0]?.value || '£60';
    document.getElementById('heroStat1Label').value = c.hero.stats[0]?.label || 'Per 1.5hr lesson';
    document.getElementById('heroStat2Value').value = c.hero.stats[1]?.value || '15%';
    document.getElementById('heroStat2Label').value = c.hero.stats[1]?.label || 'Max discount on bulk packages';
    document.getElementById('heroStat3Value').value = c.hero.stats[2]?.value || '£2,400';
    document.getElementById('heroStat3Label').value = c.hero.stats[2]?.label || 'Full Test Ready Guarantee programme';
    document.getElementById('heroStat4Value').value = c.hero.stats[3]?.value || '18wk';
    document.getElementById('heroStat4Label').value = c.hero.stats[3]?.label || 'Structured programme to test day';
  }
  
  // Sections
  document.getElementById('sectionPaygTitle').value = c.sections.payg.title;
  document.getElementById('sectionPaygSubtitle').value = c.sections.payg.subtitle;
  document.getElementById('sectionPackagesTitle').value = c.sections.packages.title;
  document.getElementById('sectionPackagesSubtitle').value = c.sections.packages.subtitle;
  document.getElementById('sectionGuaranteeTitle').value = c.sections.guarantee.title;
  document.getElementById('sectionGuaranteeSubtitle').value = c.sections.guarantee.subtitle;
  
  // Features
  populateFeatureList('paygFeatures', c.features.payg);
  populateFeatureList('coreFeatures', c.features.core);
  
  // CTAs
  document.getElementById('ctaPrimary').value = c.cta.primary;
  document.getElementById('ctaSecondary').value = c.cta.secondary;
  document.getElementById('btnPayg').value = c.cta.payg_button;
  document.getElementById('btnPackage').value = c.cta.package_button;
  document.getElementById('btnGuarantee').value = c.cta.guarantee_button;
  
  // Business
  document.getElementById('passRate').value = c.business.pass_rate;
  document.getElementById('programmeDuration').value = c.business.programme_duration;
  document.getElementById('contactEmail').value = c.business.contact_email;
  document.getElementById('guaranteeNote').value = c.business.guarantee_note;
  document.getElementById('footerText').value = c.business.footer_text;
  
  // Bulk table
  renderBulkTable(p.bulk_packages);
  updateGuaranteePreview();
}

function populateFeatureList(elementId, features) {
  const container = document.getElementById(elementId);
  container.innerHTML = features.map(f => `
    <div class="feature-item">
      <input type="text" value="${f}">
      <button data-action="remove-feature">Remove</button>
    </div>
  `).join('');
}

function addFeature(containerId) {
  const container = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'feature-item';
  div.innerHTML = `
    <input type="text" value="" placeholder="Enter feature text">
    <button data-action="remove-feature">Remove</button>
  `;
  container.appendChild(div);
}

function removeFeature(btn) {
  btn.parentElement.remove();
}

function renderBulkTable(packages) {
  const tbody = document.getElementById('bulkTableBody');
  hourlyRate = (parseInt(document.getElementById('paygHourly').value) || 90) / 1.5;
  
  tbody.innerHTML = packages.map((pkg, i) => {
    const standardPrice = pkg.hrs * hourlyRate;
    const savings = standardPrice - pkg.price;
    
    return `
      <tr data-index="${i}" data-hours="${pkg.hrs}">
        <td>
          <input type="number"
                 id="hours-${i}"
                 value="${pkg.hrs}"
                 min="1"
                 style="width: 70px;"
                 data-action="update-hours" data-idx="${i}"
                 placeholder="hrs">
          <span style="font-size: 0.85rem; color: var(--muted);">hrs</span>
        </td>
        <td>
          <input type="number" 
                 id="discount-${i}" 
                 value="${(pkg.discount * 100).toFixed(1)}" 
                 step="0.1"
                 data-action="calc-from-discount" data-idx="${i}"
                 placeholder="%">
        </td>
        <td>
          <input type="number" 
                 id="total-${i}" 
                 value="${pkg.price}"
                 data-action="calc-from-total" data-idx="${i}"
                 placeholder="£">
        </td>
        <td class="price-cell">
          <input type="number" 
                 id="perhour-${i}" 
                 value="${pkg.per_hour}"
                 step="0.01"
                 data-action="calc-from-per-hour" data-idx="${i}"
                 placeholder="£/hr">
        </td>
        <td style="color: var(--green); font-weight: 600;">
          −£${savings}
        </td>
      </tr>
    `;
  }).join('');
  
  document.getElementById('anchorRateDisplay').textContent = hourlyRate;
}

// BULK CALCULATIONS
function updateHours(index) {
  const row = document.querySelector(`tr[data-index="${index}"]`);
  const newHours = parseInt(document.getElementById(`hours-${index}`).value) || 1;
  row.dataset.hours = newHours;
  calculateFromDiscount(index);
}

function calculateFromDiscount(index) {
  const hours = parseInt(document.querySelector(`tr[data-index="${index}"]`).dataset.hours);
  const discount = parseFloat(document.getElementById(`discount-${index}`).value) || 0;
  const standardPrice = hours * hourlyRate;
  const newPrice = Math.round(standardPrice * (1 - discount / 100));
  const perHour = (newPrice / hours).toFixed(2);
  
  document.getElementById(`total-${index}`).value = newPrice;
  document.getElementById(`perhour-${index}`).value = perHour;
  updateSavings(index, newPrice);
  updatePreview();
}

function calculateFromTotal(index) {
  const hours = parseInt(document.querySelector(`tr[data-index="${index}"]`).dataset.hours);
  const total = parseInt(document.getElementById(`total-${index}`).value) || 0;
  const standardPrice = hours * hourlyRate;
  const discount = ((standardPrice - total) / standardPrice * 100).toFixed(1);
  const perHour = (total / hours).toFixed(2);
  
  document.getElementById(`discount-${index}`).value = discount;
  document.getElementById(`perhour-${index}`).value = perHour;
  updateSavings(index, total);
  updatePreview();
}

function calculateFromPerHour(index) {
  const hours = parseInt(document.querySelector(`tr[data-index="${index}"]`).dataset.hours);
  const perHour = parseFloat(document.getElementById(`perhour-${index}`).value) || 0;
  const total = Math.round(perHour * hours);
  const standardPrice = hours * hourlyRate;
  const discount = ((standardPrice - total) / standardPrice * 100).toFixed(1);
  
  document.getElementById(`total-${index}`).value = total;
  document.getElementById(`discount-${index}`).value = discount;
  updateSavings(index, total);
  updatePreview();
}

function updateSavings(index, actualPrice) {
  const hours = parseInt(document.querySelector(`tr[data-index="${index}"]`).dataset.hours);
  const standardPrice = hours * hourlyRate;
  const savings = standardPrice - actualPrice;
  const row = document.querySelector(`tr[data-index="${index}"]`);
  row.cells[4].textContent = `−£${savings}`;
  row.cells[4].style.color = savings > 0 ? 'var(--green)' : 'var(--muted)';
}

// GUARANTEE CALCULATIONS
function calculateFromCore() {
  const core = parseInt(document.getElementById('coreProgramme').value) || 2400;
  const r1 = parseInt(document.getElementById('retake1').value) || 0;
  const r2 = parseInt(document.getElementById('retake2').value) || 0;
  const rLife = parseInt(document.getElementById('retakeLifetime').value) || 0;
  
  document.getElementById('total-retake1').textContent = '£' + (core + r1).toLocaleString();
  document.getElementById('total-retake2').textContent = '£' + (core + r2).toLocaleString();
  document.getElementById('total-retakeLifetime').textContent = '£' + (core + rLife).toLocaleString();
  
  updateGuaranteePreview();
  updatePreview();
}

function calculateFromAddon(addonNum) {
  const core = parseInt(document.getElementById('coreProgramme').value) || 2400;
  let addonPrice, totalElementId;
  
  if (addonNum === 1) {
    addonPrice = parseInt(document.getElementById('retake1').value) || 0;
    totalElementId = 'total-retake1';
  } else if (addonNum === 2) {
    addonPrice = parseInt(document.getElementById('retake2').value) || 0;
    totalElementId = 'total-retake2';
  } else if (addonNum === 3) {
    addonPrice = parseInt(document.getElementById('retakeLifetime').value) || 0;
    totalElementId = 'total-retakeLifetime';
  }
  
  document.getElementById(totalElementId).textContent = '£' + (core + addonPrice).toLocaleString();
  updateGuaranteePreview();
  updatePreview();
}

function updateGuaranteePreview() {
  const core = parseInt(document.getElementById('coreProgramme').value) || 2400;
  const r1 = parseInt(document.getElementById('retake1').value) || 0;
  const r2 = parseInt(document.getElementById('retake2').value) || 0;
  const rLife = parseInt(document.getElementById('retakeLifetime').value) || 0;
  
  document.getElementById('preview-tier-core').textContent = '£' + core.toLocaleString();
  document.getElementById('preview-tier-plus1').textContent = '£' + (core + r1).toLocaleString();
  document.getElementById('preview-tier-plus2').textContent = '£' + (core + r2).toLocaleString();
  document.getElementById('preview-tier-lifetime').textContent = '£' + (core + rLife).toLocaleString();
  
  document.getElementById('breakdown-plus1').textContent = '+£' + r1.toLocaleString();
  document.getElementById('breakdown-plus2').textContent = '+£' + r2.toLocaleString();
  document.getElementById('breakdown-lifetime').textContent = '+£' + rLife.toLocaleString();
}

function updateAllCalculations() {
  hourlyRate = (parseInt(document.getElementById('paygHourly').value) || 90) / 1.5;
  document.getElementById('anchorRateDisplay').textContent = hourlyRate;
  
  const rows = document.querySelectorAll('#bulkTableBody tr');
  rows.forEach(row => {
    const index = row.dataset.index;
    calculateFromDiscount(index);
  });
  
  calculateFromCore();
  updatePreview();
}

function updatePreview() {
  const payg = parseInt(document.getElementById('paygHourly').value) || 60;
  const core = parseInt(document.getElementById('coreProgramme').value) || 2400;
  const r1 = parseInt(document.getElementById('retake1').value) || 200;
  const rLife = parseInt(document.getElementById('retakeLifetime').value) || 500;
  
  document.getElementById('previewPayg').textContent = '£' + payg + '/lesson';
  document.getElementById('previewCore').textContent = '£' + core.toLocaleString();
  document.getElementById('previewRetake1').textContent = '£' + (core + r1).toLocaleString();
  document.getElementById('previewLifetime').textContent = '£' + (core + rLife).toLocaleString();
}

// ── BULK CREDIT PRICING (per-school) ────────────────────────────────────────
// The hourly rate + tiers below control what learners are actually charged
// at checkout (api/credits.js). The Bulk Packages table above is the marketing
// display only — separate concern, separate save path.

function renderBulkTiers(tiers) {
  const tbody = document.getElementById('bulkTiersBody');
  if (!tbody) return;
  if (!tiers.length) {
    tbody.innerHTML = '<tr id="bulk-tiers-empty"><td colspan="3" style="text-align:center; color: var(--muted); padding: 16px;">No discount tiers — bulk credits will be charged at the full hourly rate.</td></tr>';
    return;
  }
  tbody.innerHTML = tiers.map((t, i) => `
    <tr data-tier-idx="${i}">
      <td><input type="number" min="1" max="36" step="1" value="${Number(t.min_hours) || ''}" data-tier-field="min_hours" data-idx="${i}"></td>
      <td><input type="number" min="0" max="50" step="1" value="${Number(t.discount_pct) || 0}" data-tier-field="discount_pct" data-idx="${i}"></td>
      <td><button type="button" class="btn-remove-tier" data-tier-remove="${i}" style="background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; color: var(--muted);">Remove</button></td>
    </tr>
  `).join('');
}

function readTiersFromDom() {
  const rows = document.querySelectorAll('#bulkTiersBody tr[data-tier-idx]');
  const tiers = [];
  rows.forEach(row => {
    const minH = row.querySelector('[data-tier-field="min_hours"]');
    const pct = row.querySelector('[data-tier-field="discount_pct"]');
    if (!minH || !pct) return;
    tiers.push({ min_hours: parseInt(minH.value, 10), discount_pct: parseInt(pct.value, 10) });
  });
  return tiers;
}

function addBulkTier() {
  const existing = readTiersFromDom();
  // Pick a sensible default for the new row: next round number above the highest current min_hours
  const highest = existing.reduce((m, t) => Math.max(m, t.min_hours || 0), 0);
  const newMin = Math.min(36, Math.max(12, highest + 12));
  existing.push({ min_hours: newMin, discount_pct: 5 });
  renderBulkTiers(existing);
  validateBulkTiers();
}

function removeBulkTier(idx) {
  const existing = readTiersFromDom();
  existing.splice(idx, 1);
  renderBulkTiers(existing);
  validateBulkTiers();
}

// Returns null if valid, error string otherwise. Mirrors the server-side
// rules in api/_pricing-helpers.js#validateBulkPricingConfig — keep in sync.
function validateBulkTiers() {
  const errEl = document.getElementById('bulkTiersError');
  const saveBtn = document.getElementById('btn-save-config');
  const tiers = readTiersFromDom();
  let err = null;

  const seen = new Set();
  for (const t of tiers) {
    if (!Number.isInteger(t.min_hours) || t.min_hours < 1 || t.min_hours > 36) {
      err = 'Tier min hours must be a whole number between 1 and 36.';
      break;
    }
    if (!Number.isInteger(t.discount_pct) || t.discount_pct < 0 || t.discount_pct > 50) {
      err = 'Tier discount % must be a whole number between 0 and 50.';
      break;
    }
    if (seen.has(t.min_hours)) {
      err = `Duplicate tier for ${t.min_hours} hours — each milestone must be unique.`;
      break;
    }
    seen.add(t.min_hours);
  }

  // Also validate the hourly rate input
  if (!err) {
    const v = document.getElementById('bulkHourlyRate')?.value;
    if (v !== '' && v != null) {
      const num = parseFloat(v);
      if (!isFinite(num) || num <= 0 || num > 500) {
        err = 'Bulk credit hourly rate must be between £0.01 and £500.';
      }
    }
  }

  if (errEl) {
    if (err) {
      errEl.textContent = '⚠️ ' + err;
      errEl.className = 'status-msg error';
      errEl.style.display = 'block';
    } else {
      errEl.style.display = 'none';
    }
  }
  if (saveBtn) saveBtn.disabled = !!err;
  return err;
}

// Event delegation for tier rows
document.addEventListener('click', function (e) {
  const removeIdx = e.target.closest('[data-tier-remove]')?.dataset.tierRemove;
  if (removeIdx != null) removeBulkTier(parseInt(removeIdx, 10));
});
document.addEventListener('input', function (e) {
  if (e.target.matches('[data-tier-field], #bulkHourlyRate')) validateBulkTiers();
});

function gatherFormData() {
  // Update pricing
  const lessonPrice = parseInt(document.getElementById('paygHourly').value) || 90;
  currentConfig.pricing.payg_lesson_price = lessonPrice;
  currentConfig.pricing.payg_hourly = lessonPrice / 1.5;

  // Bulk credit pricing — only stored if a value has been entered. Empty
  // input means "use the school's standard 90-min lesson type rate" (handled
  // server-side in api/_pricing-helpers.js).
  const bulkRaw = document.getElementById('bulkHourlyRate')?.value;
  if (bulkRaw !== '' && bulkRaw != null) {
    const pounds = parseFloat(bulkRaw);
    if (isFinite(pounds) && pounds > 0) {
      currentConfig.pricing.bulk_hourly_pence = Math.round(pounds * 100);
    }
  } else {
    delete currentConfig.pricing.bulk_hourly_pence;
  }
  currentConfig.pricing.bulk_discount_tiers = readTiersFromDom();
  currentConfig.pricing.core_programme = parseInt(document.getElementById('coreProgramme').value) || 2400;
  currentConfig.pricing.core_hours = parseInt(document.getElementById('coreHours').value) || 30;
  currentConfig.pricing.retake_1 = parseInt(document.getElementById('retake1').value) || 200;
  currentConfig.pricing.retake_2 = parseInt(document.getElementById('retake2').value) || 350;
  currentConfig.pricing.retake_lifetime = parseInt(document.getElementById('retakeLifetime').value) || 500;
  
  // Update bulk packages
  const rows = document.querySelectorAll('#bulkTableBody tr');
  rows.forEach((row, i) => {
    currentConfig.pricing.bulk_packages[i].hrs = parseInt(document.getElementById(`hours-${i}`).value) || currentConfig.pricing.bulk_packages[i].hrs;
    currentConfig.pricing.bulk_packages[i].price = parseInt(document.getElementById(`total-${i}`).value) || currentConfig.pricing.bulk_packages[i].price;
    currentConfig.pricing.bulk_packages[i].discount = parseFloat(document.getElementById(`discount-${i}`).value) / 100 || currentConfig.pricing.bulk_packages[i].discount;
    currentConfig.pricing.bulk_packages[i].per_hour = parseFloat(document.getElementById(`perhour-${i}`).value) || currentConfig.pricing.bulk_packages[i].per_hour;
  });
  
  // Update content
  currentConfig.content.hero.headline = document.getElementById('heroHeadline').value;
  currentConfig.content.hero.subheadline = document.getElementById('heroSubheadline').value;
  currentConfig.content.hero.stats = [
    { value: document.getElementById('heroStat1Value').value, label: document.getElementById('heroStat1Label').value },
    { value: document.getElementById('heroStat2Value').value, label: document.getElementById('heroStat2Label').value },
    { value: document.getElementById('heroStat3Value').value, label: document.getElementById('heroStat3Label').value },
    { value: document.getElementById('heroStat4Value').value, label: document.getElementById('heroStat4Label').value }
  ];
  
  currentConfig.content.sections.payg.title = document.getElementById('sectionPaygTitle').value;
  currentConfig.content.sections.payg.subtitle = document.getElementById('sectionPaygSubtitle').value;
  currentConfig.content.sections.packages.title = document.getElementById('sectionPackagesTitle').value;
  currentConfig.content.sections.packages.subtitle = document.getElementById('sectionPackagesSubtitle').value;
  currentConfig.content.sections.guarantee.title = document.getElementById('sectionGuaranteeTitle').value;
  currentConfig.content.sections.guarantee.subtitle = document.getElementById('sectionGuaranteeSubtitle').value;
  
  // Gather features from dynamic lists
  currentConfig.content.features.payg = Array.from(document.querySelectorAll('#paygFeatures .feature-item input')).map(i => i.value).filter(v => v);
  currentConfig.content.features.core = Array.from(document.querySelectorAll('#coreFeatures .feature-item input')).map(i => i.value).filter(v => v);
  
  currentConfig.content.cta.primary = document.getElementById('ctaPrimary').value;
  currentConfig.content.cta.secondary = document.getElementById('ctaSecondary').value;
  currentConfig.content.cta.payg_button = document.getElementById('btnPayg').value;
  currentConfig.content.cta.package_button = document.getElementById('btnPackage').value;
  currentConfig.content.cta.guarantee_button = document.getElementById('btnGuarantee').value;
  
  currentConfig.content.business.pass_rate = document.getElementById('passRate').value;
  currentConfig.content.business.programme_duration = document.getElementById('programmeDuration').value;
  currentConfig.content.business.contact_email = document.getElementById('contactEmail').value;
  currentConfig.content.business.guarantee_note = document.getElementById('guaranteeNote').value;
  currentConfig.content.business.footer_text = document.getElementById('footerText').value;
  
  currentConfig.last_updated = new Date().toISOString();
}

async function saveConfig() {
  const password = document.getElementById('adminPassword').value.trim();
  if (!password) {
    showStatus('⚠️ Enter your admin password before saving.', 'error');
    document.getElementById('adminPassword').focus();
    return;
  }

  // Block save if bulk pricing is invalid — server would reject anyway, but
  // catching here gives a clearer message and avoids a wasted round-trip.
  const bulkErr = validateBulkTiers();
  if (bulkErr) {
    showStatus('⚠️ Fix bulk pricing errors before saving.', 'error');
    return;
  }

  gatherFormData();
  showStatus('Saving...', 'success');

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: currentConfig, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus('❌ ' + (data.error || 'Save failed'), 'error');
      return;
    }

    document.getElementById('lastSaved').textContent = 'Last saved: ' + new Date().toLocaleTimeString();
    showStatus('✅ Saved to live site! Changes are live immediately.', 'success');
  } catch (err) {
    showStatus('❌ Network error: ' + err.message, 'error');
  }
}

function downloadConfig() {
  const dataStr = JSON.stringify(currentConfig, null, 2);
  const blob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'config.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function resetConfig() {
  if (confirm('Reset all changes to last saved config?')) {
    loadConfig();
  }
}

function showStatus(msg, type) {
  const status = document.getElementById('saveStatus');
  status.textContent = msg;
  status.className = 'status-msg ' + type;
  setTimeout(() => status.className = 'status-msg', 6000);
}

// Live preview listeners
document.querySelectorAll('input, textarea').forEach(input => {
  input.addEventListener('input', () => {
    if (input.id.includes('payg') || input.id.includes('core') || input.id.includes('retake')) {
      updatePreview();
    }
  });
});

// ── Dynamic Guarantee Pricing ────────────────────────────────────────────────
async function loadDynamicPricing() {
  const statusEl = document.getElementById('dynamic-pricing-status');
  try {
    const res = await fetch('/api/guarantee-price?t=' + Date.now());
    const data = await res.json();

    document.getElementById('dp-current').textContent = '£' + (data.current_price || 0).toLocaleString();
    document.getElementById('dp-purchases').textContent = data.purchases || 0;
    document.getElementById('dp-base').textContent = '£' + (data.base_price || 0).toLocaleString();
    document.getElementById('dp-increment').textContent = '+£' + (data.increment || 0) + ' per purchase';
    document.getElementById('dp-cap').textContent = '£' + (data.cap || 0).toLocaleString();
    document.getElementById('dp-override-price').value = data.current_price || '';

    const pct = data.cap > data.base_price
      ? Math.round(((data.current_price - data.base_price) / (data.cap - data.base_price)) * 100)
      : 0;

    statusEl.innerHTML = `Price is at <strong style="color:var(--accent);">${pct}%</strong> of cap · <strong>${data.purchases}</strong> enrolments so far`;
  } catch (err) {
    statusEl.textContent = 'Could not load dynamic pricing — the guarantee_pricing table may not exist yet. It will be created on first API call.';
  }
}

async function overrideGuaranteePrice() {
  const newPrice = parseInt(document.getElementById('dp-override-price').value);
  if (!newPrice || newPrice < 0) {
    alert('Please enter a valid price');
    return;
  }

  const password = document.getElementById('password').value;
  if (!password) {
    alert('Enter your admin password first (top of the page)');
    return;
  }

  try {
    const { neon } = await import('https://esm.sh/@neondatabase/serverless@0.10.1');
    // We can't call Neon directly from the browser — use the config API as a proxy.
    // Instead, we'll call a simple POST to our guarantee-price endpoint with the admin secret.
    const res = await fetch('/api/guarantee-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: password, override_price: newPrice })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update');
    }

    showStatus('Guarantee price updated to £' + newPrice.toLocaleString(), 'success');
    loadDynamicPricing();
  } catch (err) {
    showStatus('Error updating guarantee price: ' + err.message, 'error');
  }
}

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  if (a === 'remove-feature') removeFeature(t);
  else if (a === 'add-feature') addFeature(t.dataset.container);
});
document.addEventListener('change', function (e) {
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var a = t.dataset.action;
  var idx = parseInt(t.dataset.idx, 10);
  if (a === 'update-hours') updateHours(idx);
  else if (a === 'calc-from-discount') calculateFromDiscount(idx);
  else if (a === 'calc-from-total') calculateFromTotal(idx);
  else if (a === 'calc-from-per-hour') calculateFromPerHour(idx);
});
(function wire() {
  var bind = function (id, fn, ev) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev || 'click', fn);
  };
  bind('paygHourly', updateAllCalculations, 'change');
  bind('coreProgramme', calculateFromCore, 'change');
  document.querySelectorAll('[data-addon]').forEach(function (el) {
    el.addEventListener('change', function () { calculateFromAddon(parseInt(el.dataset.addon, 10)); });
  });
  bind('btn-override-guarantee', overrideGuaranteePrice);
  bind('btn-save-config', saveConfig);
  bind('btn-download-config', downloadConfig);
  bind('btn-reset-config', resetConfig);
  bind('btnAddTier', addBulkTier);
})();
})();
