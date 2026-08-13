(function () {
  'use strict';

  var statusEl = document.getElementById('catalogue-status');
  var contentEl = document.getElementById('catalogue-content');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function formatPrice(pence, currency) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      minimumFractionDigits: Number(pence) % 100 === 0 ? 0 : 2,
      maximumFractionDigits: Number(pence) % 100 === 0 ? 0 : 2
    }).format(Number(pence || 0) / 100);
  }

  function catalogueUrl() {
    var url = '/api/packages?action=catalogue';
    var params = new URLSearchParams(window.location.search);
    if (params.get('school')) url += '&school=' + encodeURIComponent(params.get('school'));
    else if (params.get('school_id')) url += '&school_id=' + encodeURIComponent(params.get('school_id'));
    return url;
  }

  function renderList(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<ul class="product-details">' + items.map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join('') + '</ul>';
  }

  function renderProduct(product, options) {
    options = options || {};
    var content = product.content || {};
    var eligibility = product.eligibility || {};
    var locked = eligibility.state === 'locked';
    var descriptionId = 'product-disclosure-' + escapeHtml(product.slug);
    var lockId = 'product-lock-' + escapeHtml(product.slug);
    var label = options.label || (locked ? 'Locked phase' : 'Catalogue version ' + product.version_number);
    var lockCopy = locked
      ? '<p class="lock-explanation" id="' + lockId + '"><strong>Why this is locked:</strong> ' + escapeHtml(eligibility.reason) + '</p>'
      : '';
    var describedBy = locked ? lockId + ' ' + descriptionId : descriptionId;

    return '<article class="product-shell' + (locked ? ' locked' : '') + '">' +
      '<div class="product-main">' +
        '<div class="product-topline"><div>' +
          '<p class="product-label">' + escapeHtml(label) + '</p>' +
          '<h3>' + escapeHtml(content.name || product.slug) + '</h3>' +
          '<p class="product-summary">' + escapeHtml(content.short_description || '') + '</p>' +
        '</div><div class="product-price">' + escapeHtml(formatPrice(product.price_pence, product.currency)) + '<small>current version</small></div></div>' +
        renderList(content.highlights) + lockCopy +
      '</div>' +
      '<div class="product-footer">' +
        '<p class="version-note" id="' + descriptionId + '">' + escapeHtml(content.checkout_disclosure || 'Comparison only. Checkout is not available in Phase 1.') + '</p>' +
        '<button type="button" class="product-action" disabled aria-describedby="' + describedBy + '">' + (locked ? 'Prerequisite required' : 'Purchasing comes later') + '</button>' +
      '</div>' +
    '</article>';
  }

  function showMessage(title, message, retry) {
    statusEl.className = 'catalogue-status is-message';
    statusEl.innerHTML = '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p>' +
      (retry ? '<button type="button" id="retry-catalogue">Try again</button>' : '<a href="/learner/book.html">Browse Pay As You Go Lessons</a>');
    if (retry) document.getElementById('retry-catalogue').addEventListener('click', loadCatalogue);
  }

  function renderCatalogue(data) {
    var products = Array.isArray(data.products) ? data.products : [];
    var flexible = products.filter(function (product) { return product.product_type === 'flexible_hours'; });
    var phases = products.filter(function (product) { return product.product_type === 'guaranteed_phase'; });
    var curriculum = products.filter(function (product) { return product.product_type === 'full_curriculum'; });
    var manoeuvres = products.filter(function (product) { return product.product_type === 'manoeuvres'; });
    if (!flexible.length || phases.length < 3 || !curriculum.length || manoeuvres.length < 2) {
      showMessage('Catalogue not ready', 'This school catalogue is incomplete. No package can be purchased; please use Pay As You Go Lessons for now.', false);
      return;
    }

    document.getElementById('flexible-products').innerHTML = flexible.map(function (product) {
      return renderProduct(product, { label: 'School-wide flexible hours' });
    }).join('');
    document.getElementById('phase-products').innerHTML = phases.map(function (product, index) {
      return '<div class="phase-product' + (product.eligibility && product.eligibility.state === 'locked' ? ' locked' : '') + '">' +
        '<div class="phase-number">Phase ' + (index + 1) + '</div>' +
        renderProduct(product, { label: product.eligibility && product.eligibility.state === 'locked' ? 'Assessment gate' : 'Starting phase' }) +
      '</div>';
    }).join('');
    document.getElementById('full-curriculum-product').innerHTML = curriculum.map(function (product) {
      return renderProduct(product, { label: 'Whole-path option' });
    }).join('');
    document.getElementById('manoeuvres-products').innerHTML = manoeuvres.map(function (product) {
      var variant = product.content && product.content.variant === 'challenge' ? 'Optional Challenge' : 'No promotional tasks';
      return renderProduct(product, { label: variant });
    }).join('');
    statusEl.hidden = true;
    contentEl.hidden = false;
  }

  async function loadCatalogue() {
    statusEl.hidden = false;
    statusEl.className = 'catalogue-status';
    statusEl.innerHTML = '<div class="skeleton-line skeleton-line-wide"></div><div class="skeleton-line"></div>';
    contentEl.hidden = true;
    try {
      var response = await fetch(catalogueUrl(), { credentials: 'include' });
      var data = await response.json();
      if (!response.ok) {
        if (data.code === 'LEARNER_PACKAGES_DISABLED') {
          showMessage('Packages are not available here yet', 'This school has not enabled the learner Packages catalogue. Pay As You Go Lessons and existing Lesson Credit remain unchanged.', false);
          return;
        }
        throw new Error(data.message || 'The catalogue could not be loaded.');
      }
      renderCatalogue(data);
    } catch (error) {
      showMessage('We could not load Packages', error.message || 'Please try again.', true);
    }
  }

  loadCatalogue();
})();
