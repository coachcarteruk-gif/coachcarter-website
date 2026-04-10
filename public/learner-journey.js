(function () {
  'use strict';

  // ── Reveal animations ──
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.tier-card, .tl-item, .reveal').forEach(el => observer.observe(el));

  // ── Tab switching ──
  function switchTab(tab) {
    document.querySelectorAll('.price-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.price-panel').forEach(p => p.classList.remove('active'));

    if (tab === 'payg') {
      document.querySelectorAll('.price-tab')[0].classList.add('active');
      document.getElementById('panel-payg').classList.add('active');
      document.getElementById('price-urgency').style.display = 'none';
      document.getElementById('price-progress').style.display = 'none';
    } else {
      document.querySelectorAll('.price-tab')[1].classList.add('active');
      document.getElementById('panel-guarantee').classList.add('active');
      document.getElementById('price-urgency').style.display = 'flex';
      document.getElementById('price-progress').style.display = 'block';
    }
  }

  // ── Load live guarantee price ──
  async function loadGuaranteePrice() {
    try {
      const res = await fetch('/api/guarantee-price?t=' + Date.now());
      const data = await res.json();

      const price = data.current_price || 1500;
      const base = data.base_price || 1500;
      const cap = data.cap || 3000;
      const purchases = data.purchases || 0;

      // Update displayed price
      document.getElementById('guarantee-price-display').textContent =
        '£' + price.toLocaleString('en-GB');

      // Update progress bar
      const pct = Math.min(((price - base) / (cap - base)) * 100, 100);
      document.getElementById('price-progress-fill').style.width = pct + '%';
      document.getElementById('progress-start-price').textContent = '£' + base.toLocaleString('en-GB');
      document.getElementById('progress-current').textContent = '£' + price.toLocaleString('en-GB');
      document.getElementById('progress-cap-price').textContent = '£' + cap.toLocaleString('en-GB');

    } catch (err) {
      console.warn('Could not load guarantee price, using fallback:', err);
      // Fallback already shows £1,500 from the HTML
    }
  }

  loadGuaranteePrice();

(function wire() {
  document.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
  });
})();
})();
