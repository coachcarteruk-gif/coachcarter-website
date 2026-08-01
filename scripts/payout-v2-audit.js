#!/usr/bin/env node

/**
 * Payout v2 Slice 0 read-only forensic.
 *
 * This script only issues database SELECTs and Stripe list/retrieve requests.
 * It never applies a migration, writes financial data, or calls a Stripe
 * mutation. Output is aggregate/accounting evidence without learner PII.
 *
 * Usage:
 *   node scripts/payout-v2-audit.js
 *   node scripts/payout-v2-audit.js --database-only
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const {
  createPlatformStripeClient,
  STRIPE_CLIENT_PURPOSES,
  STRIPE_NETWORK_PROFILES,
} = require('../api/_stripe-clients');

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function integer(value) {
  return Number(value || 0);
}

async function readDatabase(databaseUrl) {
  const sql = neon(databaseUrl);

  const [legacySources, legacyAllocations, legacyLive, june19Payouts] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS source_rows,
        COALESCE(SUM(minutes), 0)::int AS minutes,
        COALESCE(SUM(amount_pence), 0)::int AS amount_pence,
        COUNT(*) FILTER (WHERE COALESCE(amount_pence, 0) <> 0)::int
          AS positive_amount_violations
      FROM credit_transactions
      WHERE type = 'legacy_grandfather'
    `,
    sql`
      SELECT
        COUNT(*)::int AS allocation_rows,
        COALESCE(SUM(bcs.minutes_drawn), 0)::int AS minutes_drawn,
        COALESCE(SUM(bcs.contribution_pence), 0)::int AS contribution_pence,
        COALESCE(SUM(bcs.stripe_fee_pence), 0)::int AS stripe_fee_pence,
        COUNT(*) FILTER (
          WHERE COALESCE(bcs.contribution_pence, 0) <> 0
             OR COALESCE(bcs.stripe_fee_pence, 0) <> 0
        )::int AS positive_contribution_violations
      FROM booking_credit_sources bcs
      JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id
       AND ct.school_id = bcs.school_id
      WHERE ct.type = 'legacy_grandfather'
    `,
    sql`
      SELECT
        lb.school_id,
        lb.status,
        COUNT(DISTINCT lb.id)::int AS booking_count,
        COALESCE(SUM(bcs.contribution_pence)
          FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS source_contribution_pence,
        COALESCE(SUM(bcs.stripe_fee_pence)
          FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS source_stripe_fee_pence,
        COUNT(DISTINCT lb.id) FILTER (
          WHERE COALESCE(bcs.contribution_pence, 0) <> 0
             OR COALESCE(bcs.stripe_fee_pence, 0) <> 0
        )::int AS positive_booking_violations
      FROM lesson_bookings lb
      JOIN booking_credit_sources bcs
        ON bcs.booking_id = lb.id
       AND bcs.school_id = lb.school_id
      JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id
       AND ct.school_id = bcs.school_id
       AND ct.type = 'legacy_grandfather'
      WHERE lb.status IN ('scheduled', 'chargeable')
      GROUP BY lb.school_id, lb.status
      ORDER BY lb.school_id, lb.status
    `,
    sql`
      SELECT
        ip.school_id,
        ip.id AS payout_id,
        ip.amount_pence,
        ip.platform_fee_pence,
        ip.stripe_fees_pence,
        ip.stripe_transfer_id,
        ip.status,
        COUNT(pli.id)::int AS line_count,
        COALESCE(SUM(pli.instructor_amount_pence), 0)::int AS line_instructor_pence
      FROM instructor_payouts ip
      LEFT JOIN payout_line_items pli
        ON pli.payout_id = ip.id
       AND pli.school_id = ip.school_id
      WHERE ip.created_at >= TIMESTAMPTZ '2026-06-19 00:00:00+00'
        AND ip.created_at <  TIMESTAMPTZ '2026-06-20 00:00:00+00'
      GROUP BY ip.school_id, ip.id
      ORDER BY ip.id
    `,
  ]);

  const [
    ambiguousCohorts,
    ambiguousV1Eligible,
    crossRoute,
    routeConfiguration,
    tenantViolations,
    localTransfers,
  ] =
    await Promise.all([
      sql`
        SELECT
          lb.school_id,
          CASE
            WHEN lb.payment_method = 'cash' THEN 'cash_manual_review'
            WHEN lb.payment_method = 'free' OR lb.created_by = 'free_trial_self_serve'
              THEN 'free_zero'
            WHEN lb.created_by ILIKE 'setmore%' THEN 'setmore_external_manual_review'
            ELSE 'other_non_credit_manual_review'
          END AS cohort,
          lb.status,
          COUNT(*)::int AS booking_count,
          COALESCE(SUM(lb.list_price_pence), 0)::int AS snapshotted_list_pence
        FROM lesson_bookings lb
        WHERE lb.payment_method IN ('cash', 'free')
           OR lb.created_by ILIKE 'setmore%'
        GROUP BY lb.school_id, cohort, lb.status
        ORDER BY lb.school_id, cohort, lb.status
      `,
      sql`
        SELECT
          lb.school_id,
          CASE
            WHEN lb.payment_method = 'cash' THEN 'cash_manual_review'
            WHEN lb.created_by ILIKE 'setmore%' THEN 'setmore_external_manual_review'
            ELSE 'other_manual_review'
          END AS cohort,
          COUNT(*)::int AS currently_v1_eligible_bookings,
          COALESCE(SUM(
            COALESCE(
              lb.list_price_pence,
              CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL
                THEN ROUND(iln.custom_hourly_rate_pence * COALESCE(lt.duration_minutes, 90) / 60.0)
                ELSE COALESCE(lt.price_pence, 8250)
              END
            )
          ), 0)::int AS v1_live_fallback_pence
        FROM lesson_bookings lb
        JOIN instructors i
          ON i.id = lb.instructor_id
         AND i.school_id = lb.school_id
         AND i.active = TRUE
         AND i.stripe_onboarding_complete = TRUE
         AND i.payouts_paused = FALSE
         AND i.stripe_account_id IS NOT NULL
        LEFT JOIN learner_users lu
          ON lu.id = lb.learner_id
         AND lu.school_id = lb.school_id
        LEFT JOIN lesson_types lt
          ON lt.id = lb.lesson_type_id
         AND lt.school_id = lb.school_id
        LEFT JOIN instructor_learner_notes iln
          ON iln.instructor_id = lb.instructor_id
         AND iln.learner_id = lb.learner_id
         AND iln.school_id = lb.school_id
        WHERE (lb.payment_method = 'cash' OR lb.created_by ILIKE 'setmore%')
          AND lb.status = 'chargeable'
          AND (i.payouts_start_date IS NULL OR lb.scheduled_date >= i.payouts_start_date)
          AND COALESCE(lu.is_test_account, FALSE) = FALSE
          AND NOT EXISTS (
            SELECT 1
            FROM payout_line_items pli
            WHERE pli.booking_id = lb.id
              AND pli.school_id = lb.school_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM booking_credit_sources bcs
            WHERE bcs.booking_id = lb.id
              AND bcs.school_id = lb.school_id
              AND bcs.refunded_at IS NULL
              AND bcs.absorbed_by = 'instructor'
          )
        GROUP BY lb.school_id, cohort
        ORDER BY lb.school_id, cohort
      `,
      sql`
        SELECT
          pli.booking_id,
          pli.school_id AS direct_school_id,
          sp.school_id AS school_route_school_id,
          pli.payout_id,
          spli.school_payout_id
        FROM payout_line_items pli
        JOIN school_payout_line_items spli ON spli.booking_id = pli.booking_id
        JOIN school_payouts sp ON sp.id = spli.school_payout_id
        ORDER BY pli.booking_id
      `,
      sql`
        SELECT
          s.id AS school_id,
          s.stripe_onboarding_complete AS school_connect_ready,
          COUNT(i.id) FILTER (
            WHERE i.stripe_onboarding_complete = TRUE
              AND i.payouts_paused = FALSE
              AND i.stripe_account_id IS NOT NULL
          )::int AS direct_ready_instructors
        FROM schools s
        LEFT JOIN instructors i ON i.school_id = s.id
        GROUP BY s.id, s.stripe_onboarding_complete
        ORDER BY s.id
      `,
      sql`
        WITH violations AS (
          SELECT 'booking_instructor' AS relation, COUNT(*)::int AS violation_count
          FROM lesson_bookings lb JOIN instructors i ON i.id = lb.instructor_id
          WHERE lb.school_id <> i.school_id
          UNION ALL
          SELECT 'booking_learner', COUNT(*)::int
          FROM lesson_bookings lb JOIN learner_users lu ON lu.id = lb.learner_id
          WHERE lb.school_id <> lu.school_id
          UNION ALL
          SELECT 'credit_instructor', COUNT(*)::int
          FROM credit_transactions ct JOIN instructors i ON i.id = ct.instructor_id
          WHERE ct.instructor_id IS NOT NULL AND ct.school_id <> i.school_id
          UNION ALL
          SELECT 'bcs_booking', COUNT(*)::int
          FROM booking_credit_sources bcs JOIN lesson_bookings lb ON lb.id = bcs.booking_id
          WHERE bcs.school_id <> lb.school_id
          UNION ALL
          SELECT 'bcs_credit_transaction', COUNT(*)::int
          FROM booking_credit_sources bcs
          JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
          WHERE bcs.school_id <> ct.school_id
          UNION ALL
          SELECT 'direct_payout_instructor', COUNT(*)::int
          FROM instructor_payouts ip JOIN instructors i ON i.id = ip.instructor_id
          WHERE ip.school_id <> i.school_id
          UNION ALL
          SELECT 'direct_payout_line_parent', COUNT(*)::int
          FROM payout_line_items pli JOIN instructor_payouts ip ON ip.id = pli.payout_id
          WHERE pli.school_id <> ip.school_id
          UNION ALL
          SELECT 'direct_payout_line_booking', COUNT(*)::int
          FROM payout_line_items pli JOIN lesson_bookings lb ON lb.id = pli.booking_id
          WHERE pli.school_id <> lb.school_id
          UNION ALL
          SELECT 'school_payout_line_booking', COUNT(*)::int
          FROM school_payout_line_items spli
          JOIN school_payouts sp ON sp.id = spli.school_payout_id
          JOIN lesson_bookings lb ON lb.id = spli.booking_id
          WHERE sp.school_id <> lb.school_id
        )
        SELECT * FROM violations ORDER BY relation
      `,
      sql`
        SELECT
          'direct' AS payout_route,
          ip.school_id,
          ip.id AS payout_id,
          ip.status,
          ip.amount_pence,
          ip.stripe_transfer_id,
          ip.created_at,
          ip.completed_at,
          i.stripe_account_id AS destination_account_id
        FROM instructor_payouts ip
        JOIN instructors i ON i.id = ip.instructor_id AND i.school_id = ip.school_id
        UNION ALL
        SELECT
          'school',
          sp.school_id,
          sp.id,
          sp.status,
          sp.amount_pence,
          sp.stripe_transfer_id,
          sp.created_at,
          sp.completed_at,
          s.stripe_account_id
        FROM school_payouts sp
        JOIN schools s ON s.id = sp.school_id
        ORDER BY created_at, payout_route, payout_id
      `,
    ]);

  const localTransferIds = localTransfers
    .map((row) => row.stripe_transfer_id)
    .filter(Boolean);
  const duplicateTransferIds = [...new Set(
    localTransferIds.filter((id, index) => localTransferIds.indexOf(id) !== index)
  )];
  const unresolvedLocal = localTransfers.filter(
    (row) =>
      row.status === 'processing' ||
      (row.status === 'completed' && !row.stripe_transfer_id)
  );

  return {
    legacy: {
      sources: legacySources[0],
      allocations: legacyAllocations[0],
      live_bookings: legacyLive,
      confirmed_zero_contribution:
        integer(legacySources[0].positive_amount_violations) === 0 &&
        integer(legacyAllocations[0].positive_contribution_violations) === 0 &&
        legacyLive.every((row) => integer(row.positive_booking_violations) === 0),
    },
    june_19_payouts: june19Payouts,
    ambiguous_cohorts: ambiguousCohorts,
    ambiguous_current_v1_eligibility: ambiguousV1Eligible,
    cross_route_claims: crossRoute,
    route_configuration: routeConfiguration.map((row) => ({
      ...row,
      inferred_current_route:
        row.school_connect_ready && integer(row.direct_ready_instructors) > 0
          ? 'overlap_manual_review'
          : row.school_connect_ready
            ? 'school'
            : integer(row.direct_ready_instructors) > 0
              ? 'instructor_direct'
              : 'no_ready_route',
    })),
    route_configuration_overlap: routeConfiguration.filter(
      (row) => row.school_connect_ready && integer(row.direct_ready_instructors) > 0
    ),
    tenant_scope: {
      checks: tenantViolations,
      violation_total: tenantViolations.reduce(
        (sum, row) => sum + integer(row.violation_count),
        0
      ),
      structural_note:
        'school_payout_line_items has no school_id; its school is derived from school_payouts',
    },
    local_transfers: localTransfers,
    unresolved_local_transfers: unresolvedLocal,
    duplicate_local_transfer_ids: duplicateTransferIds,
  };
}

async function listAll(listCall, params, options) {
  const rows = [];
  let startingAfter;
  do {
    const page = await listCall(
      { ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      options
    );
    rows.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  } while (rows.length < 10_000);
  return rows;
}

async function readStripe(stripeSecretKey, database) {
  const stripe = createPlatformStripeClient({
    purpose: STRIPE_CLIENT_PURPOSES.RECONCILIATION,
    networkProfile: STRIPE_NETWORK_PROFILES.READ_ONLY_AUDIT,
    env: { STRIPE_SECRET_KEY: stripeSecretKey },
  });
  const stripeTransfers = await listAll(
    stripe.transfers.list.bind(stripe.transfers),
    {}
  );
  const stripeById = new Map(stripeTransfers.map((transfer) => [transfer.id, transfer]));
  const localWithIds = database.local_transfers.filter((row) => row.stripe_transfer_id);
  const missingInStripe = localWithIds
    .filter((row) => !stripeById.has(row.stripe_transfer_id))
    .map((row) => ({
      payout_route: row.payout_route,
      school_id: row.school_id,
      payout_id: row.payout_id,
      stripe_transfer_id: row.stripe_transfer_id,
    }));

  const localIds = new Set(localWithIds.map((row) => row.stripe_transfer_id));
  const destinations = new Set(
    database.local_transfers.map((row) => row.destination_account_id).filter(Boolean)
  );
  const unexplainedToKnownDestinations = stripeTransfers
    .filter((transfer) => destinations.has(transfer.destination) && !localIds.has(transfer.id))
    .map((transfer) => ({
      stripe_transfer_id: transfer.id,
      destination_account_id: transfer.destination,
      amount_pence: transfer.amount,
      currency: transfer.currency,
      created: new Date(transfer.created * 1000).toISOString(),
      reversed: transfer.reversed,
    }));

  const connectedPayouts = [];
  for (const accountId of [...destinations].sort()) {
    const payouts = await listAll(
      stripe.payouts.list.bind(stripe.payouts),
      {},
      { stripeAccount: accountId }
    );
    connectedPayouts.push({
      connected_account_id: accountId,
      status_counts: payouts.reduce((counts, payout) => {
        counts[payout.status] = (counts[payout.status] || 0) + 1;
        return counts;
      }, {}),
      payouts: payouts.map((payout) => ({
        stripe_payout_id: payout.id,
        amount_pence: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrival_date: payout.arrival_date
          ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10)
          : null,
        created: new Date(payout.created * 1000).toISOString(),
        failure_code: payout.failure_code || null,
      })),
    });
  }

  return {
    local_transfer_count: localWithIds.length,
    stripe_transfer_count: stripeTransfers.length,
    missing_local_transfer_ids_in_stripe: missingInStripe,
    unexplained_stripe_transfers_to_known_destinations: unexplainedToKnownDestinations,
    matched_local_transfer_count: localWithIds.length - missingInStripe.length,
    connected_bank_payouts: connectedPayouts,
    mapping_caveat:
      'A connected-account bank payout can aggregate funds; it is not attributed to a CoachCarter batch without explicit Stripe evidence.',
  };
}

async function main() {
  loadEnvLocal();
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is required for the read-only audit');

  const database = await readDatabase(databaseUrl);
  const databaseOnly = process.argv.includes('--database-only');
  let stripe = {
    skipped: true,
    reason: databaseOnly
      ? '--database-only supplied'
      : 'STRIPE_SECRET_KEY is not configured',
  };
  if (!databaseOnly && process.env.STRIPE_SECRET_KEY) {
    stripe = await readStripe(process.env.STRIPE_SECRET_KEY, database);
  }

  process.stdout.write(`${JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    database,
    stripe,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Payout v2 read-only audit failed: ${error.message}\n`);
  process.exitCode = 1;
});
