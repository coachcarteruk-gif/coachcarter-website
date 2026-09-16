(function () {
  'use strict';

  function render(discount) {
    if (!discount || discount.eligible !== true) return;
    var until = new Date(discount.eligibleUntil);
    if (isNaN(until.getTime())) return;
    var banner = document.createElement('aside');
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

  fetch('/api/credits?action=post-trial-discount', { credentials: 'include' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(render)
    .catch(function () {});
})();
