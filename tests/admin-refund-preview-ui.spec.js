const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const portalHtml = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.html'), 'utf8');
const portalJs = fs.readFileSync(path.join(root, 'public', 'admin', 'portal.js'), 'utf8');
const strippedPortalHtml = portalHtml.replace(/<script\b[\s\S]*?<\/script>/gi, '');

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
    reason: 'Approved clean refund',
    lines: [{
      credit_transaction_id: 101,
      learner_id: 61,
      instructor_id: 4,
      gross_pence_removed: 8250,
      source_fee_pence_used: 144,
      fee_withheld_pence: 144,
      net_refund_pence: 8106,
      minutes_adjusted: 90,
    }],
    fee_evidence: { source: 'credit_transactions.stripe_fee_pence', pence: 144 },
    stripe: { stripePaymentIntentId: 'pi_credit' },
    metadata: {},
    ...overrides,
  };
}

async function setupPortalPage(page, previews) {
  await page.route('https://admin.test/portal.html', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: strippedPortalHtml,
  }));
  await page.goto('https://admin.test/portal.html');
  await page.evaluate((queuedPreviews) => {
    localStorage.setItem('cc_admin', JSON.stringify({ admin: { name: 'Test Admin', email: 'admin@example.test' } }));
    window.__previewQueue = queuedPreviews;
    window.__executeCalls = [];
    window.__manualBankCalls = [];
    window.ccAdminAuth = {
      logout: () => {},
      fetchAuthed: async (url, options = {}) => {
        const json = (body, status = 200) => new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
        if (url.includes('action=verify')) return json({ ok: true });
        if (url.includes('action=dashboard-stats')) {
          return json({
            bookings: { upcoming: 0, awaiting_confirmation: 0, disputed: 0 },
            today: 0,
            this_week: 0,
            learners: { total_learners: 0 },
            instructors: { active_instructors: 0 },
            revenue: { total_revenue_pence: 0 },
          });
        }
        if (url.includes('action=all-bookings')) return json({ bookings: [] });
        if (url.includes('action=all-instructors')) return json({ instructors: [] });
        if (url.includes('action=refund-preview')) return json(window.__previewQueue.shift());
        if (url.includes('action=execute-refund')) {
          window.__executeCalls.push(JSON.parse(options.body || '{}'));
          return json({ error: true, code: 'SIMULATED_EXECUTE_HOLD', message: 'Simulated execute response.' }, 502);
        }
        if (url.includes('action=record-manual-bank-refund')) {
          window.__manualBankCalls.push(JSON.parse(options.body || '{}'));
          return json({ error: true, code: 'SIMULATED_MANUAL_BANK_HOLD', message: 'Simulated manual bank response.' }, 502);
        }
        return json({ ok: true });
      },
    };
  }, previews);
  await page.addScriptTag({ content: portalJs });
  await page.evaluate(() => {
    document.getElementById('section-refund-preview').classList.add('active');
  });
}

async function requestPreview(page, { type = 'credit_purchase', sourceId = '101', reason = 'Approved clean refund' } = {}) {
  await page.selectOption('#refund-type', type);
  await page.fill('#refund-source-id', sourceId);
  await page.fill('#refund-reason', reason);
  await page.click('#btn-refund-preview');
}

test.describe('admin refund preview UI', () => {
  test('adds a preview-to-execute admin surface in the portal', () => {
    expect(portalHtml).toContain('data-section="refund-preview"');
    expect(portalHtml).toContain('id="section-refund-preview"');
    expect(portalHtml).toContain('Refund Preview');
    expect(portalHtml).toContain('id="refund-preview-form"');
    expect(portalHtml).toContain('id="refund-preview-result"');
    expect(portalJs).toContain('REFUND_EXECUTE_CONFIRMATION');
    expect(portalJs).toContain('Clean preview can be executed');
    expect(portalHtml).toContain('cookie-consent.js');
    expect(portalHtml).toContain('posthog-loader.js');
  });

  test('previews read-only, then executes through only the approved backend path', () => {
    const submit = sourceFor('submitRefundPreview');
    const execute = sourceFor('executeRefundFromPreview');

    expect(submit).toContain("fetchAdmin('/api/admin?action=refund-preview'");
    expect(submit).toContain("method: 'POST'");
    expect(submit).toContain('body: JSON.stringify(previewPayload)');
    expect(execute).toContain("fetchAdmin('/api/admin?action=execute-refund'");
    expect(execute).toContain("operator_go: REFUND_EXECUTE_CONFIRMATION");
    expect(execute).toContain('idempotency_key: currentRefundPreview.idempotencyKey');
    expect(portalJs).toContain('data-action="execute-refund"');
  });

  test('does not collect or submit trusted refund amounts or scope client-side', () => {
    const build = sourceFor('buildRefundPreviewPayload');
    const execute = sourceFor('executeRefundFromPreview');

    expect(portalHtml).not.toContain('gross_refund_pence');
    expect(portalHtml).not.toContain('refunded_minutes');
    expect(build).not.toContain('gross_refund_pence');
    expect(build).not.toContain('refunded_minutes');
    expect(execute).not.toContain('gross_refund_pence');
    expect(execute).not.toContain('refunded_minutes');
    expect(execute).not.toContain('learner_id');
    expect(execute).not.toContain('instructor_id');
    expect(execute).not.toContain('school_id');
    expect(build).toContain('lesson_booking_id');
    expect(build).toContain('credit_transaction_id');
    expect(build).toContain('booking_credit_source_id');
  });

  test('explains refund type choices with preview-only operator scenarios', () => {
    const update = sourceFor('updateRefundSourceFields');

    expect(portalHtml).toContain('id="refund-type-help"');
    expect(portalHtml).toContain('Preview first. Clean automatic previews can be executed from the reviewed backend path after confirmation.');
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
    expect(render).toContain('Preview only. No refund has been issued yet.');
    expect(render).toContain('Ledger line evidence');
    expect(render).toContain('Fee evidence');
    expect(render).toContain('Stripe references');
    expect(render).toContain('Metadata');
    expect(render).toContain('admin?action=execute-refund');
    expect(render).toContain('It must not mutate booking status or payout rows.');
  });

  test('blocks blocked, manual-review, manual-bank, and BCS cases in the UI before execute', () => {
    const block = sourceFor('refundExecuteBlockReason');

    expect(block).toContain('data.blocked');
    expect(block).toContain('data.manual_review_required');
    expect(block).toContain("data.recommended_operator_action === 'manual_bank_review_required'");
    expect(block).toContain("data.recommended_operator_action !== 'execute_eligible'");
    expect(block).toContain('line.booking_credit_source_id');
    expect(block).toContain('Stripe refund target is missing');
  });

  test('requires the explicit confirmation phrase and a generated stable idempotency key', () => {
    const key = sourceFor('getRefundIdempotencyKey');
    const renderPanel = sourceFor('renderRefundExecutePanel');
    const updateButton = sourceFor('updateRefundExecuteButton');

    expect(portalJs).toContain("const REFUND_EXECUTE_CONFIRMATION = 'EXECUTE_REFUND_CONFIRMED'");
    expect(key).toContain('window.sessionStorage.getItem(storageKey)');
    expect(key).toContain('window.sessionStorage.setItem(storageKey, generated)');
    expect(renderPanel).toContain('Idempotency key');
    expect(renderPanel).toContain('id="refund-execute-confirmation"');
    expect(updateButton).toContain('input.value.trim() !== REFUND_EXECUTE_CONFIRMATION');
    expect(updateButton).toContain('refundPayloadMatchesCurrentForm');
  });

  test('adds a separate manual bank record surface for manual-review previews', () => {
    const renderPanel = sourceFor('renderManualBankRecordPanel');
    const record = sourceFor('recordManualBankRefundFromPreview');
    const block = sourceFor('manualBankRecordBlockReason');

    expect(portalJs).toContain("const REFUND_MANUAL_BANK_CONFIRMATION = 'RECORD_MANUAL_BANK_REFUND_CONFIRMED'");
    expect(renderPanel).toContain('Manual bank refund can be recorded');
    expect(renderPanel).toContain('id="refund-manual-bank-reference"');
    expect(renderPanel).toContain('id="btn-record-manual-bank-refund"');
    expect(record).toContain("fetchAdmin('/api/admin?action=record-manual-bank-refund'");
    expect(record).toContain('manual_bank_reference: reference');
    expect(record).toContain('operator_go: REFUND_MANUAL_BANK_CONFIRMATION');
    expect(record).not.toContain('gross_refund_pence');
    expect(record).not.toContain('learner_id');
    expect(block).toContain("data.recommended_operator_action === 'execute_eligible'");
    expect(block).toContain('Preview ledger line evidence is required');
  });

  test('renders execute result with refund event, Stripe reference, and ledger summary', () => {
    const render = sourceFor('renderExecutedRefundResult');

    expect(render).toContain('Refund event');
    expect(render).toContain('Stripe refund reference');
    expect(render).toContain('Ledger line summary');
    expect(render).toContain('renderRefundLines(event.lines || [])');
  });

  test('renders manual bank result with no-Stripe/no-mutation copy and ledger summary', () => {
    const render = sourceFor('renderManualBankRefundResult');

    expect(render).toContain('Manual bank refund recorded in the ledger');
    expect(render).toContain('No Stripe refund, booking update, payout mutation, or learner-credit mutation');
    expect(render).toContain('Manual bank reference');
    expect(render).toContain('renderRefundLines(event.lines || [])');
  });

  test('behaviorally gates execute, reuses idempotency, and sends only expected execute body', async ({ page }) => {
    await setupPortalPage(page, [cleanPreview()]);
    await requestPreview(page);

    const executeButton = page.locator('#btn-execute-refund');
    await expect(executeButton).toBeDisabled();

    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND');
    await expect(executeButton).toBeDisabled();

    await page.fill('#refund-execute-confirmation', 'EXECUTE_REFUND_CONFIRMED');
    await expect(executeButton).toBeEnabled();

    await executeButton.click();
    await expect(page.locator('#refund-execute-status')).toContainText('SIMULATED_EXECUTE_HOLD');

    await executeButton.click();
    const executeCalls = await page.evaluate(() => window.__executeCalls);
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[0].idempotency_key).toBeTruthy();
    expect(executeCalls[1].idempotency_key).toBe(executeCalls[0].idempotency_key);
    expect(executeCalls[0]).toEqual({
      refund_type: 'credit_purchase',
      credit_transaction_id: 101,
      reason: 'Approved clean refund',
      idempotency_key: executeCalls[0].idempotency_key,
      operator_go: 'EXECUTE_REFUND_CONFIRMED',
    });
    expect(executeCalls[0]).not.toHaveProperty('gross_refund_pence');
    expect(executeCalls[0]).not.toHaveProperty('refunded_minutes');
    expect(executeCalls[0]).not.toHaveProperty('learner_id');
    expect(executeCalls[0]).not.toHaveProperty('instructor_id');
    expect(executeCalls[0]).not.toHaveProperty('school_id');
  });

  test('behaviorally refuses blocked, manual-review, and BCS previews before execute', async ({ browser }) => {
    const cases = [
      cleanPreview({ blocked: true, manual_review_required: true, recommended_operator_action: 'blocked', code: 'BLOCKED_TEST', message: 'Blocked test preview.' }),
      cleanPreview({ manual_review_required: true, recommended_operator_action: 'manual_review_required', code: 'MANUAL_TEST', message: 'Manual test preview.' }),
      cleanPreview({ recommended_operator_action: 'manual_review_required', lines: [{ booking_credit_source_id: 55, net_refund_pence: 8106 }] }),
    ];

    for (const preview of cases) {
      const page = await browser.newPage();
      try {
        await setupPortalPage(page, [preview]);
        await requestPreview(page);
        await expect(page.locator('#refund-preview-result')).toContainText('Execution unavailable');
        await expect(page.locator('#btn-execute-refund')).toHaveCount(0);
        expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  test('behaviorally records manual bank cases through separate confirmation and idempotency', async ({ page }) => {
    await setupPortalPage(page, [
      cleanPreview({
        blocked: true,
        manual_review_required: true,
        recommended_operator_action: 'manual_bank_review_required',
        code: 'BOOKING_ALREADY_PAID_OUT',
        message: 'This booking has already been paid out.',
        refund_type: 'direct_slot',
        lines: [{
          lesson_booking_id: 7001,
          learner_id: 61,
          instructor_id: 4,
          gross_pence_removed: 8250,
          source_fee_pence_used: 144,
          fee_withheld_pence: 144,
          net_refund_pence: 8106,
          minutes_adjusted: 0,
        }],
        processing_fee_withheld_pence: 144,
        net_refund_pence: 8106,
      }),
    ]);
    await requestPreview(page, { type: 'direct_slot', sourceId: '7001', reason: 'Approved manual bank refund' });

    const recordButton = page.locator('#btn-record-manual-bank-refund');
    await expect(recordButton).toBeDisabled();

    await page.fill('#refund-manual-bank-reference', 'BANK-REF-7001');
    await page.fill('#refund-manual-bank-confirmation', 'RECORD_MANUAL');
    await expect(recordButton).toBeDisabled();

    await page.fill('#refund-manual-bank-confirmation', 'RECORD_MANUAL_BANK_REFUND_CONFIRMED');
    await expect(recordButton).toBeEnabled();

    await recordButton.click();
    await expect(page.locator('#refund-manual-bank-status')).toContainText('SIMULATED_MANUAL_BANK_HOLD');

    const manualCalls = await page.evaluate(() => window.__manualBankCalls);
    expect(manualCalls).toHaveLength(1);
    expect(manualCalls[0]).toEqual({
      refund_type: 'direct_slot',
      lesson_booking_id: 7001,
      reason: 'Approved manual bank refund',
      idempotency_key: manualCalls[0].idempotency_key,
      manual_bank_reference: 'BANK-REF-7001',
      operator_go: 'RECORD_MANUAL_BANK_REFUND_CONFIRMED',
    });
    expect(manualCalls[0].idempotency_key).toBeTruthy();
    expect(manualCalls[0]).not.toHaveProperty('gross_refund_pence');
    expect(manualCalls[0]).not.toHaveProperty('learner_id');
    expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
  });

  test('lets booking rows prefill the preview without executing anything', () => {
    expect(portalJs).toContain('data-action="open-refund-preview"');
    expect(portalJs).toContain('openRefundPreviewFromBooking(parseInt(t.dataset.id, 10))');
    expect(sourceFor('openRefundPreviewFromBooking')).toContain("type.value = 'direct_slot'");
  });
});
