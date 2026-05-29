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
  test('adds a guarded refund preview and execute surface in the portal', () => {
    expect(portalHtml).toContain('data-section="refund-preview"');
    expect(portalHtml).toContain('id="section-refund-preview"');
    expect(portalHtml).toContain('Refund Preview');
    expect(portalHtml).toContain('id="refund-preview-form"');
    expect(portalHtml).toContain('id="refund-preview-result"');
    expect(portalHtml).toContain('Execution controls appear only for clean supported previews.');
    expect(portalJs).toContain('REFUND_EXECUTE_CONFIRMATION');
    expect(portalJs).toContain('EXECUTE_REFUND_CONFIRMED');
    expect(portalHtml).toContain('cookie-consent.js');
    expect(portalHtml).toContain('posthog-loader.js');
  });

  test('previews through the read-only refund-preview endpoint and executes only through the gated endpoint', () => {
    const submit = sourceFor('submitRefundPreview');
    const execute = sourceFor('submitRefundExecute');

    expect(submit).toContain("fetchAdmin('/api/admin?action=refund-preview'");
    expect(submit).toContain("method: 'POST'");
    expect(submit).toContain('body: JSON.stringify(payload)');
    expect(execute).toContain("fetchAdmin('/api/admin?action=execute-refund'");
    expect(execute).toContain("method: 'POST'");
    expect(execute).toContain('body: JSON.stringify(payload)');
    expect(portalJs).toContain('data-action="execute-refund"');
    expect(sourceFor('buildRefundExecutePayload')).toContain('operator_go');
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
    expect(portalHtml).toContain('Preview first. Clean supported previews can then be executed through the gated backend path.');
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
    expect(portalJs).toContain('Reason');
    expect(portalJs).toContain('Learner email');
    expect(portalJs).toContain('Payment channel');
    expect(portalJs).toContain('manual_bank_review_required');
    expect(portalJs).toContain('Manual bank review required');
    expect(portalJs).toContain('Execute eligible');
    expect(render).toContain('Preview complete. No refund has been issued yet.');
    expect(render).toContain('Ledger line evidence');
    expect(render).toContain('Fee evidence');
    expect(render).toContain('Stripe references');
    expect(render).toContain('Metadata');
    expect(portalJs).toContain('This UI does not directly mutate bookings, payouts, credits, refund ledgers, or credit-source adjustments.');
  });

  test('allows clean execute only when the latest preview is supported by the backend', () => {
    const blocker = sourceFor('refundPreviewExecuteBlocker');
    const panel = sourceFor('renderRefundExecutePanel');

    expect(blocker).toContain('data.blocked');
    expect(blocker).toContain('Blocked previews cannot execute from the admin UI.');
    expect(blocker).toContain('data.manual_review_required');
    expect(blocker).toContain('Manual-review previews cannot execute from the admin UI.');
    expect(blocker).toContain("data.recommended_operator_action !== 'execute_eligible'");
    expect(blocker).toContain('booking_credit_source_id');
    expect(blocker).toContain('Booking-credit-source-line execution is not enabled in this slice.');
    expect(panel).toContain('Execution blocked in UI');
    expect(panel).toContain('Execute clean preview');
  });

  test('requires exact confirmation and visible stable idempotency before execute', () => {
    const keyBuilder = sourceFor('buildRefundExecuteIdempotencyKey');
    const buildExecute = sourceFor('buildRefundExecutePayload');
    const submitExecute = sourceFor('submitRefundExecute');

    expect(keyBuilder).toContain('refund-execute-v1-');
    expect(keyBuilder).toContain('simpleRefundHash(fingerprint)');
    expect(portalJs).toContain('id="refund-execute-idempotency-key" readonly');
    expect(buildExecute).toContain('idempotency_key: idempotencyKey');
    expect(buildExecute).toContain('operator_go: confirmation');
    expect(submitExecute).toContain('A visible idempotency key is required before execution.');
    expect(submitExecute).toContain('payload.operator_go !== REFUND_EXECUTE_CONFIRMATION');
    expect(submitExecute).toContain('Enter the exact confirmation phrase before executing.');
  });

  test('renders post-execute Stripe, ledger, CSA, and duplicate replay evidence', () => {
    const render = sourceFor('renderRefundExecuteResult');

    expect(render).toContain('Stripe refund');
    expect(render).toContain('Refund event');
    expect(render).toContain('Returned amount');
    expect(render).toContain('CSA adjustment');
    expect(render).toContain('Executed ledger lines');
    expect(render).toContain('Idempotent replay returned existing refund');
    expect(render).toContain('idempotent_replay');
  });

  test('lets booking rows prefill the preview without executing anything', () => {
    expect(portalJs).toContain('data-action="open-refund-preview"');
    expect(portalJs).toContain('openRefundPreviewFromBooking(parseInt(t.dataset.id, 10))');
    expect(sourceFor('openRefundPreviewFromBooking')).toContain("type.value = 'direct_slot'");
  });
});
