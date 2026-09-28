'use strict';

const crypto = require('crypto');
const { CHARGEABLE } = require('../../api/_booking-status');
const { loadFifoCreditSources, planFifoCreditDraw } = require('../../api/_bcs-fifo');

const ACTION = 'credits.shortened_lesson_source_repair_20260928';
const TYPES = ['purchase', 'slot_purchase', 'admin_add', 'referral_bonus', 'referral_reward', 'legacy_grandfather', 'instructor_transfer_in'];
// One reviewed historical repair, deliberately not a general ledger normalizer.
const TARGETS = Object.freeze([
  [386,147,117,39,6,90,60], [389,150,117,39,6,120,60],
  [414,177,117,39,6,90,60], [440,203,117,39,6,90,60],
  [458,222,117,39,6,90,60], [495,258,117,39,6,90,60],
  [496,259,117,39,6,90,60], [497,260,117,39,6,90,60],
  [539,291,317,134,4,120,90],
].map(([bookingId,bcsId,sourceId,learnerId,instructorId,before,after]) =>
  Object.freeze({ bookingId,bcsId,sourceId,learnerId,instructorId,before,after })));
const IDS = TARGETS.map(t => t.bookingId);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const query = async (client, sql, params = []) => (await client.query(sql, params)).rows;
const sqlFor = client => async (parts, ...values) => query(client,
  parts.reduce((s,p,i) => s + (i ? '$'+i : '') + p, ''), values);

async function readEvidence(client) {
  const [row] = await query(client, `SELECT jsonb_build_object(
    'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM lesson_bookings b WHERE school_id=1 AND id=ANY($1::int[])),
    'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM learner_credit_balances b WHERE school_id=1 AND learner_id IN (39,134)),
    'learners',(SELECT jsonb_agg(jsonb_build_object('id',id,'school_id',school_id,'balance_minutes',balance_minutes,'credit_balance',credit_balance) ORDER BY id) FROM learner_users WHERE school_id=1 AND id IN (39,134)),
    'credits',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM credit_transactions c WHERE school_id=1 AND learner_id IN (39,134)),
    'unattributed',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM lesson_bookings b WHERE b.school_id=1 AND b.learner_id IN (39,134)
      AND b.credit_returned=FALSE AND COALESCE(b.payment_method,'')<>'flexible_package' AND b.minutes_deducted>0
      AND NOT EXISTS(SELECT 1 FROM booking_credit_sources s WHERE s.school_id=b.school_id AND s.booking_id=b.id)),
    'allocations',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM booking_credit_sources s JOIN credit_transactions c ON c.id=s.credit_transaction_id AND c.school_id=s.school_id WHERE c.school_id=1 AND c.learner_id IN (39,134)),
    'adjustments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM credit_source_adjustments a JOIN credit_transactions c ON c.id=a.credit_transaction_id WHERE c.school_id=1 AND c.learner_id IN (39,134)),
    'cleanup',(SELECT to_jsonb(a) FROM audit_log a WHERE school_id=1 AND id=707 AND action='owner.confirmed_legacy_credit_cleanup'),
    'receipt',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_log a WHERE school_id=1 AND action=$2),
    'payouts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM payout_line_items p WHERE school_id=1 AND booking_id=ANY($1::int[])),
    'settlements',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.booking_id) FROM interim_v1_manual_payout_settlement_bookings p WHERE school_id=1 AND booking_id=ANY($1::int[])),
    'basis',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM payout_funding_basis_events p WHERE school_id=1 AND booking_id=ANY($1::int[])),
    'earnings',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM booking_earnings p WHERE school_id=1 AND booking_id=ANY($1::int[])),
    'school_payouts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM school_payout_line_items p JOIN school_payouts s ON s.id=p.school_payout_id WHERE s.school_id=1 AND p.booking_id=ANY($1::int[])),
    'evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM interim_v1_funding_evidence e WHERE school_id=1 AND booking_id=ANY($1::int[])),
    'earning_sources',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM booking_earning_sources e WHERE school_id=1 AND booking_credit_source_id=ANY($3::int[])),
    'refunds',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM refund_event_lines r WHERE school_id=1 AND (lesson_booking_id=ANY($1::int[]) OR booking_credit_source_id=ANY($3::int[])))
  ) AS evidence`, [IDS,ACTION,TARGETS.map(t => t.bcsId)]);
  return row.evidence;
}

async function availability(client) {
  const result = [];
  for (const [learnerId,instructorId] of [[39,6],[134,4]]) {
    const sources = await loadFifoCreditSources(sqlFor(client), { learnerId,instructorId,schoolId:1,creditTransactionTypes:TYPES });
    requireThat(sources.every(s => s.minutes >= s.active_minutes_drawn + s.adjusted_minutes), 'Source is overdrawn');
    result.push({ learnerId, instructorId,
      minutes:sources.reduce((n,s) => n+s.minutes-s.active_minutes_drawn-s.adjusted_minutes,0),
      oneHour:planFifoCreditDraw({sources,minutes:60,schoolId:1}).ok });
  }
  return result;
}

function journalBalances(e) {
  return e.balances.map(b => {
    const credits=e.credits.filter(c=>c.learner_id===b.learner_id && c.instructor_id===b.instructor_id);
    const ids=new Set(credits.map(c=>c.id));
    const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
    return {learnerId:b.learner_id,minutes:sum(credits,'minutes')
      -sum(e.allocations.filter(a=>ids.has(a.credit_transaction_id)&&!a.refunded_at),'minutes_drawn')
      -sum(e.adjustments.filter(a=>ids.has(a.credit_transaction_id)),'minutes_adjusted')
      -sum((e.unattributed||[]).filter(r=>r.learner_id===b.learner_id&&r.instructor_id===b.instructor_id),'minutes_deducted')};
  });
}

function validate(e) {
  requireThat(!e.receipt, 'Repair already recorded');
  requireThat(e.bookings?.length === 9 && e.learners?.length === 2, 'Missing target identity');
  requireThat(!e.evidence && !e.earning_sources && !e.refunds && !e.earnings && !e.basis && !e.school_payouts, 'Unexpected financial evidence: manual review required');
  requireThat(e.balances?.length === 2 && e.balances.some(b => b.learner_id===39 && b.instructor_id===6 && b.balance_minutes===300)
    && e.balances.some(b => b.learner_id===134 && b.instructor_id===4 && b.balance_minutes===0), 'Balance changed');
  requireThat(e.learners.every(l => l.balance_minutes === (l.id===39 ? 300 : 0)), 'Aggregate balance mismatch');
  for (const t of TARGETS) {
    const b = e.bookings.find(b => b.id===t.bookingId);
    const active = e.allocations.filter(s => s.booking_id===t.bookingId && !s.refunded_at);
    const s = active[0];
    const c = e.credits.find(c => c.id===t.sourceId);
    requireThat(b && b.school_id===1 && b.learner_id===t.learnerId && b.instructor_id===t.instructorId
      && b.status===CHARGEABLE && b.payment_method==='credit' && b.minutes_deducted===t.after
      && !b.cancelled_at && !b.credit_returned && !b.credit_forfeited && !b.lesson_payment_contract_id
      && b.list_price_pence===0, `Booking ${t.bookingId} changed`);
    const time = x => Number(x.slice(0,2))*60+Number(x.slice(3,5));
    requireThat(time(b.end_time)-time(b.start_time)===t.after, 'Elapsed duration mismatch');
    requireThat(active.length===1 && s.id===t.bcsId && s.school_id===1 && s.credit_transaction_id===t.sourceId
      && s.minutes_drawn===t.before && s.contribution_pence===0 && s.stripe_fee_pence===0
      && s.rate_pence_per_minute===(t.learnerId===39 ? 92 : 0)
      && s.absorbed_by===(t.learnerId===39 ? 'instructor' : 'platform'), `Allocation ${t.bcsId} changed`);
    requireThat(c && c.school_id===1 && c.learner_id===t.learnerId && c.instructor_id===t.instructorId
      && c.type==='admin_add' && c.amount_pence===0 && !c.stripe_fee_pence
      && c.minutes===(t.sourceId===117 ? 1710 : 120), 'Source identity/value changed');
  }
  const adjustment = e.adjustments.find(a => a.id===17);
  requireThat(adjustment?.credit_transaction_id===321 && adjustment.minutes_adjusted===30 && adjustment.pence_adjusted===0
    && adjustment.kind==='admin_correction', 'Prior zero-balance correction changed');
  requireThat(e.cleanup?.details?.changes?.some(c => c.id===134 && c.source===321 && c.minutes===30 && c.new_minutes===0 && c.source_adjustment_id===17), 'Owner cleanup evidence missing');
  const oldEdit = e.credits.find(c => c.id===321);
  requireThat(oldEdit?.type==='edit_adjustment' && oldEdit.minutes===30 && oldEdit.learner_id===134 && oldEdit.instructor_id===4, 'Shortening evidence missing');
  requireThat(e.bookings.find(b => b.id===539).rescheduled_from===532, 'Reschedule chain changed');
  requireThat(e.credits.filter(c => c.learner_id===39 && c.instructor_id===6 && c.type==='edit_adjustment').reduce((n,c) => n+c.minutes,0)===270, 'Giovanni edit total changed');
  requireThat(e.credits.filter(c=>c.learner_id===39&&c.type==='edit_adjustment').every(c=>c.minutes>0 && c.amount_pence===0
    && !e.adjustments.some(a=>a.credit_transaction_id===c.id)), 'Edit marker already adjusted or unexpected value');
  requireThat(journalBalances(e).every(j=>j.minutes===(j.learnerId===39?300:0)), 'Journal balance mismatch');
  requireThat((e.payouts||[]).length===1 && e.payouts[0].booking_id===539 && e.payouts[0].price_pence===0 && e.payouts[0].instructor_amount_pence===0 && e.payouts[0].stripe_fee_pence===0, 'Historical payout changed');
  requireThat(JSON.stringify((e.settlements||[]).map(s => s.booking_id))===JSON.stringify([414,458,495]), 'Historical settlements changed');
}

async function buildPreview(client) {
  const evidence = await readEvidence(client);
  if (evidence.receipt) return {status:'already_applied',auditId:evidence.receipt[0].id,availability:await availability(client)};
  validate(evidence);
  const before = await availability(client);
  requireThat(before[0].minutes===30 && before[1].minutes===0, 'Spendable credit changed');
  return {status:'ready', fingerprint:fingerprint(evidence), before,
    replacements:TARGETS, adjustments:{neutralizeGiovanniEditMarkers:270,preserveLleizClearanceOnOriginalSource:30},
    after:[{learnerId:39,minutes:300},{learnerId:134,minutes:0}]};
}

// Caller owns a SERIALIZABLE transaction and must roll back on any failure.
async function applyRepair(client, {reviewedFingerprint,adminId,operatorIdentity,evidenceReference}) {
  requireThat(adminId===1 && operatorIdentity?.trim() && evidenceReference?.trim(), 'Verified operator/evidence required');
  requireThat((await query(client,'SELECT id FROM admin_users WHERE school_id=1 AND id=$1',[adminId])).length===1, 'Wrong-school operator');
  for (const id of [4,6]) await query(client,'SELECT pg_advisory_xact_lock(1,$1)',[id]);
  await query(client,'SELECT id FROM learner_users WHERE school_id=1 AND id IN (39,134) ORDER BY id FOR UPDATE');
  for (const id of IDS) await query(client,'SELECT pg_advisory_xact_lock(1,$1)',[id]);
  await query(client,'SELECT id FROM lesson_bookings WHERE school_id=1 AND id=ANY($1::int[]) ORDER BY id FOR UPDATE',[IDS]);
  await query(client,'SELECT id FROM learner_credit_balances WHERE school_id=1 AND learner_id IN (39,134) ORDER BY id FOR UPDATE');
  await query(client,'SELECT id FROM credit_transactions WHERE school_id=1 AND learner_id IN (39,134) ORDER BY id FOR UPDATE');
  const preview = await buildPreview(client);
  if (preview.status==='already_applied') return preview;
  requireThat(reviewedFingerprint===preview.fingerprint, 'Reviewed fingerprint changed');
  const before = await readEvidence(client);
  const replacements = [];
  for (const t of TARGETS) {
    const archived = await query(client,'UPDATE booking_credit_sources SET refunded_at=NOW() WHERE school_id=1 AND id=$1 AND refunded_at IS NULL RETURNING id',[t.bcsId]);
    requireThat(archived.length===1, 'Allocation changed during repair');
    const [replacement] = await query(client,`INSERT INTO booking_credit_sources
      (school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by)
      SELECT school_id,booking_id,credit_transaction_id,$2,rate_pence_per_minute,contribution_pence,stripe_fee_pence,absorbed_by
      FROM booking_credit_sources WHERE school_id=1 AND id=$1 RETURNING id`,[t.bcsId,t.after]);
    replacements.push({...t,replacementId:replacement.id});
  }
  // Releasing BCS now represents the old returned minutes. Neutralize the old
  // edit markers in the reconciliation journal so it cannot count that return
  // twice. These markers are excluded from FIFO; this never removes spendable credit.
  const adjustments=[];
  for(const marker of before.credits.filter(c=>c.learner_id===39&&c.type==='edit_adjustment')) {
    adjustments.push(...await query(client,`INSERT INTO credit_source_adjustments
      (credit_transaction_id,kind,minutes_adjusted,pence_adjusted,reason,created_by)
      VALUES ($1,'admin_correction',$2,0,$3,$4) RETURNING id`,
    [marker.id,marker.minutes,`${ACTION}: neutralize historical edit marker after replacing stale booking allocation; no balance deduction`,adminId]));
  }
  // Adjustment 17 already neutralizes Lleiz's edit marker. Preserve it, and
  // append the owner's existing clearance to the original, now-released source.
  adjustments.push(...await query(client,`INSERT INTO credit_source_adjustments
    (credit_transaction_id,kind,minutes_adjusted,pence_adjusted,reason,created_by)
    VALUES (317,'admin_correction',30,0,$1,$2) RETURNING id`,
  [`${ACTION}: preserve zero entitlement authorized in owner cleanup audit 707; adjustment 17 remains against edit marker 321`,adminId]));
  const after = await readEvidence(client);
  for (const key of Object.keys(before).filter(k => !['allocations','adjustments'].includes(k))) {
    requireThat(fingerprint(before[key])===fingerprint(after[key]), `Unexpected change to ${key}`);
  }
  const spendable = await availability(client);
  requireThat(spendable[0].minutes===300 && spendable[0].oneHour && spendable[1].minutes===0, 'Repair postcondition failed');
  requireThat(fingerprint(journalBalances(before))===fingerprint(journalBalances(after)), 'Journal postcondition failed');
  for (const t of TARGETS) {
    const active = after.allocations.filter(s => s.booking_id===t.bookingId && !s.refunded_at);
    requireThat(active.length===1 && active[0].minutes_drawn===t.after, 'Replacement postcondition failed');
  }
  const details = {reviewedFingerprint,operatorIdentity,evidenceReference,replacements,adjustmentIds:adjustments.map(a=>a.id),
    before:preview.before,after:spendable,balancesUnchanged:true,cashAndPayoutsUnchanged:true};
  const [audit] = await query(client,`INSERT INTO audit_log(admin_id,action,target_type,target_id,details,ip_address,school_id)
    VALUES ($1,$2,'school',1,$3,'operator-script',1) RETURNING id`,[adminId,ACTION,JSON.stringify(details)]);
  return {status:'applied',auditId:audit.id,...details};
}

module.exports = {ACTION,TARGETS,readEvidence,validate,buildPreview,applyRepair,availability,fingerprint,journalBalances};
