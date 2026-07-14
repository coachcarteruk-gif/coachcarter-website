const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('optional sidebar learner request cannot trigger the session-expired prompt', () => {
  const auth = fs.readFileSync(path.join(root, 'public/shared/learner-auth.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'public/sidebar.js'), 'utf8');

  expect(sidebar).toContain(
    "fetchAuthed('/api/learner?action=progress', { suppressSessionExpired: true })"
  );
  expect(auth).toContain('var suppressSessionExpired = options.suppressSessionExpired === true;');
  expect(auth).toContain('var hadStoredAuth = !!getAuth();');
  expect(auth).toContain('res.status === 401 && hadStoredAuth && !suppressSessionExpired');
  expect(auth).toContain('delete merged.suppressSessionExpired;');
});
