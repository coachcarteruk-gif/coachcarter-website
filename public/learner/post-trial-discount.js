(function () {
  'use strict';

  var banner = null;
  var signature;
  var timer;
  var busy = false;

  function render(discount) {
    var until = new Date(discount && discount.eligibleUntil);
    var active = discount && discount.eligible === true && until.getTime() > Date.now();
    var nextSignature = active ? discount.discountPct + ':' + until.toISOString() : 'inactive';
    if (signature === nextSignature) return;
    if (signature !== undefined && signature !== nextSignature) {
      window.dispatchEvent(new CustomEvent('cc:post-trial-discount-changed'));
    }
    signature = nextSignature;
    if (banner) banner.remove();
    banner = null;
    if (!active) return;
    banner = document.createElement('aside');
    banner.className = 'post-trial-discount-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'margin:12px auto;padding:12px 16px;max-width:1100px;border:1px solid #f58321;border-radius:10px;background:#fff4ec;color:#5c310c;font:600 14px/1.4 Lato,sans-serif;';
    banner.textContent = discount.discountPct + '% post-trial discount active until '
      + until.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
      + '. It is applied automatically at checkout.';
    var main = document.querySelector('main, .main, .dashboard-main, .page-content');
    if (main) main.insertBefore(banner, main.firstChild);
    else document.body.insertBefore(banner, document.body.firstChild);
  }

  function refresh() {
    if (busy || document.hidden) return;
    clearTimeout(timer);
    busy = true;
    var delay = 60000;
    fetch('/api/credits?action=post-trial-discount', { credentials: 'include', cache: 'no-store' })
      .then(function (response) {
        if (response.status === 401) delay = 0;
        if (!response.ok && response.status !== 401) throw new Error('Discount status unavailable');
        return response.ok ? response.json() : null;
      })
      .then(function (discount) {
        render(discount);
        if (discount && discount.eligible === true) {
          delay = Math.min(delay, Math.max(1000, new Date(discount.eligibleUntil).getTime() - Date.now()));
        }
      })
      .catch(function () {
        // Never leave an expired discount advertised after a network failure.
        if (signature && signature !== 'inactive' && new Date(signature.slice(signature.indexOf(':') + 1)).getTime() <= Date.now()) render(null);
      })
      .finally(function () {
        busy = false;
        if (delay) timer = setTimeout(refresh, delay);
      });
  }

  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
})();
