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

function cleanPreview(overrides = {}) {
  return {
    ok: true,
    blocked: false,
    manual_review_required: false,
    recommended_operator_action: 'execute_eligible',
    refund_type: 'credit_purchase',
    gross_refund_pence: 8250,
    processing_fee_withheld_pence: 144,
    net_refund_pence: 8106,
    reason: 'approved unused credit refund',
    learner_name: 'Learner One',
    learner_email: 'learner@example.test',
    instructor_name: 'Instructor One',
    payment_source: 'credit_transaction',
    payment_channel: 'stripe',
    lines: [{
      lesson_booking_id: null,
      credit_transaction_id: 101,
      booking_credit_source_id: null,
      learner_id: 61,
      instructor_id: 4,
      gross_pence_removed: 8250,
      source_fee_pence_used: 144,
      fee_withheld_pence: 144,
      net_refund_pence: 8106,
      minutes_adjusted: 90,
    }],
    fee_evidence: { paymentIntentId: 'pi_credit', chargeId: 'ch_credit' },
    stripe: { stripePaymentIntentId: 'pi_credit', stripeChargeId: 'ch_credit' },
    metadata: { source: 'test' },
    warnings: [],
    ...overrides,
  };
}

function executeSuccess(overrides = {}) {
  return {
    ok: true,
    refund_executed: true,
    idempotent_replay: false,
    refund_event: {
      id: 700,
      status: 'executed',
      net_refund_pence: 8106,
      stripe_refund_id: 're_test_123',
      idempotency_key: 'refund-execute-v1-credit-purchase-credit-101-test',
      lines: [{
        id: 1,
        credit_transaction_id: 101,
        credit_source_adjustment_id: 800,
        gross_pence_removed: 8250,
        source_fee_pence_used: 144,
        fee_withheld_pence: 144,
        net_refund_pence: 8106,
        minutes_adjusted: 90,
      }],
    },
    ...overrides,
  };
}

async function setupRefundHarness(page, {
  previewResponse = cleanPreview(),
  previewOk = true,
  executeResponse = executeSuccess(),
  executeOk = true,
} = {}) {
  await page.route('http://coachcarter.test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><body></body></html>',
  }));
  await page.goto('http://coachcarter.test/admin/portal.html');
  await page.setContent(`
    <div id="admin-name"></div>
    <div id="admin-email"></div>
    <button id="logout-btn"></button>
    <div id="sidebar"></div>
    <div id="sidebar-overlay"></div>
    <div id="toast"></div>
    <nav class="sidebar-nav"></nav>
    <div id="section-refund-preview" class="section active">
      <form id="refund-preview-form">
        <select id="refund-type">
          <option value="direct_slot">Lesson booking</option>
          <option value="credit_purchase">Credit purchase</option>
          <option value="repeat_offer_partial">Repeat offer partial</option>
        </select>
        <label id="refund-source-label" for="refund-source-id"></label>
        <input id="refund-source-id">
        <div id="refund-source-help"></div>
        <div id="refund-type-help-meaning"></div>
        <div id="refund-type-help-example"></div>
        <textarea id="refund-reason"></textarea>
        <div id="refund-form-error"></div>
        <button type="submit" id="btn-refund-preview">Preview refund</button>
      </form>
      <span id="refund-preview-state"></span>
      <div id="refund-preview-result"></div>
    </div>
    <div id="stat-upcoming"></div>
    <div id="stat-today"></div>
    <div id="stat-week"></div>
    <div id="stat-learners"></div>
    <div id="stat-instructors"></div>
    <div id="stat-revenue"></div>
    <div id="stat-awaiting"></div>
    <div id="stat-disputed"></div>
    <table><tbody id="dash-upcoming-body"></tbody></table>
  `);
  await page.evaluate(({ previewResponse, previewOk, executeResponse, executeOk }) => {
    localStorage.setItem('cc_admin', JSON.stringify({ admin: { name: 'Admin', email: 'admin@example.test' } }));
    window.__adminFetchCalls = [];
    window.__previewResponse = previewResponse;
    window.__previewOk = previewOk;
    window.__executeResponse = executeResponse;
    window.__executeOk = executeOk;
    window.ccAdminAuth = {
      logout() {},
      fetchAuthed: async (url, options = {}) => {
        window.__adminFetchCalls.push({ url, options });
        if (url.includes('verify')) return { ok: true, json: async () => ({ ok: true }) };
        if (url.includes('dashboard-stats')) {
          return {
            ok: true,
            json: async () => ({
              bookings: { upcoming: 0, awaiting_confirmation: 0, disputed: 0 },
              today: 0,
              this_week: 0,
              learners: { total_learners: 0 },
              instructors: { active_instructors: 0 },
              revenue: { total_revenue_pence: 0 },
            }),
          };
        }
        if (url.includes('all-bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
        if (url.includes('refund-preview')) {
          return { ok: window.__previewOk, json: async () => window.__previewResponse };
        }
        if (url.includes('execute-refund')) {
          return { ok: window.__executeOk, json: async () => window.__executeResponse };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      },
    };
  }, { previewResponse, previewOk, executeResponse, executeOk });
  await page.addScriptTag({ content: portalJs });
}

async function requestPreview(page, type = 'credit_purchase') {
  await page.selectOption('#refund-type', type);
  await page.fill('#refund-source-id', type === 'credit_purchase' ? '101' : '7001');
  await page.fill('#refund-reason', 'approved unused credit refund');
  await page.click('#btn-refund-preview');
}

async function fetchCalls(page) {
  return page.evaluate(() => window.__adminFetchCalls.map((call) => ({
    url: call.url,
    body: call.options?.body ? JSON.parse(call.options.body) : null,
  })));
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
    expect(portalJs).toContain('Preview complete. No refund has been issued yet.');
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

  test('clean preview enables execute and posts confirmation plus visible idempotency', async ({ page }) => {
    await setupRefundHarness(page);
    await requestPreview(page);

    await expect(page.locator('#btn-refund-execute')).toBeVisible();
    await expect(page.locator('#refund-execute-idempotency-key')).toHaveValue(/refund-execute-v1-credit-purchase-credit-101-/);
    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND_CONFIRMED');
    await page.click('#btn-refund-execute');

    await expect(page.locator('#refund-preview-result')).toContainText('Refund executed');
    await expect(page.locator('#refund-preview-result')).toContainText('Stripe refund');
    await expect(page.locator('#refund-preview-result')).toContainText('re_test_123');
    await expect(page.locator('#refund-preview-result')).toContainText('Refund event');
    await expect(page.locator('#refund-preview-result')).toContainText('CSA adjustment');
    await expect(page.locator('#refund-preview-result')).toContainText('800');
    await expect(page.locator('#refund-preview-result')).not.toContainText('No refund has been issued yet.');

    const executeCall = (await fetchCalls(page)).find((call) => call.url.includes('execute-refund'));
    expect(executeCall.body).toMatchObject({
      refund_type: 'credit_purchase',
      credit_transaction_id: 101,
      operator_go: 'EXECUTE_REFUND_CONFIRMED',
    });
    expect(executeCall.body.idempotency_key).toMatch(/^refund-execute-v1-credit-purchase-credit-101-/);
  });

  test('blocked and manual-review previews cannot execute from the UI', async ({ page }) => {
    await setupRefundHarness(page, {
      previewResponse: cleanPreview({
        blocked: true,
        manual_review_required: true,
        recommended_operator_action: 'blocked',
        code: 'BOOKING_ALREADY_PAID_OUT',
        message: 'Already paid out',
      }),
    });
    await requestPreview(page);
    await expect(page.locator('#refund-preview-result')).toContainText('Blocked previews cannot execute from the admin UI.');
    await expect(page.locator('#btn-refund-execute')).toHaveCount(0);

    await setupRefundHarness(page, {
      previewResponse: cleanPreview({
        manual_review_required: true,
        recommended_operator_action: 'manual_review_required',
        message: 'Manual review required',
      }),
    });
    await requestPreview(page);
    await expect(page.locator('#refund-preview-result')).toContainText('Manual-review previews cannot execute from the admin UI.');
    await expect(page.locator('#btn-refund-execute')).toHaveCount(0);
  });

  test('missing idempotency or confirmation blocks locally before execute POST', async ({ page }) => {
    await setupRefundHarness(page);
    await requestPreview(page);

    await page.click('#btn-refund-execute');
    await expect(page.locator('#refund-execute-error')).toContainText('Enter the exact confirmation phrase');
    expect((await fetchCalls(page)).filter((call) => call.url.includes('execute-refund'))).toHaveLength(0);

    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND_CONFIRMED');
    await page.locator('#refund-execute-idempotency-key').evaluate((el) => { el.value = ''; });
    await page.click('#btn-refund-execute');
    await expect(page.locator('#refund-execute-error')).toContainText('A visible idempotency key is required');
    expect((await fetchCalls(page)).filter((call) => call.url.includes('execute-refund'))).toHaveLength(0);
  });

  test('idempotent replay is displayed without no-refund copy', async ({ page }) => {
    await setupRefundHarness(page, {
      executeResponse: executeSuccess({
        refund_executed: false,
        idempotent_replay: true,
        refund_event: {
          ...executeSuccess().refund_event,
          id: 777,
          stripe_refund_id: 're_existing',
          credit_source_adjustment_id: undefined,
        },
      }),
    });
    await requestPreview(page);
    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND_CONFIRMED');
    await page.click('#btn-refund-execute');

    await expect(page.locator('#refund-preview-result')).toContainText('Idempotent replay returned existing refund');
    await expect(page.locator('#refund-preview-result')).toContainText('re_existing');
    await expect(page.locator('#refund-preview-result')).not.toContainText('No refund has been issued yet.');
  });

  test('failure with a Stripe refund id shows incident copy instead of no-refund copy', async ({ page }) => {
    await setupRefundHarness(page, {
      executeOk: false,
      executeResponse: {
        error: true,
        code: 'CREDIT_BALANCE_ADJUST_FAILED',
        message: 'Stripe refund succeeded but credit balance adjustment failed; manual review is required.',
        stripe_refund_id: 're_moved_money',
      },
    });
    await requestPreview(page);
    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND_CONFIRMED');
    await page.click('#btn-refund-execute');

    await expect(page.locator('#refund-preview-result')).toContainText('Treat this as an incident');
    await expect(page.locator('#refund-preview-result')).toContainText('re_moved_money');
    await expect(page.locator('#refund-preview-result')).not.toContainText('No refund has been issued yet.');
  });
});
