#!/usr/bin/env node

/**
 * Payout v2 Slice 2A read-only source-ingestion preview.
 *
 * Requires an explicit PAYOUT_V2_SCHOOL_ID. It reads candidate credit
 * transactions and, unless --database-only is supplied, retrieves immutable
 * Stripe PaymentIntent/charge/balance-transaction evidence. It never writes a
 * source, applies a migration, or calls a Stripe mutation.
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const Stripe = require('stripe');
const {
  SOURCE_KINDS,
  buildStripeSourceRecord,
  buildLegacySourceRecord,
} = require('../api/_payout-v2-source-writer');
const { fetchSessionFundingEvidence } = require('../api/_stripe-fee');

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

function sourceKindForType(type) {
  if (type === 'purchase') return SOURCE_KINDS.CREDIT_PURCHASE;
  if (type === 'slot_purchase') return SOURCE_KINDS.DIRECT_BOOKING;
  if (type === 'legacy_grandfather') return SOURCE_KINDS.LEGACY_CREDIT;
  throw new TypeError(`Unsupported source transaction type: ${type}`);
}

async function main() {
  loadEnvLocal();
  const schoolId = Number.parseInt(process.env.PAYOUT_V2_SCHOOL_ID, 10);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    throw new Error('Set PAYOUT_V2_SCHOOL_ID to the explicit school to preview; there is no default');
  }
  const databaseUrl = process.env.POSTGRES_URL_READONLY || process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL_READONLY or POSTGRES_URL is required');

  const databaseOnly = process.argv.includes('--database-only');
  if (!databaseOnly && !process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is required unless --database-only is supplied');
  }

  const sql = neon(databaseUrl);
  const [sourceTable] = await sql`
    SELECT to_regclass('public.payout_funding_sources') IS NOT NULL AS exists
  `;
  const candidates = sourceTable.exists
    ? await sql`
        SELECT
          ct.id,
          ct.school_id,
          ct.learner_id,
          ct.instructor_id,
          ct.type,
          ct.amount_pence,
          ct.stripe_fee_pence,
          ct.stripe_session_id,
          ct.stripe_payment_intent_id,
          ct.created_at
        FROM credit_transactions ct
        JOIN instructors i
          ON i.id = ct.instructor_id
         AND i.school_id = ct.school_id
        LEFT JOIN learner_users lu
          ON lu.id = ct.learner_id
         AND lu.school_id = ct.school_id
        LEFT JOIN payout_funding_sources pfs
          ON pfs.credit_transaction_id = ct.id
         AND pfs.school_id = ct.school_id
        WHERE ct.school_id = ${schoolId}
          AND ct.type IN ('purchase', 'slot_purchase', 'legacy_grandfather')
          AND (ct.learner_id IS NULL OR lu.id IS NOT NULL)
          AND pfs.id IS NULL
        ORDER BY ct.id
      `
    : await sql`
        SELECT
          ct.id,
          ct.school_id,
          ct.learner_id,
          ct.instructor_id,
          ct.type,
          ct.amount_pence,
          ct.stripe_fee_pence,
          ct.stripe_session_id,
          ct.stripe_payment_intent_id,
          ct.created_at
        FROM credit_transactions ct
        JOIN instructors i
          ON i.id = ct.instructor_id
         AND i.school_id = ct.school_id
        LEFT JOIN learner_users lu
          ON lu.id = ct.learner_id
         AND lu.school_id = ct.school_id
        WHERE ct.school_id = ${schoolId}
          AND ct.type IN ('purchase', 'slot_purchase', 'legacy_grandfather')
          AND (ct.learner_id IS NULL OR lu.id IS NOT NULL)
        ORDER BY ct.id
      `;

  const stripeClient = databaseOnly ? null : new Stripe(process.env.STRIPE_SECRET_KEY);
  const preview = [];
  for (const row of candidates) {
    const sourceKind = sourceKindForType(row.type);
    let record;
    let stripeChargeIdentityKind = null;
    if (sourceKind === SOURCE_KINDS.LEGACY_CREDIT) {
      record = buildLegacySourceRecord({ sourceRow: row, schoolId });
    } else {
      const stripeEvidence = databaseOnly
        ? {
            checkoutSessionId: row.stripe_session_id,
            paymentIntentId: row.stripe_payment_intent_id,
            amountPence: null,
            currency: null,
            feePence: null,
          }
        : await fetchSessionFundingEvidence({
            id: row.stripe_session_id || row.stripe_payment_intent_id,
            object: row.stripe_session_id ? 'checkout.session' : 'payment_intent',
            payment_intent: row.stripe_payment_intent_id,
          }, stripeClient);
      stripeChargeIdentityKind = stripeEvidence.chargeId
        ? `${String(stripeEvidence.chargeId).split('_')[0]}_`
        : null;
      record = buildStripeSourceRecord({
        sourceRow: row,
        schoolId,
        sourceKind,
        stripeEvidence,
      });
    }
    preview.push({
      credit_transaction_id: Number(row.id),
      source_kind: sourceKind,
      funding_class: record.funding_class,
      source_status: record.source_status,
      gross_collected_pence: record.gross_collected_pence,
      stripe_fee_pence: record.stripe_fee_pence,
      payable_pool_pence: record.payable_pool_pence,
      review_reasons: record.metadata.review_reasons || [],
      stripe_charge_identity_kind: stripeChargeIdentityKind,
    });
  }

  const summary = preview.reduce((result, row) => {
    const key = `${row.source_kind}:${row.funding_class}`;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const reviewReasonCounts = preview.reduce((result, row) => {
    for (const reason of row.review_reasons) {
      result[reason] = (result[reason] || 0) + 1;
    }
    return result;
  }, {});
  const stripeChargeIdentityKindCounts = preview.reduce((result, row) => {
    if (row.stripe_charge_identity_kind) {
      result[row.stripe_charge_identity_kind] =
        (result[row.stripe_charge_identity_kind] || 0) + 1;
    }
    return result;
  }, {});
  console.log(JSON.stringify({
    mode: databaseOnly ? 'database_only_fail_closed' : 'database_and_stripe_read_only',
    school_id: schoolId,
    payout_funding_sources_table_present: sourceTable.exists,
    candidate_count: preview.length,
    summary,
    review_reason_counts: reviewReasonCounts,
    stripe_charge_identity_kind_counts: stripeChargeIdentityKindCounts,
    candidates: preview,
  }, null, 2));
}

main().catch((err) => {
  console.error(`Payout v2 source preview failed: ${err.message}`);
  process.exitCode = 1;
});
