const { content } = require('./flexible-bank-database');
const product = { product_id: 20, product_version_id: 30, product_slug: 'flexible-15-hours',
  product_type: 'flexible_hours', price_pence: 81000, currency: 'GBP', content,
  customer_terms_version: 'flexible-hours-v1' };
function responseFor(action) {
  if (action === 'admin-scopes') return { requires_explicit_selection: false, schools: [] };
  if (action === 'admin-list') return { products: [], school: { name: 'Example school' } };
  if (action === 'bank-purchase-options') return { ok: true, enabled: true, disclosure_version: 'flexible-hours-consumer-rights-v1',
    products: [product], learners: [{ id: 41, name: 'Alex Example', email: 'alex@example.test', remaining_minutes: 0 }] };
  if (action === 'admin-overview') return { purchases: [{ id: 1, source_id: 1, learner_name: 'Alex Example', product_slug: 'flexible-15-hours',
    amount_pence: 81000, payment_provider: 'bank_transfer', bank_reference: 'BANK-EXAMPLE-1', received_on: '2026-09-24',
    remaining_units: 30, rate_pence_per_unit: 2700, refundable_value_pence: 81000 }] };
  if (action === 'record-bank-purchase') return { ok: true, reused: false, minutes_added: 900, purchase_id: 1, source_id: 1, amount_pence: 81000 };
  return {};
}
module.exports = { responseFor };
