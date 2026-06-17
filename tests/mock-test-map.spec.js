const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

function functionBody(source, name) {
  const start = source.indexOf('function ' + name);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('mock test fault map demotion', () => {
  test('mock test results do not expose unsaved fault-map pinning', () => {
    const html = read('public/learner/mock-test.html');
    const js = read('public/learner/mock-test.js');

    expect(html).not.toContain('id="btn-show-map"');
    expect(html).not.toContain('Place faults on map');
    expect(html).not.toContain('unpkg.com/leaflet');
    expect(js).not.toContain("document.getElementById('btn-show-map').classList.remove('hidden')");
  });

  test('starting a mock test no longer asks for location for unsaved pins', () => {
    const body = functionBody(read('public/learner/mock-test.js'), 'startDriving');

    expect(body).not.toContain('navigator.geolocation');
    expect(body).not.toContain('navigator.permissions.query');
    expect(body).not.toContain('getCurrentPosition');
    expect(body).not.toContain('startGpsTracking();');
    expect(body).toContain('requestWakeLock();');
  });

  test('mock-test persistence still only stores route and formal fault records', () => {
    const learnerApi = read('api/learner.js');

    expect(learnerApi).toContain('INSERT INTO mock_tests (learner_id, school_id, mode, route_id, instructor_id)');
    expect(learnerApi).toContain('INSERT INTO mock_test_faults (mock_test_id, school_id, part, skill_key, sub_key, driving_faults, serious_faults, dangerous_faults, supervisor_rating)');
    expect(learnerApi).not.toContain('fault_lat');
    expect(learnerApi).not.toContain('fault_lng');
    expect(learnerApi).not.toContain('gps_track');
    expect(learnerApi).not.toContain('placed_fault');
  });
});
