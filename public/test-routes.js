// ── Test Route Configuration ──────────────────────────────────────────────────
// Each centre has a list of routes with Google Maps direction links.
// Used by the mock test page to let learners select and navigate a route.

window.CC_TEST_ROUTES = (function() {
  'use strict';

  var CENTRES = [
    {
      id: 'reading',
      name: 'Reading (Elgar Road South)',
      centre: { lat: 51.454, lng: -1.005 },
      zoom: 13,
      routes: [
        { id: 'reading_1',  name: 'Route 1',  mapsUrl: 'https://maps.app.goo.gl/yQzthcpeS6buYaLZ7' },
        { id: 'reading_2',  name: 'Route 2',  mapsUrl: 'https://maps.app.goo.gl/PCgLVYBpaVEUTKpi8' },
        { id: 'reading_3',  name: 'Route 3',  mapsUrl: 'https://maps.app.goo.gl/nJgjgnrWNRS5Wwbn7' },
        { id: 'reading_4',  name: 'Route 4',  mapsUrl: 'https://maps.app.goo.gl/szz8aD24d1iiGjTg8' },
        { id: 'reading_5',  name: 'Route 5',  mapsUrl: 'https://maps.app.goo.gl/bg8ofuuMJdqj3nT76' },
        { id: 'reading_6',  name: 'Route 6',  mapsUrl: 'https://maps.app.goo.gl/pz3aDq9Rg13dRufA9' },
        { id: 'reading_7',  name: 'Route 7',  mapsUrl: 'https://maps.app.goo.gl/muBb1Lci8RCM14S1A' },
        { id: 'reading_8',  name: 'Route 8',  mapsUrl: 'https://maps.app.goo.gl/qS9FcBQmrN5eoYUe8' },
        { id: 'reading_9',  name: 'Route 9',  mapsUrl: 'https://maps.app.goo.gl/xakGJoF7ZFVTZtNc9' },
        { id: 'reading_10', name: 'Route 10', mapsUrl: 'https://maps.app.goo.gl/aB7TwPGuWZd7yF8CA' }
      ]
    }
  ];

  function getCentre(centreId) {
    for (var i = 0; i < CENTRES.length; i++) {
      if (CENTRES[i].id === centreId) return CENTRES[i];
    }
    return CENTRES[0];
  }

  function getRoute(centreId, routeId) {
    var centre = getCentre(centreId);
    for (var i = 0; i < centre.routes.length; i++) {
      if (centre.routes[i].id === routeId) return centre.routes[i];
    }
    return null;
  }

  return {
    CENTRES: CENTRES,
    getCentre: getCentre,
    getRoute: getRoute
  };
})();
