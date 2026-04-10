(function () {
  'use strict';
  // Early maintenance-mode redirect used on public-facing pages.
  fetch('/api/status')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.maintenance === true) {
        window.location.replace('/maintenance.html');
      }
    })
    .catch(function () { /* ignore */ });
})();
