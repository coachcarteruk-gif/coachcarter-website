// Mirrors the in-card slot summary (#summaryBar, owned by free-trial.js) into
// the mobile sticky submit dock (#stickySummary). Display-only: free-trial.js
// stays the single owner of selection state and booking logic.
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var source = document.getElementById('summaryBar');
    var target = document.getElementById('stickySummary');
    if (!source || !target || typeof MutationObserver === 'undefined') return;

    function sync() {
      var visible = source.style.display !== 'none' && source.textContent.trim();
      target.textContent = visible ? source.textContent.trim() : '';
    }

    new MutationObserver(sync).observe(source, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
    sync();
  });
})();
