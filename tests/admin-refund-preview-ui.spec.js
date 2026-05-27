const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const portalHtml = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.html'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.js'), 'utf8');

function sourceFor(name) {
  const markers = [`async function ${name}`, `function ${name}`];
  const start = markers.map(m => portalJs.indexOf(m)).find(i => i >= 0);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const nextFunction = portalJs.indexOf('\nfunction ', start + 1);
  const nextAsyncFunction = portalJs.indexOf('\nasync function ', start + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter(i => i >= 0);
  const end = candidates.length ? Math.min(...candidates) : portalJs.length;
  return portalJs.slice(start, end);
}

test.describe('admin refund preview UI', () => {
  test('adds a preview-only admin surface in the portal', () => {
    expect(portalHtml).toContain('data-section="refund-preview"');
    expect(portalHtml).toContain('id="section-refund-preview"');
    expect(portalHtml).toContain('Refund Preview');
    expect(portalHtml).toContain('id="refund-preview-form"');
    expect(portalHtml).toContain('id="refund-preview-result"');
    expect(portalJs).toContain('Execution is coming in a later reviewed slice');
    expect(portalHtml).toContain('cookie-consent.js');
    expect(portalHtml).toContain('posthog-loader.js');
  });

  test('calls only the read-only refund-preview endpoint', () => {
    const submit = sourceFor('submitRefundPreview');

    expect(submit).toContain("fetchAdmin('/api/admin?action=refund-preview'");
    expect(submit).toContain("method: 'POST'");
    expect(submit).toContain('body: JSON.stringify(buildRefundPreviewPayload())');
    expect(portalJs).not.toContain("fetchAdmin('/api/admin?action=execute-refund'");
    expect(portalJs).not.toContain('data-action="execute-refund"');
    expect(portalJs).not.toContain('operator_go');
  });

  test('does not collect or calculate refund amounts client-side', () => {
    const build = sourceFor('buildRefundPreviewPayload');

    expect(portalHtml).not.toContain('gross_refund_pence');
    expect(portalHtml).not.toContain('refunded_minutes');
    expect(build).not.toContain('gross_refund_pence');
    expect(build).not.toContain('refunded_minutes');
    expect(build).toContain('lesson_booking_id');
    expect(build).toContain('credit_transaction_id');
    expect(build).toContain('booking_credit_source_id');
  });

  test('explains refund type choices with preview-only operator scenarios', () => {
    const update = sourceFor('updateRefundSourceFields');

    expect(portalHtml).toContain('id="refund-type-help"');
    expect(portalHtml).toContain('This screen is preview-only and does not issue refunds.');
    expect(portalJs).toContain('REFUND_TYPE_GUIDANCE');
    expect(portalJs).toContain('Refund a normal paid lesson directly tied to a booking.');
    expect(portalJs).toContain('Example: learner paid for a one-off lesson by card and that specific lesson needs refunding.');
    expect(portalJs).toContain('Example: already-paid-out booking or another case requiring manual bank review.');
    expect(update).toContain('typeMeaning.textContent = typeHelp.meaning');
    expect(update).toContain('typeExample.textContent = typeHelp.example');
  });

  test('renders success, blocked/manual review evidence, and returned server values', () => {
    const render = sourceFor('renderRefundPreviewResult');

    expect(render).toContain('Blocked');
    expect(render).toContain('Manual review required');
    expect(render).toContain('Preview ready');
    expect(render).toContain('Gross refund');
    expect(render).toContain('Processing fee');
    expect(render).toContain('Returned amount');
    expect(render).toContain('Operator context');
    expect(portalJs).toContain('Recommended action');
    expect(portalJs).toContain('Learner email');
    expect(portalJs).toContain('Payment channel');
    expect(portalJs).toContain('manual_bank_review_required');
    expect(portalJs).toContain('Manual bank review required');
    expect(portalJs).toContain('Execute eligible');
    expect(render).toContain('Preview only. No refund has been issued.');
    expect(render).toContain('Ledger line evidence');
    expect(render).toContain('Fee evidence');
    expect(render).toContain('Stripe references');
    expect(render).toContain('Metadata');
    expect(render).toContain('This screen is preview-only and cannot mutate Stripe, bookings, credits, payouts, or refund ledger rows.');
  });

  test('lets booking rows prefill the preview without executing anything', () => {
    expect(portalJs).toContain('data-action="open-refund-preview"');
    expect(portalJs).toContain('openRefundPreviewFromBooking(parseInt(t.dataset.id, 10))');
    expect(sourceFor('openRefundPreviewFromBooking')).toContain("type.value = 'direct_slot'");
  });
});
