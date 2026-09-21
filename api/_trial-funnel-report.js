// Read-only observational report. No financial mutation or attendance inference.
const { dateOnly } = require('./_learner-test-details');
const { operationalTimeZone, zonedDateTimeToDate } = require('./_full-curriculum');
const { REFUNDED, CHARGEABLE } = require('./_booking-status');
const DEFINITION_VERSION = 'trial_funnel_v2_qualification_credit_flexible';
function bounds(from, to) {
  if (!dateOnly(from) || !dateOnly(to) || from >= to || (new Date(to) - new Date(from)) / 86400000 > 366) {
    throw Object.assign(new Error('Choose a valid from/to range of at most one year (to is exclusive).'), { status: 400 });
  }
  return { from, to, from_inclusive: true, to_exclusive: true };
}
function resolveChains(bookings) {
  const byId = new Map(bookings.map(b => [Number(b.id), b]));
  const children = new Map();
  for (const b of bookings) if (b.rescheduled_from) {
    const key = Number(b.rescheduled_from); children.set(key, [...(children.get(key) || []), b]);
  }
  const result = new Map();
  for (const b of bookings) {
    let root = b; const seen = new Set(); let error = null;
    while (root.rescheduled_from) {
      if (seen.size >= 100) { error = 'chain_too_long'; break; }
      if (seen.has(Number(root.id))) { error = 'cycle'; break; }
      seen.add(Number(root.id));
      const parent = byId.get(Number(root.rescheduled_from));
      if (!parent || parent.learner_id !== b.learner_id || parent.school_id !== b.school_id) { error = 'missing_or_mismatched_origin'; break; }
      root = parent;
    }
    let leaf = root; const path = []; const forward = new Set();
    while (!error) {
      if (forward.size >= 100) { error = 'chain_too_long'; break; }
      if (forward.has(Number(leaf.id))) { error = 'cycle'; break; }
      forward.add(Number(leaf.id)); path.push(leaf);
      const next = children.get(Number(leaf.id)) || [];
      if (next.length > 1) { error = 'branching'; break; }
      if (!next.length) break;
      leaf = next[0];
      if (leaf.learner_id !== b.learner_id || leaf.school_id !== b.school_id) error = 'mismatched_successor';
    }
    result.set(Number(b.id), { root, leaf, path, error });
  }
  return result;
}
const timestamp = v => new Date(v).getTime();
function sessionAt(b, timezone, end = false, days = 0) {
  const day = new Date(String(b.scheduled_date).slice(0,10) + 'T00:00:00Z');
  day.setUTCDate(day.getUTCDate() + days);
  return zonedDateTimeToDate(day.toISOString().slice(0,10), String(end ? b.end_time : b.start_time).slice(0,5), timezone).getTime();
}
function duration(b) {
  const minutes = s => Number(String(s).slice(0,2)) * 60 + Number(String(s).slice(3,5));
  return Math.max(0, minutes(b.end_time) - minutes(b.start_time));
}
function funding(b) {
  const gross = Number(b.credit_gross || 0) + Number(b.flex_gross || 0);
  const net = Number(b.credit_net || 0) + Number(b.flex_net || 0);
  const capacity = duration(b);
  const unresolved = !!b.funding_unresolved || Number(b.curriculum_count || 0) > 0 || gross > capacity || net > gross || net < 0;
  return { gross: Math.min(capacity, gross), net: Math.min(capacity, Math.max(0, net)), unresolved };
}
function wilson(success, n) {
  if (!n) return null;
  const z = 1.96, p = success / n, denom = 1 + z*z/n;
  const half = z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n));
  return [Math.max(0,(p+z*z/(2*n)-half)/denom), Math.min(1,(p+z*z/(2*n)+half)/denom)];
}
function summarise(values) {
  const mature = values.filter(v => v.mature);
  const resolved = mature.filter(v => !v.unresolved);
  const hours = resolved.map(v => v.hours).sort((a,b) => a-b);
  const conversions = resolved.filter(v => v.net_conversion).length;
  return { count: values.length, matured: mature.length, immature: values.length-mature.length,
    unresolved_learners: mature.length-resolved.length, denominator: resolved.length,
    net_conversions: conversions, gross_conversions: resolved.filter(v => v.gross_conversion).length,
    cancelled_commitments: resolved.reduce((n,v)=>n+v.cancelled_commitments,0),
    early_commitments: resolved.reduce((n,v)=>n+v.early_commitments,0),
    mean_paid_hours: hours.length ? hours.reduce((a,b)=>a+b,0)/hours.length : null,
    median_paid_hours: hours.length ? (hours[Math.floor((hours.length-1)/2)]+hours[Math.floor(hours.length/2)])/2 : null,
    paid_hours_booked_before_t0: resolved.reduce((n,v)=>n+v.early_hours,0),
    chargeable_hours: resolved.reduce((n,v)=>n+v.chargeable_hours,0),
    elapsed_hours_without_recorded_exception: resolved.reduce((n,v)=>n+v.elapsed_hours,0),
    test_day_bookings: mature.reduce((n,v)=>n+v.test_days,0),
    paid_trial_extension_hours: mature.reduce((n,v)=>n+v.extension_hours,0),
    first_booking_mean_days: conversions ? resolved.filter(v=>v.net_conversion).reduce((n,v)=>n+v.first_days,0)/conversions : null,
    conversion_interval_95: wilson(conversions,resolved.length),
    interpretation: resolved.length < 20 ? 'Small group: no comparative conclusion.' : 'Observational association only; source, timing, experience and availability may confound it.' };
}
function evaluate(intake, trial, chains, asOf, originalAnchor = false) {
  const timezone = intake.school_timezone;
  const anchor = originalAnchor ? trial.root : trial.leaf;
  const t0 = sessionAt(anchor, timezone, true), until = sessionAt(anchor, timezone, true, 56);
  const value = { mature: until <= asOf, unresolved: trial.path.some(b=>funding(b).unresolved), hours: 0, early_hours: 0,
    chargeable_hours: 0, elapsed_hours: 0, net_conversion: false, gross_conversion: false,
    first_days: null, early_commitments: 0, cancelled_commitments: 0, test_days: 0,
    extension_hours: funding(trial.leaf).unresolved ? 0 : funding(trial.leaf).net / 60 };
  for (const chain of chains) {
    if (chain.root.id === trial.root.id) continue;
    if (chain.path.some(b=>b.is_trial)) continue;
    const committed = timestamp(chain.root.created_at), start = sessionAt(chain.leaf, timezone);
    const inCommitWindow = committed >= t0 && committed < until;
    const early = committed >= timestamp(intake.booked_at) && committed < t0;
    const inHoursWindow = start >= t0 && start < until;
    if (!(inCommitWindow || early || inHoursWindow)) continue;
    if (chain.error) { value.unresolved = true; continue; }
    const f = funding(chain.leaf), gross = Math.max(...chain.path.map(b=>funding(b).gross));
    if (chain.path.some(b=>funding(b).unresolved)) value.unresolved = true;
    if (chain.leaf.booking_purpose === 'test_date') { value.test_days++; continue; }
    const surviving = chain.leaf.status !== REFUNDED;
    if (inCommitWindow && gross > 0) value.gross_conversion = true;
    if (inCommitWindow && gross > 0 && (!surviving || f.net === 0)) value.cancelled_commitments++;
    if (inCommitWindow && surviving && f.net > 0) {
      value.net_conversion = true;
      value.first_days = Math.min(value.first_days ?? Infinity, (committed-t0)/86400000);
    }
    if (early && surviving && f.net > 0) value.early_commitments++;
    if (inHoursWindow && surviving) {
      value.hours += f.net/60;
      if (committed < t0) value.early_hours += f.net/60;
      if (chain.leaf.status === CHARGEABLE) value.chargeable_hours += f.net/60;
      if (!chain.leaf.cancelled_at && !chain.leaf.credit_forfeited && sessionAt(chain.leaf,timezone,true) <= asOf) value.elapsed_hours += f.net/60;
    }
  }
  return value;
}
function buildReport({ intakes, bookings, asOf, timezone, cohortBounds, missingIntakes = 0, purchases = [] }) {
  const at = timestamp(asOf), chains = resolveChains(bookings), groups = new Map();
  const quality = { missing_intakes: Number(missingIntakes), repeat_or_prior_trial: 0, existing_paid_customer: 0,
    unresolved_prior_funding: 0, invalid_chains: 0, excluded_test_accounts: 0, unknown_date: 0,
    full_curriculum_bookings_unresolved: bookings.filter(b=>Number(b.curriculum_count)>0).length,
    offline_legacy_flexible_bookings: bookings.filter(b=>b.flex_legacy).length,
    unresolved_booking_count: bookings.filter(b=>funding(b).unresolved).length };
  const counted = new Set();
  for (const intake of intakes.slice().sort((a,b)=>timestamp(a.booked_at)-timestamp(b.booked_at))) {
    const trial = chains.get(Number(intake.booking_id));
    if (!trial || trial.error || trial.root.id !== Number(intake.booking_id)) { quality.invalid_chains++; continue; }
    if (intake.is_test_account) { quality.excluded_test_accounts++; continue; }
    const learnerChains = [...new Map(bookings.filter(b=>b.learner_id===intake.learner_id).map(b=>{
      const chain=chains.get(Number(b.id)); return [chain.root.id,chain];
    })).values()];
    if (counted.has(intake.learner_id) || learnerChains.some(c=>c.root.id !== trial.root.id && c.path.some(b=>b.is_trial) && timestamp(c.root.created_at)<timestamp(intake.booked_at))) { quality.repeat_or_prior_trial++; continue; }
    counted.add(intake.learner_id);
    const prior = learnerChains.filter(c=>c.root.id!==trial.root.id && timestamp(c.root.created_at)<timestamp(intake.booked_at));
    if (prior.some(c=>c.path.some(b=>funding(b).gross>0))) { quality.existing_paid_customer++; continue; }
    if (prior.some(c=>c.error || c.path.some(b=>funding(b).unresolved))) { quality.unresolved_prior_funding++; continue; }
    const formVersion = intake.questionnaire?.version || 'test_details_v1';
    const route = intake.from_request ? 'request_to_booking' : intake.questionnaire ? 'direct_qualified' : 'legacy_direct';
    const key = [intake.segment,intake.entry_page,intake.content_version || 'unknown',formVersion,route].join('|');
    if (!groups.has(key)) groups.set(key,{ segment:intake.segment, source:intake.entry_page, content_version:intake.content_version || 'unknown', form_version:formVersion, route, booking_count:0, consented_bookings:0, unknown_date:0, exceptions:0, all:[], elapsed:[], final:[] });
    const g=groups.get(key); g.booking_count++; if(intake.analytics_consent_at_booking)g.consented_bookings++;
    if(intake.segment==='unknown'){g.unknown_date++;quality.unknown_date++;}
    const exception=trial.leaf.status===REFUNDED || !!trial.leaf.cancelled_at || !!trial.leaf.credit_forfeited;
    if(exception)g.exceptions++;
    const value=evaluate(intake,trial,learnerChains,at);
    g.all.push(evaluate(intake,trial,learnerChains,at,true));
    if(!exception){g.final.push(value);if(sessionAt(trial.leaf,intake.school_timezone,true)<=at)g.elapsed.push(value);}
  }
  return { ok:true, definition_version:DEFINITION_VERSION, as_of:new Date(asOf).toISOString(), school_timezone:timezone, cohort_bounds:cohortBounds,
    scope:'Paid funding: evidenced direct/Lesson Credit and Flexible Hours only. Full Curriculum, offline legacy, adjusted or contradictory sources are unresolved. No all-product paid-hours headline.',
    attendance:'Not reliably measurable. Elapsed without a recorded exception is not evidenced attendance; chargeable hours may include late cancellations.',
    retention:'Intakes retained for at most 24 months. Missing/erased snapshots are unknown coverage, never No. Duplicate accounts cannot be linked.',
    purchase_scope:'Successful purchase records for non-test accounts with selected intakes, including diagnostic cohorts; selected purchase-date range, gross recorded value/minutes before later refunds. Not net revenue or booked hours.',
    purchases, groups:[...groups.values()].map(g=>({segment:g.segment,source:g.source,content_version:g.content_version,form_version:g.form_version,route:g.route,booking_count:g.booking_count,
      consented_bookings:g.consented_bookings,consent_coverage:g.consented_bookings/g.booking_count,unknown_date_share:g.unknown_date/g.booking_count,
      exceptions:g.exceptions, all_booked_original_end:summarise(g.all), final_session_continuation:summarise(g.final), elapsed_without_recorded_exception:summarise(g.elapsed)})),data_quality:quality };
}
async function loadReport(sql, { schoolId, from, to, instructorId = null, asOf = new Date() }) {
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) throw Object.assign(new Error('Select a school.'), {status:400});
  const cohortBounds=bounds(from,to);
  if (instructorId !== null && (!Number.isSafeInteger(instructorId) || instructorId<=0)) throw Object.assign(new Error('Invalid instructor filter.'),{status:400});
  const [school]=await sql`SELECT config FROM schools WHERE id=${schoolId}`;
  const timezone=operationalTimeZone(school?.config || {});
  const intakes=await sql`SELECT t.*, lu.is_test_account,
    EXISTS(SELECT 1 FROM trial_request_bookings l WHERE l.school_id=${schoolId} AND l.booking_id=t.booking_id) AS from_request FROM trial_booking_intakes t
    JOIN learner_users lu ON lu.id=t.learner_id AND lu.school_id=${schoolId}
    WHERE t.school_id=${schoolId} AND t.booking_local_date>=${from}::date AND t.booking_local_date<${to}::date
      AND t.booked_at<=${asOf.toISOString()}::timestamptz AND (${instructorId}::int IS NULL OR t.instructor_id=${instructorId})
    ORDER BY t.booked_at LIMIT 10001`;
  if(intakes.length>10000)throw Object.assign(new Error('Too many intakes. Choose a shorter date range.'),{status:400});
  const ids=[...new Set(intakes.map(t=>t.learner_id))];
  const bookings=await sql`
    SELECT b.id,b.school_id,b.learner_id,b.instructor_id,b.created_at,b.rescheduled_from,b.scheduled_date::text,
      b.start_time::text,b.end_time::text,b.status,b.cancelled_at,b.credit_forfeited,b.booking_purpose,
      (lt.slug='trial' OR b.created_by='free_trial_self_serve' OR COALESCE(c.has_trial,false)) AS is_trial,
      COALESCE(c.gross,0) AS credit_gross,COALESCE(c.net,0) AS credit_net,
      COALESCE(f.gross,0) AS flex_gross,COALESCE(f.net,0) AS flex_net,
      COALESCE(fc.n,0) AS curriculum_count, COALESCE(f.legacy,false) AS flex_legacy,
      (COALESCE(c.unresolved,false) OR COALESCE(f.unresolved,false) OR
        ((COALESCE(b.minutes_deducted,0)>0 OR COALESCE(b.list_price_pence,0)>0) AND COALESCE(c.n,0)+COALESCE(f.n,0)+COALESCE(fc.n,0)=0)) AS funding_unresolved
    FROM lesson_bookings b LEFT JOIN lesson_types lt ON lt.id=b.lesson_type_id AND lt.school_id=${schoolId}
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, bool_or(ct.source='free_trial' AND ct.amount_pence=0 AND x.contribution_pence=0) AS has_trial,
        SUM(CASE WHEN ct.type IN ('purchase','slot_purchase') AND ct.amount_pence>0 AND ct.stripe_session_id IS NOT NULL THEN x.minutes_drawn ELSE 0 END) AS gross,
        SUM(CASE WHEN ct.type IN ('purchase','slot_purchase') AND ct.amount_pence>0 AND ct.stripe_session_id IS NOT NULL AND x.refunded_at IS NULL THEN x.minutes_drawn ELSE 0 END) AS net,
        bool_or(ct.id IS NULL OR EXISTS (SELECT 1 FROM credit_source_adjustments a WHERE a.credit_transaction_id=ct.id)
          OR (ct.amount_pence>0 AND (ct.type NOT IN ('purchase','slot_purchase') OR ct.stripe_session_id IS NULL))) AS unresolved
      FROM booking_credit_sources x LEFT JOIN credit_transactions ct ON ct.id=x.credit_transaction_id
        AND ct.school_id=${schoolId} AND ct.learner_id=b.learner_id
      WHERE x.school_id=${schoolId} AND x.booking_id=b.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, bool_or(s.purchase_id IS NULL) AS legacy, SUM(a.units_allocated*a.unit_minutes) AS gross,
        SUM((a.units_allocated-COALESCE(r.units_returned,0))*a.unit_minutes) AS net,
        bool_or(p.id IS NULL OR s.id IS NULL OR p.amount_pence<=0 OR p.stripe_checkout_session_id IS NULL
          OR p.stripe_checkout_session_id NOT LIKE 'cs_%' OR a.unit_minutes<>s.unit_minutes) AS unresolved
      FROM flexible_package_booking_allocations a
      LEFT JOIN flexible_package_allocation_returns r ON r.allocation_id=a.id AND r.school_id=${schoolId}
      LEFT JOIN flexible_package_sources s ON s.id=a.source_id AND s.school_id=${schoolId} AND s.learner_id=b.learner_id
      LEFT JOIN flexible_package_purchases p ON p.id=s.purchase_id AND p.school_id=${schoolId} AND p.learner_id=b.learner_id
      WHERE a.school_id=${schoolId} AND a.booking_id=b.id
    ) f ON true
    LEFT JOIN LATERAL (SELECT count(*) AS n FROM full_curriculum_booking_allocations a
      WHERE a.school_id=${schoolId} AND a.lesson_booking_id=b.id) fc ON true
    WHERE b.school_id=${schoolId} AND b.learner_id=ANY(${ids}::int[]) AND b.created_at<=${asOf.toISOString()}::timestamptz
    LIMIT 50001`;
  if(bookings.length>50000)throw Object.assign(new Error('Too many bookings. Choose a shorter date range.'),{status:400});
  const [coverage]=await sql`SELECT count(*) AS missing FROM lesson_bookings b
    LEFT JOIN lesson_types lt ON lt.id=b.lesson_type_id AND lt.school_id=${schoolId}
    WHERE b.school_id=${schoolId} AND (lt.slug='trial' OR b.created_by='free_trial_self_serve' OR EXISTS (
      SELECT 1 FROM booking_credit_sources x JOIN credit_transactions ct ON ct.id=x.credit_transaction_id AND ct.school_id=${schoolId}
      WHERE x.school_id=${schoolId} AND x.booking_id=b.id AND ct.learner_id=b.learner_id
        AND ct.source='free_trial' AND ct.amount_pence=0 AND x.contribution_pence=0)) AND b.rescheduled_from IS NULL
      AND (b.created_at AT TIME ZONE ${timezone})::date>=${from}::date AND (b.created_at AT TIME ZONE ${timezone})::date<${to}::date
      AND (${instructorId}::int IS NULL OR b.instructor_id=${instructorId})
      AND NOT EXISTS (SELECT 1 FROM trial_booking_intakes t WHERE t.school_id=${schoolId} AND t.booking_id=b.id)`;
  // Purchases have their own time range; never enter the booked-hours numerator.
  const purchaseLearners=intakes.filter(t=>!t.is_test_account).map(t=>t.learner_id);
  const purchases=await sql`
    WITH credit AS (
      SELECT stripe_session_id,max(amount_pence) AS value,max(minutes) AS minutes
      FROM credit_transactions WHERE school_id=${schoolId} AND learner_id=ANY(${purchaseLearners}::int[])
        AND type IN ('purchase','slot_purchase') AND amount_pence>0 AND stripe_session_id IS NOT NULL
        AND (created_at AT TIME ZONE ${timezone})::date>=${from}::date AND (created_at AT TIME ZONE ${timezone})::date<${to}::date
      GROUP BY stripe_session_id
    ), flexible AS (
      SELECT stripe_checkout_session_id,max(amount_pence) AS value,max(total_units*unit_minutes) AS minutes
      FROM flexible_package_purchases WHERE school_id=${schoolId} AND learner_id=ANY(${purchaseLearners}::int[]) AND amount_pence>0
        AND (paid_at AT TIME ZONE ${timezone})::date>=${from}::date AND (paid_at AT TIME ZONE ${timezone})::date<${to}::date
      GROUP BY stripe_checkout_session_id
    ), curriculum AS (
      SELECT stripe_checkout_session_id,max(amount_pence) AS value
      FROM learner_package_purchases WHERE school_id=${schoolId} AND learner_id=ANY(${purchaseLearners}::int[])
        AND product_slug='full-curriculum' AND amount_pence>0
        AND (paid_at AT TIME ZONE ${timezone})::date>=${from}::date AND (paid_at AT TIME ZONE ${timezone})::date<${to}::date
      GROUP BY stripe_checkout_session_id
    )
    SELECT 'direct_or_credit' AS family,count(*)::int AS purchase_count,COALESCE(sum(value),0)::bigint AS purchased_value_pence,COALESCE(sum(minutes),0)::bigint AS purchased_minutes FROM credit
    UNION ALL SELECT 'flexible',count(*)::int,COALESCE(sum(value),0)::bigint,COALESCE(sum(minutes),0)::bigint FROM flexible
    UNION ALL SELECT 'full_curriculum_unresolved_hours',count(*)::int,COALESCE(sum(value),0)::bigint,NULL::bigint FROM curriculum`;
  const requests = await sql`SELECT r.reason,r.questionnaire->>'route' AS qualified_route,
    count(*)::int AS submitted_requests,count(l.booking_id)::int AS linked_confirmed_bookings
    FROM trial_requests r LEFT JOIN trial_request_bookings l ON l.request_id=r.id AND l.school_id=${schoolId}
    LEFT JOIN lesson_bookings b ON b.id=l.booking_id AND b.school_id=${schoolId}
    WHERE r.school_id=${schoolId} AND (r.submitted_at AT TIME ZONE ${timezone})::date>=${from}::date
      AND (r.submitted_at AT TIME ZONE ${timezone})::date<${to}::date AND r.submitted_at<=${asOf.toISOString()}::timestamptz
      AND (${instructorId}::int IS NULL OR b.instructor_id=${instructorId})
    GROUP BY r.reason,r.questionnaire->>'route'`;
  return { ...buildReport({intakes,bookings,asOf,timezone,cohortBounds,missingIntakes:coverage?.missing,purchases}),
    trial_requests: requests, questionnaire_progress: 'Consented browser events only; no unconsented progress is collected. Requests are not bookings or paid conversions. Instructor filters exclude unassigned requests.' };
}
module.exports={bounds,resolveChains,funding,sessionAt,wilson,buildReport,loadReport};
