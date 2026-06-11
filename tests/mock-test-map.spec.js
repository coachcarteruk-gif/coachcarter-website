const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

test.describe('mock test fault map', () => {
  test('site policy allows mock tests to request same-origin geolocation', () => {
    const middleware = read('middleware.js');

    expect(middleware).toContain("Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)'");
    expect(middleware).not.toContain('geolocation=()');
  });

  test('mock test map has a visible fallback when Leaflet fails to load', () => {
    const html = read('public/learner/mock-test.html');
    const js = read('public/learner/mock-test.js');

    expect(html).toContain('.map-fallback');
    expect(js).toContain('function showMapFallback(message)');
    expect(js).toContain("if (typeof L === 'undefined')");
    expect(js).toContain('Open selected route in Google Maps');
  });

  test('mock test map recentres when GPS only captured a single point', () => {
    const js = read('public/learner/mock-test.js');

    expect(js).toContain('} else if (latLngs.length === 1) {');
    expect(js).toContain('faultMap.setView(latLngs[0], 16)');
  });
});
