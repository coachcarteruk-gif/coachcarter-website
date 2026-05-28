# Refund Exposure Valuation Audit

Last updated: 2026-05-29

This design slice documents the next step after per-instructor credits: making
the platform-balance refund exposure number exact enough for accounting without
changing refund execution, Stripe behaviour, or payout formulas in this PR.

## Current Advisory Widget

`api/_platform-balance.js` computes the admin platform-balance widget and the
daily `platform_balance_snapshots` row. Its payout preview is intended to match
Friday payout execution. Its `refund_exposure_pence` field is different: it is
an advisory legacy aggregate exposure signal.

Today it:

- reads live positive `learner_users.balance_minutes`;
- values those aggregate minutes at the school default bulk hourly rate from
  `schools.config.pricing.bulk_hourly_pence`, falling back to 5500 pence/hour;
- excludes test learners;
- caps the value by Stripe-originated net cash-in from `credit_transactions`
  rows with `stripe_session_id IS NOT NULL`;
- returns `refund_exposure_basis.exact_refund_liability === false`.

This is useful as a rough dashboard warning, but it must not be presented as
exact cash required for refunds.

## Why It Is No Longer Exact

Credits are now scoped by `(learner_id, instructor_id, school_id)` in
`learner_credit_balances`. Pricing can differ per instructor and per
instructor-learner pair, and credit purchase rows snapshot
`effective_rate_pence_per_minute`. Booking deductions can also consume several
credit sources through `booking_credit_sources`, each with its own
`rate_pence_per_minute`, `contribution_pence`, Stripe fee attribution, and
`absorbed_by` value.

The aggregate `learner_users.balance_minutes` shadow has no source identity. It
cannot tell whether the live minutes came from paid Stripe credit, platform
goodwill, instructor-absorbed goodwill, legacy backfill, or mixed sources. It
also cannot value Instructor A credit at Instructor A's source rate while
valuing Instructor B credit at another rate.

## Available Data Sources

Exact valuation should use school-scoped source data:

- `learner_credit_balances`: live unused minutes by learner, instructor, and
  school. This is the balance anchor, not the valuation source by itself.
- `credit_transactions.effective_rate_pence_per_minute`: purchase/grant price
  snapshot for unused source minutes.
- `booking_credit_sources.rate_pence_per_minute`: already-spent attribution
  for bookings and the model for source-aware valuation of consumed portions.
- `credit_source_adjustments`: additive source-level reductions for cash
  refunds, corrections, disputes, and future manual-record slices.
- `absorbed_by`: goodwill absorber on `credit_transactions` and propagated BCS
  rows. This determines who should bear non-Stripe-funded exposure.
- Stripe-originated purchase/refund rows: `credit_transactions` with Stripe
  identities and `refund_events` / `refund_event_lines` where available.

Every query in the future exact read model must filter tenant-scoped tables by
`school_id`.

## Recommended Live-Credit Valuation

Use source-level remaining value, not aggregate minutes:

1. Start from each school-scoped `credit_transactions` row that can create
   usable learner credit for a learner/instructor pair.
2. Calculate remaining source minutes and pence as original source minutes/value
   minus active `booking_credit_sources` usage and
   `credit_source_adjustments`.
3. Reconcile the source-level remaining minutes to
   `learner_credit_balances.balance_minutes` for the same
   learner/instructor/school. Differences should be surfaced as warnings, not
   hidden in the headline.
4. Value remaining source minutes using the source's snapshotted
   `effective_rate_pence_per_minute`. If a legacy row lacks a rate, classify it
   separately as `legacy_unpriced` and value it only by an explicitly documented
   fallback.
5. Keep source rows in the response so the dashboard can show both total
   source-level liability and how much of it is actually Stripe-cash backed.

The exact implementation should not read `learner_users.balance_minutes` as the
source of truth.

## Goodwill Credits

Recommended policy:

- `absorbed_by = 'platform'`: include in platform liability because the platform
  promised learner value and chose to absorb the grant. It is not Stripe-cash
  backed, so report it separately from paid-cash exposure.
- `absorbed_by = 'instructor'`: include in learner-facing credit liability, but
  classify as instructor-absorbed. Do not silently count it as platform cash
  exposure. The open product/accounting question is whether the dashboard should
  show this as a separate off-platform liability or an instructor receivable.
- missing or legacy `absorbed_by`: classify as `legacy_unknown_absorber`. Do not
  assume platform or instructor absorption. Show a migration/backfill warning
  until manually classified or explicitly mapped by policy.

## Cash Cap

The current cap by Stripe-originated net cash-in is still useful, but only as a
collectability/cash-safety cap. It should not erase source-level liability.

Future output should distinguish:

- gross source-level refund liability;
- Stripe-cash-backed refundable exposure;
- platform-goodwill exposure;
- instructor-absorbed exposure;
- legacy unknown/unpriced exposure;
- capped headline cash exposure used for balance safety.

That lets the platform avoid overclaiming available cash while still seeing the
real rows that created learner expectations.

## Advisory vs Exact

Keep the current `refund_exposure_pence` advisory until the source-aware read
model lands and is tested. It should continue returning
`refund_exposure_basis.exact_refund_liability === false`.

An exact future field should be separately named or explicitly marked, for
example `exact_refund_liability_pence` with
`refund_exposure_basis.exact_refund_liability === true`. Do not reuse the old
aggregate value as exact.

## Migration And Backfill Limits

Legacy rows may lack:

- `instructor_id`;
- `effective_rate_pence_per_minute`;
- accurate Stripe fee snapshots;
- `absorbed_by`;
- complete source adjustments for manual historical refunds.

The exact model can classify these rows, but it cannot make them fully exact
without a backfill policy. The safest behaviour is to surface legacy buckets and
warnings rather than blend them into a precise-looking headline.

## Future Implementation Plan

1. Add a disabled/pure read-model builder that loads source rows by school and
   never reads `learner_users.balance_minutes`.
2. Unit-test valuation buckets with paid Stripe credit, platform goodwill,
   instructor goodwill, mixed sources, CSA cash refunds, and missing legacy
   absorber/rate rows.
3. Add integration tests against an isolated Neon branch for reconciliation
   between source-level remaining minutes and `learner_credit_balances`.
4. Add API metadata for both advisory and exact fields while keeping the
   current dashboard number unchanged.
5. Update admin UI copy to show advisory aggregate, exact source-level
   liability, and cash-backed cap as separate values.
6. Only after review, decide whether the old advisory field should be retired,
   renamed, or left as a trend signal for snapshots.

## Unresolved Policy Questions

- Should instructor-absorbed goodwill appear in the platform balance widget as
  a liability, an instructor receivable, or a separate non-platform exposure?
- What fallback rate should apply to legacy paid rows without
  `effective_rate_pence_per_minute`, if any?
- Should the cash-backed cap subtract executed `refund_events` only, or all
  `credit_source_adjustments.kind = 'cash_refund'` rows that reference Stripe or
  manual bank refunds?
- Should legacy unknown absorber rows default to manual review forever, or be
  bulk-classified during a one-time migration?
