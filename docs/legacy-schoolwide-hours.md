# Original-rate school-wide legacy hours

2026-09-07 owner scope: School 1 learners 34 and 74 only. Other balances remain
unchanged. Learner 34 keeps 180 minutes at 4800 pence/hour (GBP720 / 15 hours).
Learner 74 keeps 424 minutes at 4983.25 pence/hour (GBP1195.98 / 24 hours), displayed
as GBP49.83/hour. Never grant the original purchased hours again.

## Conversion

Deploy the application changes, then apply migration 058 atomically. Installation
alone converts no balances. Preview the database-owner function
`convert_legacy_credit_to_schoolwide_hours(school, learner, old_instructor, admin,
hourly_rate_pence, evidence, request_uuid)`. Review its minutes, source draws, rate
and fingerprint. Repeat with `apply=true` and that fingerprint to execute. Replays
are idempotent; changed inputs or stale previews fail. PUBLIC has no execution
permission, there is no HTTP endpoint, and the actor must be an active same-school
admin. Unknown rates must not default to current instructor prices.

The function locks learner/LCB rows, verifies the full ledger, rejects Stripe-backed
or mixed positive sources, appends CSA deductions, removes old spendable minutes,
and inserts a Flexible Hours source plus state/audit evidence atomically. Original
CT/BCS/Stripe/booking/payout rows remain unchanged. The pooled display trigger
follows LCB. Existing booked lessons are not converted; a later return from those
old lessons remains Lesson Credit pending a separate preview.

## Value and booking

Sources and allocations support fractions of their 30-minute base unit, preserving
exact legacy minute remainders. FIFO plans in integer minutes; lesson durations
still require multiples of 30 minutes. Rates retain six decimal places in pence
per base unit. Booking contributions and remaining source values round to pennies.
Existing package prices and Checkout validation are unchanged.

Bookings use the delivering active same-school instructor and original source
rate. 48h+ cancellation returns exact allocations; a 48h+ instructor change carries
identical allocations and value. Late cancellation consumes the allocation. No
new automatic refund or Stripe transfer capability is enabled. Offline sources
have no fabricated Stripe purchase and require original-payment reconciliation
before original-method refund recording. Payout eligibility controls remain
authoritative; source valuation alone does not authorise a Stripe transfer.

Balance/source discovery uses LEFT JOINs so sources without purchases remain
visible. Existing GDPR source/allocation/event detachment covers the new evidence.
Credit reconciliation excludes Flexible Hours from unattributed Lesson Credit
deductions. The cumulative schema keeps the new view types compatible on reruns.

## Verification

The disposable production clone is `br-fancy-breeze-abmk6in7`, project
`falling-firefly-48751671`. `tests/legacy-schoolwide-conversion.sql` checks preview,
staleness, tenant/admin scope, missing rates, Stripe refusal, replay, exact balances,
audit/adjustment atomicity and historical evidence preservation. Successful test
writes roll back. `tests/legacy-schoolwide-db.cjs` is pinned to that clone's endpoint
and exercises concurrent conversion, actual cross-instructor booking/retry,
cross-instructor move, cancellation/retry and exact returned balances. It creates
synthetic January 2030 bookings only on that clone; never run it on production.
Focused Playwright tests cover both rates, remainders, overspend and ordinary pricing.

## 2026-09-07 production incident: missing view access

Migration 058 dropped/recreated balance views without restoring runtime SELECT grants. Owner-role database tests passed, but the website could not read Flexible Hours and rendered zero/missing balances. All other legacy LCB balances remained unchanged; converted sources 5 and 6 retained 180 and 424 minutes. Restored SELECT on both views to the existing runtime grant role, inherited by the active production login. Verified both balance and source queries with that active login. Migration 059 and the 058/cumulative rerun paths now restore SELECT to existing complete ledger-reader roles, including NOLOGIN groups. No credit was regranted or financial history rewritten.

Verification after repair: the actual balance handler returned HTTP 200 for both learners using the active production database login (authenticated identity substituted locally, no token minted). A rollback-only clone regression reproduces missing inherited view access, applies migration 059, and verifies SELECT is restored without UPDATE permission.
