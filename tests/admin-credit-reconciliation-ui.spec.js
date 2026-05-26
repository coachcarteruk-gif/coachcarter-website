const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const portalJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'portal.js'), 'utf8');

function functionBody(name) {
  const start = portalJs.indexOf(`function ${name}`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const next = portalJs.indexOf('\nfunction ', start + 1);
  return portalJs.slice(start, next === -1 ? undefined : next);
}

test.describe('admin credit reconciliation inspection UI', () => {
  test('adds an inspection-only card to the existing learner credit surface', () => {
    expect(portalJs).toContain('renderCreditReconciliationInspectionCard()');
    expect(portalJs).toContain('id="credit-reconciliation-inspection-card"');
    expect(portalJs).toContain('Credit reconciliation inspection');
    expect(portalJs).toContain('Inspection only. This checks Stripe and existing credit transactions; no credit is granted.');
    expect(portalJs).toContain('Stripe PaymentIntent ID');
    expect(portalJs).toContain('Checkout Session ID');
    expect(portalJs).toContain('Charge ID');
    expect(portalJs).toContain('Reason/note');
  });

  test('submits only a dry-run inspection request', () => {
    const submit = functionBody('submitCreditReconciliationInspection');

    expect(submit).toContain("fetchAdmin('/api/admin?action=credit-reconciliation'");
    expect(submit).toContain('dry_run: true');
    expect(submit).toContain('payment_intent_id: paymentIntentId || undefined');
    expect(submit).toContain('session_id: sessionId || undefined');
    expect(submit).toContain('charge_id: chargeId || undefined');
    expect(submit).toContain('reason: reason || undefined');
    expect(submit).toContain('Inspecting only; no credit will be granted.');
    expect(submit).toContain('Inspection complete. No credit was granted.');
  });

  test('renders ready, already-reconciled, and manual-review outcomes as no-credit states', () => {
    const render = functionBody('renderCreditReconciliationInspectionResult');

    expect(render).toContain('Ready preview: ');
    expect(render).toContain("renderReconKV('Learner id', p.learner_id)");
    expect(render).toContain("renderReconKV('Instructor id', p.instructor_id)");
    expect(render).toContain("renderReconKV('Minutes', p.minutes)");
    expect(render).toContain("renderReconKV('Amount', fmtPence(Number(p.amount_pence || 0)))");
    expect(render).toContain("renderReconKV('Stripe fee', fmtPence(Number(p.stripe_fee_pence || 0)))");
    expect(render).toContain("renderReconKV('Session id', p.stripe_session_id || data.stripe?.session_id)");
    expect(render).toContain("renderReconKV('PaymentIntent id', p.stripe_payment_intent_id || data.stripe?.payment_intent_id)");
    expect(render).toContain("renderReconKV('Charge id', p.stripe_charge_id || data.stripe?.charge_id)");
    expect(render).toContain('Already reconciled: ');
    expect(render).toContain("renderReconKV('Transaction id', data.transaction_id || data.existing_credit_transaction?.id)");
    expect(render).toContain("renderReconKV('Created at', data.created_at ? new Date(data.created_at).toLocaleString('en-GB') : data.existing_credit_transaction?.created_at)");
    expect(render).toContain('Manual review: ');
    expect(render).toContain('Inspection only. No credit was granted.');
  });

  test('does not expose a reconciliation grant, apply, or confirm control', () => {
    expect(portalJs).toContain('data-action="submit-credit-reconciliation-inspection"');
    expect(portalJs).toContain('Inspect only');
    expect(portalJs).not.toContain('submit-credit-reconciliation-grant');
    expect(portalJs).not.toContain('submit-credit-reconciliation-apply');
    expect(portalJs).not.toContain('confirm-credit-reconciliation');
    expect(portalJs).not.toContain('Grant reconciliation');
    expect(portalJs).not.toContain('Apply reconciliation');
    expect(portalJs).not.toContain('Confirm reconciliation');
  });
});
