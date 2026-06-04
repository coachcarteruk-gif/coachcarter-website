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

function readinessResponse(overrides = {}) {
  return {
    ok: true,
    read_only: true,
    readiness: {
      classification: 'complete',
      complete: true,
      repairable_candidate: false,
      required_evidence: ['refund_event:900', 'idempotency_key:refund-ui-900', 'stripe_refund_id:re_slot_900'],
      reasons: {
        incomplete: [],
        manual_decision: [],
      },
      stop_conditions: [],
      allowed_next_step: 'post_refund_verification',
      ...(overrides.readiness || {}),
    },
    event: { id: 900 },
    lines: [],
    notes: [],
    ...overrides,
  };
}

async function setupPortalPage(page, previews, readinessResponses = [readinessResponse()]) {
  await page.route('https://admin.test/portal.html', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: strippedPortalHtml,
  }));
  await page.goto('https://admin.test/portal.html');
  await page.evaluate(({ queuedPreviews, queuedReadinessResponses }) => {
    localStorage.setItem('cc_admin', JSON.stringify({ admin: { name: 'Test Admin', email: 'admin@example.test' } }));
    window.__previewQueue = queuedPreviews;
    window.__executeCalls = [];
    window.__manualBankCalls = [];
    window.__refundNoteCalls = [];
    window.__refundEventSearchCalls = [];
    window.__refundEventDetailCalls = [];
    window.__refundReadinessCalls = [];
    window.__adminFetchCalls = [];
    window.__refundReadinessQueue = queuedReadinessResponses;
    window.ccAdminAuth = {
      logout: () => {},
      fetchAuthed: async (url, options = {}) => {
        window.__adminFetchCalls.push({ url, method: options.method || 'GET' });
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
        if (url.includes('action=refund-incident-readiness')) {
          window.__refundReadinessCalls.push(url);
          const queued = window.__refundReadinessQueue.shift();
          if (queued && Object.prototype.hasOwnProperty.call(queued, 'status')) {
            return json(queued.body || queued.response || {}, queued.status);
          }
          return json(queued || {
            ok: true,
            read_only: true,
            readiness: {
              classification: 'complete',
              complete: true,
              repairable_candidate: false,
              required_evidence: ['refund_event:900'],
              reasons: { incomplete: [], manual_decision: [] },
              stop_conditions: [],
              allowed_next_step: 'post_refund_verification',
            },
          });
        }
        if (url.includes('action=refund-events')) {
          if (url.includes('refund_event_id=')) {
            window.__refundEventDetailCalls.push(url);
            return json({
              ok: true,
              event: {
                id: 900,
                learner_id: 61,
                learner_name: 'Alex Learner',
                learner_email: 'alex@example.test',
                refund_type: 'direct_slot',
                status: 'executed',
                gross_refund_pence: 8250,
                processing_fee_withheld_pence: 144,
                net_refund_pence: 8106,
                stripe_refund_id: 're_slot_900',
                idempotency_key: 'refund-ui-900',
                metadata: { refund_channel: 'manual_bank', evidence_reference: 'OPS-900' },
                created_at: '2026-06-03T10:00:00.000Z',
              },
              lines: [{ id: 1, lesson_booking_id: 7001, gross_pence_removed: 8250, source_fee_pence_used: 144, fee_withheld_pence: 144, net_refund_pence: 8106 }],
              notes: [{ id: 8, note_type: 'incident', incident_status: 'watching', body: 'Incident context only.', created_at: '2026-06-03T11:00:00.000Z' }],
            });
          }
          window.__refundEventSearchCalls.push(url);
          return json({
            ok: true,
            events: [{
              id: 900,
              learner_id: 61,
              learner_name: 'Alex Learner',
              learner_email: 'alex@example.test',
              refund_type: 'direct_slot',
              status: 'executed',
              net_refund_pence: 8106,
              stripe_refund_id: 're_slot_900',
              idempotency_key: 'refund-ui-900',
              created_at: '2026-06-03T10:00:00.000Z',
            }],
          });
        }
        if (url.includes('action=refund-notes')) return json({ ok: true, notes: [] });
        if (url.includes('action=add-refund-note')) {
          window.__refundNoteCalls.push(JSON.parse(options.body || '{}'));
          return json({ ok: true, note_added: true, note: { id: 88 } });
        }
        return json({ ok: true });
      },
    };
  }, { queuedPreviews: previews, queuedReadinessResponses: readinessResponses });
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
    expect(renderPanel).toContain('id="refund-manual-bank-evidence"');
    expect(renderPanel).toContain('id="refund-manual-bank-note"');
    expect(renderPanel).toContain('id="btn-record-manual-bank-refund"');
    expect(record).toContain("fetchAdmin('/api/admin?action=record-manual-bank-refund'");
    expect(record).toContain('manual_bank_reference: reference');
    expect(record).toContain('evidence_reference = evidenceReference');
    expect(record).toContain('operator_note = operatorNote');
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
    expect(render).toContain('Evidence reference');
    expect(render).toContain('Operator note');
    expect(render).toContain('renderRefundLines(event.lines || [])');
  });

  test('adds a refund notes timeline for executed or manual refund events', () => {
    const executedRender = sourceFor('renderExecutedRefundResult');
    const manualRender = sourceFor('renderManualBankRefundResult');
    const panel = sourceFor('renderRefundNotesPanel');
    const loader = sourceFor('loadRefundNotes');
    const addNote = sourceFor('addRefundNoteFromPanel');

    expect(executedRender).toContain('renderRefundNotesPanel(event)');
    expect(manualRender).toContain('renderRefundNotesPanel(event)');
    expect(panel).toContain('Refund notes timeline');
    expect(panel).toContain('id="refund-note-type"');
    expect(panel).toContain('id="refund-note-incident-status"');
    expect(panel).toContain('id="refund-note-body"');
    expect(loader).toContain("fetchAdmin('/api/admin?action=refund-notes&refund_event_id='");
    expect(loader).toContain('const expectedEventId = String(refundEventId)');
    expect(loader).toContain("panel.dataset.refundEventId !== expectedEventId");
    expect(addNote).toContain("fetchAdmin('/api/admin?action=add-refund-note'");
    expect(addNote).toContain('refund_event_id: refundEventId');
    expect(addNote).toContain("btn.disabled = true");
    expect(addNote).toContain("btn.textContent = 'Adding...'");
    expect(addNote).toContain("btn.disabled = false");
    expect(addNote).not.toContain('gross_refund_pence');
    expect(addNote).not.toContain('stripe_refund_id');
  });

  test('adds refund-event search and detail visibility without mutation actions', () => {
    const buildSearch = sourceFor('buildRefundEventsSearchParams');
    const loadSearch = sourceFor('loadRefundEvents');
    const openDetail = sourceFor('openRefundEvent');
    const renderDetail = sourceFor('renderRefundEventDetail');
    const loadReadiness = sourceFor('loadRefundIncidentReadiness');
    const renderReadiness = sourceFor('renderRefundIncidentReadiness');

    expect(portalHtml).toContain('id="refund-events-search-form"');
    expect(portalHtml).toContain('id="refund-events-results"');
    expect(portalHtml).toContain('id="refund-event-detail"');
    expect(buildSearch).toContain("action: 'refund-events'");
    expect(buildSearch).toContain("params.set('refund_type', type)");
    expect(buildSearch).toContain("params.set('status', status)");
    expect(buildSearch).toContain("params.set('recent_days', recent)");
    expect(buildSearch).toContain('if (recent && !q)');
    expect(loadSearch).toContain("fetchAdmin('/api/admin?' + params.toString()");
    expect(openDetail).toContain("refund_event_id: String(refundEventId)");
    expect(renderDetail).toContain('Ledger lines');
    expect(renderDetail).toContain('Metadata');
    expect(renderDetail).toContain('Notes timeline');
    expect(renderDetail).toContain('renderRefundNotesTimeline(data.notes || [])');
    expect(renderDetail).toContain('id="refund-incident-readiness-panel"');
    expect(openDetail).toContain('await loadRefundIncidentReadiness(refundEventId)');
    expect(loadReadiness).toContain("fetchAdmin('/api/admin?action=refund-incident-readiness&refund_event_id='");
    expect(loadReadiness).toContain('encodeURIComponent(refundEventId)');
    expect(loadReadiness).not.toContain("method: 'POST'");
    expect(loadReadiness).not.toContain('school_id');
    expect(renderReadiness).toContain('Incident Readiness');
    expect(renderReadiness).toContain('No incident repair action exists yet.');
    expect(renderReadiness).toContain('This panel does not expose repair, execute, Stripe, booking, payout, credit, CSA, BCS, or ledger mutation controls.');
    expect(renderReadiness).toContain('Required evidence');
    expect(renderReadiness).toContain('Incomplete reasons');
    expect(renderReadiness).toContain('Manual-decision reasons');
    expect(renderReadiness).toContain('Stop conditions');
    expect(renderReadiness).not.toContain('data-action="execute-refund"');
    expect(renderReadiness).not.toContain('data-action="record-manual-bank-refund"');
    expect(renderReadiness).not.toContain("fetchAdmin('/api/admin?action=execute-refund'");
    expect(renderReadiness).not.toContain("fetchAdmin('/api/admin?action=record-manual-bank-refund'");
    expect(loadSearch).not.toContain("method: 'POST'");
    expect(openDetail).not.toContain("method: 'POST'");
  });

  test('behaviorally searches and opens refund events in the operations panel', async ({ page }) => {
    await setupPortalPage(page, []);
    await page.fill('#refund-events-q', 'alex@example.test');
    await page.selectOption('#refund-events-type', 'direct_slot');
    await page.selectOption('#refund-events-status', 'executed');
    await page.fill('#refund-events-recent', '60');
    await page.click('#btn-refund-events-search');

    await expect(page.locator('#refund-events-results')).toContainText('Alex Learner');
    await expect(page.locator('#refund-events-results')).toContainText('re_slot_900');
    const searchCalls = await page.evaluate(() => window.__refundEventSearchCalls);
    expect(searchCalls[0]).toContain('action=refund-events');
    expect(searchCalls[0]).toContain('q=alex%40example.test');
    expect(searchCalls[0]).toContain('refund_type=direct_slot');
    expect(searchCalls[0]).toContain('status=executed');
    expect(searchCalls[0]).not.toContain('recent_days=60');

    await page.click('[data-action="open-refund-event"][data-id="900"]');
    await expect(page.locator('#refund-event-detail')).toContainText('Refund event #900');
    await expect(page.locator('#refund-event-detail')).toContainText('Ledger lines');
    await expect(page.locator('#refund-incident-readiness-panel')).toContainText('Incident Readiness');
    await expect(page.locator('#refund-incident-readiness-panel')).toContainText('Complete');
    await expect(page.locator('#refund-incident-readiness-panel')).toContainText('Post-refund verification');
    await expect(page.locator('#refund-incident-readiness-panel')).toContainText('No incident repair action exists yet.');
    await expect(page.locator('#refund-event-detail')).toContainText('Incident context only.');
    const detailCalls = await page.evaluate(() => window.__refundEventDetailCalls);
    expect(detailCalls).toHaveLength(1);
    expect(detailCalls[0]).toContain('refund_event_id=900');
    const readinessCalls = await page.evaluate(() => window.__refundReadinessCalls);
    expect(readinessCalls).toHaveLength(1);
    expect(readinessCalls[0]).toContain('action=refund-incident-readiness');
    expect(readinessCalls[0]).toContain('refund_event_id=900');
    expect(readinessCalls[0]).not.toContain('school_id');
    expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
    expect(await page.evaluate(() => window.__manualBankCalls)).toEqual([]);
  });

  test('behaviorally renders incomplete and manual-decision readiness states without mutation controls', async ({ browser }) => {
    const cases = [
      {
        response: readinessResponse({
          readiness: {
            classification: 'incomplete',
            complete: false,
            repairable_candidate: true,
            required_evidence: ['refund_event:900', 'stripe_refund_id:re_slot_900'],
            reasons: { incomplete: ['REFUND_EVENT_LINES_MISSING'], manual_decision: [] },
            stop_conditions: ['REFUND_EVENT_LINES_MISSING'],
            allowed_next_step: 'record_evidence_and_stop_for_review',
          },
        }),
        expected: ['Incomplete', 'REFUND_EVENT_LINES_MISSING', 'Record evidence and stop for review'],
      },
      {
        response: readinessResponse({
          readiness: {
            classification: 'needs_manual_decision',
            complete: false,
            repairable_candidate: false,
            required_evidence: ['refund_event:900', 'manual_bank_reference:BANK-900'],
            reasons: { incomplete: [], manual_decision: ['OPEN_INCIDENT_NOTE'] },
            stop_conditions: ['OPEN_INCIDENT_NOTE'],
            allowed_next_step: 'record_evidence_and_stop_for_review',
          },
        }),
        expected: ['Needs manual decision', 'OPEN_INCIDENT_NOTE', 'manual_bank_reference:BANK-900'],
      },
    ];

    for (const item of cases) {
      const page = await browser.newPage();
      try {
        await setupPortalPage(page, [], [item.response]);
        await page.click('#btn-refund-events-search');
        await page.click('[data-action="open-refund-event"][data-id="900"]');
        for (const text of item.expected) {
          await expect(page.locator('#refund-incident-readiness-panel')).toContainText(text);
        }
        await expect(page.locator('#refund-incident-readiness-panel [data-action="execute-refund"]')).toHaveCount(0);
        await expect(page.locator('#refund-incident-readiness-panel [data-action="record-manual-bank-refund"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
        expect(await page.evaluate(() => window.__manualBankCalls)).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  test('behaviorally renders readiness endpoint error and not-found states without mutation controls', async ({ browser }) => {
    const cases = [
      {
        response: {
          status: 500,
          body: { error: true, code: 'READINESS_FAILED', message: 'Readiness classifier unavailable.' },
        },
        expected: 'Readiness classifier unavailable.',
      },
      {
        response: {
          status: 404,
          body: { error: true, code: 'REFUND_EVENT_NOT_FOUND', message: 'Refund event not found.' },
        },
        expected: 'Refund event not found.',
      },
    ];

    for (const item of cases) {
      const page = await browser.newPage();
      try {
        await setupPortalPage(page, [], [item.response]);
        await page.click('#btn-refund-events-search');
        await page.click('[data-action="open-refund-event"][data-id="900"]');
        await expect(page.locator('#refund-incident-readiness-panel')).toContainText(item.expected);
        await expect(page.locator('#refund-incident-readiness-panel [data-action="prefill-refund-note"]')).toHaveCount(0);
        await expect(page.locator('#refund-incident-readiness-panel [data-action="execute-refund"]')).toHaveCount(0);
        await expect(page.locator('#refund-incident-readiness-panel [data-action="record-manual-bank-refund"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
        expect(await page.evaluate(() => window.__manualBankCalls)).toEqual([]);
        expect(await page.evaluate(() => window.__refundNoteCalls)).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  test('clicking readiness note-prefill alone makes zero network calls', async ({ page }) => {
    await setupPortalPage(page, [], [readinessResponse({
      readiness: {
        classification: 'needs_manual_decision',
        complete: false,
        repairable_candidate: false,
        required_evidence: ['refund_event:900'],
        reasons: { incomplete: [], manual_decision: ['OPEN_INCIDENT_NOTE'] },
        stop_conditions: ['OPEN_INCIDENT_NOTE'],
        allowed_next_step: 'record_evidence_and_stop_for_review',
      },
    })]);

    await page.click('#btn-refund-events-search');
    await page.click('[data-action="open-refund-event"][data-id="900"]');
    await expect(page.locator('[data-action="prefill-refund-note"][data-note-type="incident"]')).toBeVisible();

    await page.evaluate(() => {
      window.__adminFetchCalls = [];
      window.__refundNoteCalls = [];
      window.__executeCalls = [];
      window.__manualBankCalls = [];
    });
    await page.click('[data-action="prefill-refund-note"][data-note-type="incident"]');

    await expect(page.locator('#refund-note-type')).toHaveValue('incident');
    await expect(page.locator('#refund-note-incident-status')).toHaveValue('open');
    await expect(page.locator('#refund-note-body')).toHaveValue(/Incident readiness reviewed\./);
    expect(await page.evaluate(() => window.__adminFetchCalls)).toEqual([]);
    expect(await page.evaluate(() => window.__refundNoteCalls)).toEqual([]);
    expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
    expect(await page.evaluate(() => window.__manualBankCalls)).toEqual([]);
  });

  test('prefills incident or repair-decision notes from readiness using only the notes endpoint', async ({ page }) => {
    await setupPortalPage(page, [], [readinessResponse({
      readiness: {
        classification: 'needs_manual_decision',
        complete: false,
        repairable_candidate: false,
        required_evidence: ['refund_event:900'],
        reasons: { incomplete: [], manual_decision: ['OPEN_INCIDENT_NOTE'] },
        stop_conditions: ['OPEN_INCIDENT_NOTE'],
        allowed_next_step: 'record_evidence_and_stop_for_review',
      },
    })]);

    await page.click('#btn-refund-events-search');
    await page.click('[data-action="open-refund-event"][data-id="900"]');
    await page.click('[data-action="prefill-refund-note"][data-note-type="incident"]');
    await expect(page.locator('#refund-note-type')).toHaveValue('incident');
    await expect(page.locator('#refund-note-incident-status')).toHaveValue('open');
    await expect(page.locator('#refund-note-body')).toHaveValue(/Incident readiness reviewed\./);

    await page.click('[data-action="add-refund-note"]');
    const incidentCalls = await page.evaluate(() => window.__refundNoteCalls);
    expect(incidentCalls).toHaveLength(1);
    expect(incidentCalls[0]).toMatchObject({
      refund_event_id: 900,
      note_type: 'incident',
      incident_status: 'open',
    });
    expect(incidentCalls[0]).not.toHaveProperty('gross_refund_pence');
    expect(incidentCalls[0]).not.toHaveProperty('stripe_refund_id');

    await page.click('[data-action="prefill-refund-note"][data-note-type="repair_decision"]');
    await page.fill('#refund-note-body', 'Readiness reviewed. Repair mutation remains future work; operator decision: stop.');
    await page.click('[data-action="add-refund-note"]');
    const calls = await page.evaluate(() => window.__refundNoteCalls);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      refund_event_id: 900,
      note_type: 'repair_decision',
      incident_status: 'not_applicable',
    });
    expect(await page.evaluate(() => window.__executeCalls)).toEqual([]);
    expect(await page.evaluate(() => window.__manualBankCalls)).toEqual([]);
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
    await page.fill('#refund-manual-bank-evidence', 'BANK-SCREENSHOT-7001');
    await page.fill('#refund-manual-bank-note', 'Approved after bank transfer was completed.');
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
      evidence_reference: 'BANK-SCREENSHOT-7001',
      operator_note: 'Approved after bank transfer was completed.',
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
