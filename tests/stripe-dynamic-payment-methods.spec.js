const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function checkoutSessionPayloads(source) {
  const marker = 'stripe.checkout.sessions.create({';
  const payloads = [];
  let searchFrom = 0;

  while (true) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) return payloads;

    const start = source.indexOf('{', markerIndex);
    let depth = 0;
    let end = start;

    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) break;
    }

    payloads.push(source.slice(start, end + 1));
    searchFrom = end + 1;
  }
}

test('Checkout Sessions rely on Stripe dynamic payment methods', () => {
  const checkoutFiles = [
    'api/advisor.js',
    'api/credits.js',
    'api/offers.js',
    'api/slots.js',
  ];

  for (const relativePath of checkoutFiles) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const payloads = checkoutSessionPayloads(source);

    expect(payloads.length, `${relativePath} should create at least one Checkout Session`).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(payload, `${relativePath} should not pin Checkout to card/Klarna`).not.toContain('payment_method_types');
    }
  }
});
