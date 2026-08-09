# Simon Stripe Connect Slice 3 rollout review

**Status:** `IMPLEMENTED_INACTIVE_NOT_DEPLOYED`

**Date:** 8 August 2026

**Source baseline:** `origin/main` at
`7be7920e07c75767e8eb923d3f122d62947f1899` (PR #355)

## Decision boundary

This slice prepares retirement of incompatible new product creation. It does
not activate the state for any school, deploy code, mutate Neon, change Stripe
or Vercel configuration, create or refund a payment, or authorise Slice 4.

The protected product specification and technical implementation plan were
not edited. Their LF-normalised SHA-256 values remain:

- product specification:
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
- technical implementation plan:
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`

## Server-authoritative state

The exact active state is the nested JSON Boolean:

```text
schools.config.features.retire_incompatible_products === true
```

The school row is loaded by exact `school_id`. Missing rows, missing keys,
malformed config, string `"true"`, numeric `1`, `false`, and `null` are all
inactive. A state-read failure fails closed with a 500 before creation rather
than allowing the product through.

An active retirement returns HTTP 410 with stable code
`PRODUCT_CREATION_RETIRED` and a `retired_product` discriminator.

## Retired creation paths

When active for a school:

- learner `book` requests with `repeat_weeks > 1` are rejected before booking
  or credit mutation;
- Reserved Weekly Slot preview, credit commit, and bank Checkout creation are
  rejected before preview construction, holds, payment configuration, Stripe,
  bookings, BCS, or LCB mutation;
- instructor flexible offers and offers with `max_repeat_weeks > 1` are
  rejected before offer insert or notification;
- accepting a flexible offer or requesting more than one lesson from a fixed
  offer is rejected before free-credit, booking, or Stripe work;
- learner and instructor creation controls are removed, and admin pricing copy
  no longer presents bulk credit packages as purchasable;
- self-serve Lesson Credit Checkout and PaymentIntent creation retain their
  pre-existing server-side `410 CREDIT_PURCHASE_RETIRED` behavior.

## Grandfathered behavior preserved

The retirement state does not alter:

- aggregate or per-instructor Lesson Credit reads;
- one-off spending from `learner_credit_balances`;
- 48-hour cancellation returns to the original instructor balance;
- existing recurring-block status, reserved occurrence moves, cancellations,
  reschedule guards, series information, or instructor/admin management;
- existing offer history and cancellation;
- historical `booking_credit_sources`, `credit_source_adjustments`,
  `refund_events`, `refund_event_lines`, Stripe references, or financial rows;
- idempotent webhook completion for pre-activation credit, offer, or Reserved
  Weekly Slot sessions already in flight.

Legacy-credit and other retired multi-booking sources remain excluded from the
Slice 2 one-payment/one-lesson origin whitelist and therefore remain £0
automated Simon-launch earnings.

## Activation and rollback

Activation is a separate production change requiring product communication and
readiness approval. Before any activation, deploy and verify this code with the
state absent/false, then enable only the approved school by an exact
school-scoped config update. Capture the operator, timestamp, before/after
config, deployment identity, and smoke-test evidence in the project log.

Before cutover, rollback is the exact inverse school-scoped config change back
to Boolean false. After cutover, retired shapes must not be reintroduced without
a new product decision. Disabling the flag does not delete or rewrite any data.

## Verification

Completed locally in the isolated Slice 3 worktree:

- protected hashes remained exact;
- syntax passed for 200 JavaScript files;
- C1 controls passed for 272 files;
- 157/157 affected non-browser credit, offer, recurring-block,
  reserved-management, webhook, Stripe-origin, and new retirement tests passed;
- 8/8 browser assertions passed in installed system Chrome, covering six
  inactive-state legacy offer behaviors and two active retirement behaviors;
- `git diff --check` passed;
- the primary workspace and every pre-existing worktree were re-inspected and
  preserved as found.

The repository Playwright package expected a newer bundled Chromium revision
than the local cache. No browser was downloaded; browser assertions were rerun
successfully against the already installed Chrome executable using a temporary
config outside the repository.

## Review outcome

The implementation may be reviewed and merged as inactive code. Merge is not
production activation, payout approval, or authority for Slice 4.
