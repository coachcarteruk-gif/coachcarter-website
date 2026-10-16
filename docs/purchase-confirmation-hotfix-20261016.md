# Purchase confirmation investigation — 16 October 2026

## Status

Prepared and tested; **not applied to production**. Owner requested investigation
and a live fix without touching unfinished branches, then clarified that accepted
paid proposals appeared correct and missing emails were the concern.

Isolated checkout: `tmp/purchase-credit-hotfix`, branch
`codex/purchase-credit-hotfix`. Created from fetched `origin/main` (`91b3e07`)
and fast-forwarded to the verified currently deployed source `96d1bca` so the
live giveaway and free-trial changes are preserved. No unfinished checkout,
branch, handoff or continuation log was edited. Automatic continuation remains
at the existing 20/20 cap; no new chat is authorised or proposed.

## Production evidence (read-only)

Target: Vercel `prj_ikyhcHbDHOR4jDQuZUeGFv3pw1Lk`, deployment
`dpl_Dqq8t33u3VjuPJAt46Ycmc3B8qVS`; Neon `falling-firefly-48751671`, branch
`br-summer-silence-abcpp6vw`, database `neondb`, school 1.

- Learner 153 has four paid proposals now fulfilled as bookings 792, 796, 797,
  798, totalling 390 minutes / 35,750p. These buy specific lessons, not spare
  Lesson Credit. They must not be credited again.
- The separate Flexible Hours balance is 360 minutes / 33,000p, from sources
  8 and 10. Ordinary instructor Lesson Credit balances are zero.
- Learner confirmation notification rows 4154, 4163, 4165, 4167 are `sent`, to
  the current account email, at 16:40, 17:52, 17:55, 17:58 BST on 15 October.
  Corresponding instructor confirmations also show `sent`. The transport logs
  this after SMTP send succeeds; inbox delivery, spam filtering and later bounce
  status cannot be established from these records. No messages were resent.
- SMS attempts failed with Twilio error 20003, account inactive. No provider
  configuration, billing or external messages were changed.
- The four original payment webhook attempts at 15:39, 15:51, 15:56, 15:58 UTC
  failed with SQLSTATE 23502: missing `booking_credit_sources.stripe_fee_pence`.
  Later retries succeeded once Stripe fee evidence was available, the last
  three around an hour later. All four now have actual fee values and bookings.

## Root cause and bounded repair

`fulfilPencilledOffer` deliberately writes unknown Stripe fees as NULL, matching
the documented pencilled-offer contract and the nullable transaction/booking
fee columns. The original BCS column remained NOT NULL. The payment could be
successful while the complete booking transaction rolled back on that mismatch.

Migration `079_booking_source_unknown_fee.sql` drops ONLY this column's NOT NULL
constraint. It changes no rows, prices, balances, entitlements, refunds or payouts.
The existing default is preserved. Real zero fees remain zero; unknown fees stay
NULL and the existing payout evidence gate blocks them pending reconciliation.
No application-code change or Vercel rebuild is required to make this repair
effective after the migration. Do not substitute zero for unknown fee evidence.
This repair does not establish SMTP inbox delivery or reactivate SMS.

## Verification

- Before the repair, real in-memory PostgreSQL execution reproduced SQLSTATE
  23502 for null and undefined fees; known and zero fees passed.
- `node --test tests/pencilled-offer-fee.test.cjs`: 5 passed after migration,
  using the actual handler and migrations 066/075/079. Covers missing, zero,
  known fees, duplicate fulfilment, school isolation and payout evidence blockers.
- Existing policy/deadline/checkout-retry/fee-backfill suites: 30 passed.
- Migration manifest check: 80 entries valid, only historical 026 collision.
- Governed Neon rehearsal on `br-silent-hat-ab8xdk6b`, expiring 17 October
  07:00 UTC: preflight 78 applied, exactly 079 pending; application succeeded;
  postflight 79 applied, none pending, column nullable.
- Before/after row hashes identical for all 487 BCS rows, 427 credit transactions,
  681 bookings, 82 instructor balance rows and 12 Flexible package sources.
- Production remains at 078 with a non-nullable BCS fee. No financial mutation
  or production migration has been performed by this task.

## Remaining release gate

The repository requires separate explicit production migration approval.
After approval: revalidate the exact target and ledger (only 079 pending), create
a recovery snapshot, apply with `scripts/migration-runner.js --apply-approved`,
then verify the receipt, nullable column and unchanged learner balances/bookings.
Direct production fingerprint is
`32c8e09a13fff240b0e1af6bb4c063bce1ca02ec09b801242e9232c824123008`.
Use private environment configuration; never print or commit credentials.

Only this isolated hotfix's 079 is proposed. Future integration of unfinished
branches must reconcile their local migration numbering with this live lineage;
do not copy or execute any of their migrations during this repair.
