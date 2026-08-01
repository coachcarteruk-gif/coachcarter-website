#!/usr/bin/env node

// Read-only Slice 6 diagnostic. It performs SELECTs and one Stripe
// balance.retrieve() only. It never persists a snapshot, emits an alert, or
// calls a Stripe mutation API.

const { neon } = require('@neondatabase/serverless');
const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('../api/_stripe-clients');
const {
  computePayoutV2ProtectedBalance,
  calculateWithdrawalPreflight,
} = require('../api/_payout-v2-protected-balance');

function parseScope() {
  const kind = process.env.PAYOUT_V2_SCOPE;
  if (kind === 'global') return { kind: 'global', school_id: null };
  if (kind === 'school') {
    const schoolId = Number(process.env.PAYOUT_V2_SCHOOL_ID);
    if (!Number.isInteger(schoolId) || schoolId <= 0) {
      throw new Error('PAYOUT_V2_SCHOOL_ID must be a positive integer for school scope');
    }
    return { kind: 'school', school_id: schoolId };
  }
  throw new Error('Set PAYOUT_V2_SCOPE explicitly to global or school');
}

async function main() {
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is required');
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required for this explicit read-only diagnostic');
  const scope = parseScope();
  const sql = neon(process.env.POSTGRES_URL);
  const stripe = createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.RECONCILIATION });
  const calculation = await computePayoutV2ProtectedBalance({
    sql,
    scope,
    readStripeBalance: async () => {
      const balance = await stripe.balance.retrieve();
      const gbp = (rows) => Number((rows || []).find((row) => row.currency === 'gbp')?.amount || 0);
      return {
        scope: { kind: 'global', school_id: null },
        available_pence: gbp(balance.available),
        pending_pence: gbp(balance.pending),
        read_at: new Date().toISOString(),
      };
    },
  });

  const output = { ok: true, read_only: true, calculation };
  const scenario = process.env.PAYOUT_V2_PROPOSED_WITHDRAWAL_PENCE;
  if (scenario !== undefined) {
    output.withdrawal_scenario = calculateWithdrawalPreflight({
      calculation,
      proposed_withdrawal_pence: Number(scenario),
      requested_scope: scope,
      expected_calculation_fingerprint: calculation.calculation_fingerprint,
      idempotency_identity: `payout-v2:withdrawal:diagnostic:${calculation.position_fingerprint.slice(7, 23)}`,
      phase: 'review',
    });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    read_only: true,
    code: 'PAYOUT_V2_PROTECTED_BALANCE_DIAGNOSTIC_FAILED',
    message: error.message,
  })}\n`);
  process.exitCode = 1;
});
