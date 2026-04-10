// CSP-compatible replacement for the inline onload="this.media='all'"
// font-loading pattern. Scans the document for stylesheet links marked with
// data-swap-media and switches their media attribute to 'all' once they load.
//
// Usage in HTML:
//   <link rel="preload" as="style" href="...">
//   <link href="..." rel="stylesheet" media="print" data-swap-media>
//   <script src="/shared/font-swap.js"></script>
//
// Must be loaded AFTER the link tags in <head>.
(function () {
  'use strict';
  var links = document.querySelectorAll('link[data-swap-media][rel="stylesheet"]');
  for (var i = 0; i < links.length; i++) {
    (function (link) {
      // If the stylesheet is already parsed by the time this script runs,
      // swap immediately so the styles apply without waiting for a load event.
      if (link.sheet) {
        link.media = 'all';
        return;
      }
      link.addEventListener('load', function () { link.media = 'all'; }, { once: true });
    })(links[i]);
  }
})();
