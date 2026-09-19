const { test, expect } = require('@playwright/test');
const { normalizeRequestReleaseSources } = require('../api/_refund-exposure-request-cycles');
const { summarizeExactRefundExposureRows, computeExactRefundExposure } = require('../api/_platform-balance');

const scope = { school_id: 1, learner_id: 39, instructor_id: 6 };
const cycle = { ...scope, held_minutes: 1290, released_minutes: 1290, invalid_sign_count: 0 };
const source = overrides => ({
  ...scope, credit_transaction_id: 1, source_type: 'request_refund',
  source_minutes: 120, source_amount_pence: 0, lcb_balance_minutes: 600,
  active_minutes_drawn: 0, active_contribution_pence: 0,
  adjusted_minutes: 0, adjusted_pence: 0, ...overrides,
});

test('closed request holds and releases do not mint additional unused entitlement', () => {
  const original = source({ credit_transaction_id: 117, source_type: 'admin_add', source_minutes: 1710, active_minutes_drawn: 1410 });
  const edits = source({ credit_transaction_id: 400, source_type: 'edit_adjustment', source_minutes: 300 });
  const release = source({ credit_transaction_id: 208, source_minutes: 1290 });
  const result = normalizeRequestReleaseSources([original, edits, release], [cycle]);
  expect(result.sources).toEqual([original, edits]);
  expect(result.evidence.excluded_balanced_request_release_minutes).toBe(1290);
  const summary = summarizeExactRefundExposureRows(result.sources, { schoolId: 1 });
  expect(summary.warnings.filter(w => w.code === 'LCB_SOURCE_RECONCILIATION_MISMATCH')).toEqual([]);
  expect(release.source_minutes).toBe(1290); // input ledger rows are unchanged
});

test('an incomplete or malformed request cycle remains visible for review', () => {
  const row = source({});
  for (const cycles of [[], [{...cycle,released_minutes:1200}], [{...cycle,held_minutes:0,released_minutes:0}], [{...cycle,invalid_sign_count:1}]]) {
    expect(normalizeRequestReleaseSources([row], cycles).sources).toEqual([row]);
  }
});

test('never borrow balancing evidence from another tenant, learner or instructor', () => {
  const row = source({});
  for (const other of [{school_id:2},{learner_id:40},{instructor_id:4}]) {
    expect(normalizeRequestReleaseSources([row], [{...cycle,...other}]).sources).toEqual([row]);
  }
});

test('priced, provider-linked, allocated and adjusted releases are never hidden', () => {
  for (const overrides of [
    {source_amount_pence:5500}, {stripe_payment_intent_id:'pi_paid'},
    {stripe_session_id:'cs_paid'}, {stripe_charge_id:'ch_paid'},
    {active_minutes_drawn:30}, {active_contribution_pence:100},
    {adjusted_minutes:30}, {adjusted_pence:100},
    {source_type:'purchase'}, {source_type:'edit_adjustment'},
  ]) {
    const row=source(overrides);
    expect(normalizeRequestReleaseSources([row], [cycle]).sources).toEqual([row]);
  }
});

for (const global of [false, true]) {
  test(`full exposure compute scopes its request-cycle evidence (${global?'global':'school'})`, async () => {
    const calls=[];
    const sql=async(strings,...values)=>{
      const query=strings.join('?'); calls.push({query,values});
      if(query.includes('exact_refund_exposure_sources')) return [source({source_minutes:1290})];
      if(query.includes('held_minutes')) return [cycle];
      if(query.includes('stripe_net_cash_in_pence')) return [{stripe_net_cash_in_pence:0}];
      throw Error('Unexpected query');
    };
    const result=await computeExactRefundExposure(sql, global?{}:{schoolId:1});
    expect(result.request_cycle_normalization.excluded_balanced_request_release_minutes).toBe(1290);
    const evidence=calls.find(c=>c.query.includes('held_minutes'));
    expect(evidence.query).toContain('GROUP BY school_id, learner_id, instructor_id');
    if(!global){expect(evidence.query).toContain('school_id = ?');expect(evidence.values).toEqual([1]);}
    expect(calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.query))).toBe(true);
  });
}
