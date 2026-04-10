(function () {
  'use strict';
  var btn = document.querySelector('.offline button');
  if (btn) btn.addEventListener('click', function () { window.location.reload(); });
})();
