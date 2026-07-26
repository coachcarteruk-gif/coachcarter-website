const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  BLOCKER_CODES,
  buildProtectedBalanceAlert,
  calculateProtectedBalance,
  calculateWithdrawalPreflight,
  emitProtectedBalanceAlert,
} = require('../api/_payout-v2-protected-balance');
const {
  AUTHORITY_REFUSAL_CODES,
  authorizePayoutV2Mutation,
} = require('../api/_payout-v2-authority');
const {
  persistWithdrawalPreflightEvidence,
} = require('../api/_payout-v2-platform-balance-contract');

const hash = (letter) => `sha256:${letter.repeat(64)}`;

function protectedInput(overrides = {}) {
  return {
    scope: { kind: 'global', school_id: null },
    cash_scope: { kind: 'global', school_id: null },
    input_timestamp: '2026-07-25T12:00:00.000Z',
    stripe_read_at: '2026-07-25T12:00:00.000Z',
    stripe_available_pence: 100_000,
    stripe_pending_pence: 25_000,
    exact_unused_refundable_source_exposure_pence: 20_000,
    earned_untransferred_instructor_obligations_pence: 15_000,
    submitted_reconciling_not_reflected_pence: 5_000,
    approved_unexecuted_refund_obligations_pence: 3_000,
    configured_dispute_refund_risk_reserve_pence: 7_000,
    transfers_ready_now_pence: 12_000,
    blockers: [],
    ...overrides,
  };
}

function authorityInput(overrides = {}) {
  return {
    actor: {
      authenticated: true,
      authority_class: 'superadmin',
      id: 9,
    },
    operation: 'withdrawal_preflight',
    scope: { kind: 'global', school_id: null },
    reason: 'Reviewed platform liquidity withdrawal',
    confirmation_phrase: 'CONFIRM_PAYOUT_V2_OPERATION',
    required_confirmation_phrase: 'CONFIRM_PAYOUT_V2_OPERATION',
    idempotency_identity: `payout-v2:withdrawal:review:sha256:${'a'.repeat(64)}`,
    expected_fingerprint: hash('b'),
    actual_fingerprint: hash('b'),
    ...overrides,
  };
}

test.describe('Payout v2 protected balance', () => {
  test('conserves every protected component in integer pence', () => {
    const result = calculateProtectedBalance(protectedInput());
    expect(result.protected_free_cash_pence).toBe(50_000);
    expect(result.transfer_readiness_pence).toBe(88_000);
    expect(result.components).toEqual({
      exact_unused_refundable_source_exposure_pence: 20_000,
      earned_untransferred_instructor_obligations_pence: 15_000,
      submitted_reconciling_not_reflected_pence: 5_000,
      approved_unexecuted_refund_obligations_pence: 3_000,
      configured_dispute_refund_risk_reserve_pence: 7_000,
    });
  });

  test('keeps positive, zero, and negative protected positions exact', () => {
    expect(calculateProtectedBalance(protectedInput()).protected_free_cash_pence).toBe(50_000);
    expect(calculateProtectedBalance(protectedInput({
      stripe_available_pence: 50_000,
    })).protected_free_cash_pence).toBe(0);
    expect(calculateProtectedBalance(protectedInput({
      stripe_available_pence: 49_999,
    })).protected_free_cash_pence).toBe(-1);
  });

  test('pending cash is display-only and transfer readiness is not safe-to-withdraw cash', () => {
    const base = calculateProtectedBalance(protectedInput());
    const morePending = calculateProtectedBalance(protectedInput({ stripe_pending_pence: 9_999_999 }));
    expect(morePending.protected_free_cash_pence).toBe(base.protected_free_cash_pence);
    expect(base.pending_cash_treatment).toBe('display_only_not_withdrawable');
    expect(base.transfer_readiness_pence).not.toBe(base.protected_free_cash_pence);
  });

  test('does not double-count transfer amounts already proven removed from available cash', () => {
    const result = calculateProtectedBalance(protectedInput({
      earned_untransferred_instructor_obligations_pence: 15_000,
      submitted_reconciling_not_reflected_pence: 0,
    }));
    expect(result.protected_free_cash_pence).toBe(55_000);
    expect(result.double_count_prevention.transfer_obligations)
      .toContain('not proven removed');
  });

  test('fingerprints are deterministic and timestamp-sensitive', () => {
    const one = calculateProtectedBalance(protectedInput());
    const two = calculateProtectedBalance(protectedInput());
    const later = calculateProtectedBalance(protectedInput({
      input_timestamp: '2026-07-25T12:00:01.000Z',
    }));
    expect(two.calculation_fingerprint).toBe(one.calculation_fingerprint);
    expect(two.position_fingerprint).toBe(one.position_fingerprint);
    expect(later.calculation_fingerprint).not.toBe(one.calculation_fingerprint);
    expect(later.position_fingerprint).toBe(one.position_fingerprint);
  });

  test('school liabilities cannot be paired with global Stripe cash as a safe school withdrawal', () => {
    const result = calculateProtectedBalance(protectedInput({
      scope: { kind: 'school', school_id: 2 },
      cash_scope: { kind: 'global', school_id: null },
    }));
    expect(result.safe_for_platform_withdrawal).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: BLOCKER_CODES.STRIPE_BALANCE_SCOPE_MISMATCH,
    }));
  });

  test('missing, stale, manual-review, cross-school, and ambiguous evidence blocks', () => {
    const codes = [
      BLOCKER_CODES.STRIPE_BALANCE_MISSING,
      BLOCKER_CODES.STRIPE_BALANCE_STALE,
      BLOCKER_CODES.MANUAL_REVIEW_EVIDENCE,
      BLOCKER_CODES.CROSS_SCHOOL_EVIDENCE,
      BLOCKER_CODES.RECONCILING_TRANSFER_AMBIGUOUS,
    ];
    const result = calculateProtectedBalance(protectedInput({
      blockers: codes.map((code) => ({ code })),
    }));
    expect(result.operator_review_required).toBe(true);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(codes.slice().sort());
  });

  test('configured reserve is an input and no commercial reserve is hardcoded', () => {
    const zero = calculateProtectedBalance(protectedInput({
      configured_dispute_refund_risk_reserve_pence: 0,
    }));
    const configured = calculateProtectedBalance(protectedInput({
      configured_dispute_refund_risk_reserve_pence: 12_345,
    }));
    expect(zero.protected_free_cash_pence - configured.protected_free_cash_pence).toBe(12_345);
    const source = fs.readFileSync(path.join(__dirname, '..', 'api', '_payout-v2-protected-balance.js'), 'utf8');
    expect(source).not.toMatch(/RISK_RESERVE_PENCE\s*=\s*\d/);
  });
});

test.describe('Payout v2 withdrawal preflight', () => {
  test('returns exact before/after arithmetic and accurate operator wording', () => {
    const calculation = calculateProtectedBalance(protectedInput());
    const result = calculateWithdrawalPreflight({
      calculation,
      proposed_withdrawal_pence: 10_000,
      requested_scope: { kind: 'global', school_id: null },
      expected_calculation_fingerprint: calculation.calculation_fingerprint,
      idempotency_identity: 'payout-v2:withdrawal:review:20260725',
      phase: 'review',
    });
    expect(result).toMatchObject({
      protected_free_cash_pence: 50_000,
      proposed_withdrawal_pence: 10_000,
      projected_protected_free_cash_pence: 40_000,
      allowed: true,
    });
    expect(result.operator_wording).toContain('Recheck this exact calculation fingerprint');
  });

  test('refuses a negative projection, changed fingerprint, stale evidence, and wrong scope', () => {
    const calculation = calculateProtectedBalance(protectedInput({
      blockers: [{ code: BLOCKER_CODES.STRIPE_BALANCE_STALE }],
    }));
    const result = calculateWithdrawalPreflight({
      calculation,
      proposed_withdrawal_pence: 60_000,
      requested_scope: { kind: 'school', school_id: 1 },
      expected_calculation_fingerprint: hash('f'),
      idempotency_identity: 'payout-v2:withdrawal:attempt:20260725',
      phase: 'attempt',
    });
    const codes = result.blockers.map((blocker) => blocker.code);
    expect(result.allowed).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      BLOCKER_CODES.NEGATIVE_PROJECTED_PROTECTED_BALANCE,
      BLOCKER_CODES.CALCULATION_FINGERPRINT_CHANGED,
      BLOCKER_CODES.STRIPE_BALANCE_STALE,
      BLOCKER_CODES.SCOPE_MISMATCH,
      BLOCKER_CODES.WITHDRAWAL_REQUIRES_GLOBAL_SCOPE,
    ]));
  });

  test('requires positive integer pence and deterministic replay identity', () => {
    const calculation = calculateProtectedBalance(protectedInput());
    expect(() => calculateWithdrawalPreflight({
      calculation,
      proposed_withdrawal_pence: 0,
      requested_scope: calculation.scope,
      idempotency_identity: 'bad',
    })).toThrow(/positive integer/);
  });
});

test.describe('Payout v2 mutation authority', () => {
  test('permits authenticated cron, superadmin, and configured scoped operator', () => {
    expect(authorizePayoutV2Mutation(authorityInput()).allowed).toBe(true);
    expect(authorizePayoutV2Mutation(authorityInput({
      actor: {
        authenticated: true,
        cron_authenticated: true,
        authority_class: 'cron',
        allowed_operations: ['withdrawal_preflight'],
      },
    })).allowed).toBe(true);
    expect(authorizePayoutV2Mutation(authorityInput({
      scope: { kind: 'school', school_id: 3 },
      actor: {
        authenticated: true,
        authority_class: 'scoped_operator',
        id: 33,
        configuration_present: true,
        allowed_operations: ['withdrawal_preflight'],
        allowed_school_ids: [3],
        allow_global: false,
      },
    })).allowed).toBe(true);
  });

  test('rejects ordinary school admin, cross-school operator, missing config, and global escalation', () => {
    const schoolAdmin = authorizePayoutV2Mutation(authorityInput({
      actor: { authenticated: true, authority_class: 'school_admin', id: 4 },
    }));
    expect(schoolAdmin.refusals).toContainEqual(refusal(AUTHORITY_REFUSAL_CODES.ORDINARY_SCHOOL_ADMIN_FORBIDDEN));

    const scoped = authorizePayoutV2Mutation(authorityInput({
      scope: { kind: 'school', school_id: 2 },
      actor: {
        authenticated: true,
        authority_class: 'scoped_operator',
        configuration_present: false,
        allowed_operations: ['withdrawal_preflight'],
        allowed_school_ids: [1],
        allow_global: false,
      },
    }));
    expect(scoped.refusals.map((item) => item.code)).toEqual(expect.arrayContaining([
      AUTHORITY_REFUSAL_CODES.OPERATOR_CONFIGURATION_MISSING,
      AUTHORITY_REFUSAL_CODES.CROSS_SCHOOL_ACCESS,
    ]));
  });

  test('requires reason, confirmation, deterministic idempotency, and exact fingerprint', () => {
    const result = authorizePayoutV2Mutation(authorityInput({
      reason: '',
      confirmation_phrase: 'wrong',
      idempotency_identity: 'random',
      expected_fingerprint: hash('c'),
    }));
    expect(result.allowed).toBe(false);
    expect(result.refusals.map((item) => item.code)).toEqual(expect.arrayContaining([
      AUTHORITY_REFUSAL_CODES.REASON_REQUIRED,
      AUTHORITY_REFUSAL_CODES.CONFIRMATION_REQUIRED,
      AUTHORITY_REFUSAL_CODES.IDEMPOTENCY_IDENTITY_REQUIRED,
      AUTHORITY_REFUSAL_CODES.FINGERPRINT_CHANGED,
    ]));
  });

  test('persists approval only when both liquidity preflight and mutation authority allow', async () => {
    const calculation = calculateProtectedBalance(protectedInput());
    const preflight = calculateWithdrawalPreflight({
      calculation,
      proposed_withdrawal_pence: 10_000,
      requested_scope: calculation.scope,
      expected_calculation_fingerprint: calculation.calculation_fingerprint,
      idempotency_identity: 'payout-v2:withdrawal:review:authority-refusal',
      phase: 'review',
    });
    const authority = authorizePayoutV2Mutation(authorityInput({
      expected_fingerprint: hash('c'),
    }));
    const writes = [];
    const sql = async (strings, ...values) => {
      writes.push({ strings, values });
      return [{ id: 1 }];
    };

    await persistWithdrawalPreflightEvidence(sql, {
      preflight,
      authority,
      reason: 'Record refused withdrawal authority',
    });

    expect(preflight.allowed).toBe(true);
    expect(authority.allowed).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0].values[4]).toBe(9);
    expect(writes[0].values[12]).toBe('refused');
    expect(JSON.parse(writes[0].values[13])).toContain(
      AUTHORITY_REFUSAL_CODES.FINGERPRINT_CHANGED
    );
  });
});

function refusal(code) {
  return { code, non_pii: true };
}

test.describe('Payout v2 protected-balance alerts and inactivity', () => {
  test('classifies negative positions and deduplicates by stable position evidence', () => {
    const calculation = calculateProtectedBalance(protectedInput({
      stripe_available_pence: 10_000,
    }));
    const one = buildProtectedBalanceAlert(calculation);
    const two = buildProtectedBalanceAlert(calculation);
    expect(one.classification).toBe('ordinary_liability_growth');
    expect(two.deduplication_identity).toBe(one.deduplication_identity);
    expect(one.non_pii).toBe(true);
  });

  test('distinguishes an observed manual Dashboard withdrawal from unexplained movement', () => {
    const calculation = calculateProtectedBalance(protectedInput({
      stripe_available_pence: 10_000,
    }));
    const manual = buildProtectedBalanceAlert(calculation, {
      previous_snapshot: {
        stripe_available_pence: 100_000,
        external_dashboard_payout_observed: true,
      },
      known_available_movement_pence: 0,
    });
    const unexplained = buildProtectedBalanceAlert(calculation, {
      previous_snapshot: {
        stripe_available_pence: 100_000,
        external_dashboard_payout_observed: false,
      },
      known_available_movement_pence: 0,
    });
    expect(manual.classification).toBe('observed_external_manual_dashboard_withdrawal');
    expect(unexplained.classification).toBe('unexplained_balance_movement');
  });

  test('awaits transport and evidence; duplicate claims suppress alert storms', async () => {
    const calculation = calculateProtectedBalance(protectedInput({ stripe_available_pence: 10_000 }));
    const calls = [];
    const emitted = await emitProtectedBalanceAlert({
      calculation,
      alertTransport: async () => {
        calls.push('transport');
        return { reference: 'test-alert-1' };
      },
      persistEvidence: async (payload) => {
        calls.push(payload.phase);
        return { inserted: true };
      },
    });
    expect(emitted.emitted).toBe(true);
    expect(calls).toEqual(['claim', 'transport', 'result']);

    const duplicate = await emitProtectedBalanceAlert({
      calculation,
      alertTransport: async () => { throw new Error('must not run'); },
      persistEvidence: async () => ({ duplicate: true }),
    });
    expect(duplicate).toMatchObject({ emitted: false, duplicate: true });
  });

  test('uses one inactive authority for widget composition and snapshot evidence', () => {
    const contract = fs.readFileSync(
      path.join(__dirname, '..', 'api', '_payout-v2-platform-balance-contract.js'),
      'utf8'
    );
    expect(contract).toContain('protectedBalanceAuthority = computePayoutV2ProtectedBalance');
    expect(contract).toContain('payout_v2_protected_balance: protectedBalance');
    expect(contract).toContain('calculation.calculation_fingerprint');
  });

  test('has no live route, production cron, Stripe mutation, live-price fallback, or vehicle deposit heuristic', () => {
    const protectedSource = fs.readFileSync(
      path.join(__dirname, '..', 'api', '_payout-v2-protected-balance.js'),
      'utf8'
    );
    const contractSource = fs.readFileSync(
      path.join(__dirname, '..', 'api', '_payout-v2-platform-balance-contract.js'),
      'utf8'
    );
    const liveRoutes = [
      'api/admin.js', 'api/webhook.js', 'api/cron-payouts.js',
      'api/cron-balance-snapshot.js', 'api/slots.js',
    ].map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
    expect(liveRoutes).not.toContain('_payout-v2-protected-balance');
    expect(liveRoutes).not.toContain('_payout-v2-platform-balance-contract');
    expect(protectedSource + contractSource).not.toContain('transfers.create');
    expect(protectedSource + contractSource).not.toContain('payouts.create');
    expect(protectedSource + contractSource).not.toContain('refunds.create');
    expect(protectedSource).not.toContain('list_price_pence');
    expect(protectedSource).not.toContain('lesson_types');
    expect(protectedSource).not.toMatch(/19500|25000|deposit_deducted_pence/);
  });
});
