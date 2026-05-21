// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function extractFunctionBody(source, functionName) {
  const marker = `async function ${functionName}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const openBrace = source.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }

  throw new Error(`Could not find end of ${functionName}`);
}

test.describe('webhook slot booking regressions', () => {
  test('handleSlotBooking uses the deductResult balance for the confirmation email', () => {
    const webhookPath = path.join(__dirname, '..', 'api', 'webhook.js');
    const source = fs.readFileSync(webhookPath, 'utf8');
    const body = extractFunctionBody(source, 'handleSlotBooking');

    expect(body).toContain('const deductResult = await lockBalanceAdjustLCB');
    expect(body).toContain('deductResult.balance_minutes');
    expect(body).not.toContain('deducted.balance_minutes');
  });
});
