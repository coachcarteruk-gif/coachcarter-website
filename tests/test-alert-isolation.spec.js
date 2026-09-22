const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');

test('test configuration blocks operational emails even with inherited live alert settings', () => {
  // A fresh child proves the config handles inherited credentials, without ever
  // giving this test a working email transport or an actual recipient.
  const result = execFileSync(process.execPath, ['-e', `
    const assert = require('assert/strict');
    const nodemailer = require('nodemailer');
    let transportCalls = 0;
    nodemailer.createTransport = () => {
      transportCalls++;
      throw new Error('Email transport must not be reached in tests');
    };
    assert.equal(process.env.ERROR_ALERT_EMAIL, 'operator@example.invalid');
    require('./playwright.config');
    // Mirror the .env.local integration loaders: existing keys must win.
    if (process.env.ERROR_ALERT_EMAIL === undefined) process.env.ERROR_ALERT_EMAIL = 'operator@example.invalid';
    assert.equal(process.env.ERROR_ALERT_EMAIL, '');
    const { reportError, sendAlertEmail } = require('./api/_error-alert');
    reportError('/api/offers', new Error('synthetic session save failure'));
    sendAlertEmail({ subject: 'synthetic operational alert' }).then(sent => {
      assert.equal(sent, false);
      assert.equal(transportCalls, 0);
      console.log('alerts isolated');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ERROR_ALERT_EMAIL: 'operator@example.invalid' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(result.trim()).toBe('alerts isolated');
});
