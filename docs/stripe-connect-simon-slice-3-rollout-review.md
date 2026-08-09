# Simon Stripe Connect Slice 3 rollout review

**Status:** `MERGED_DEPLOYED_INACTIVE_VERIFIED`

**Date:** 9 August 2026

**Authoritative source:** `origin/main` at
`ea3a65cb3871924025f2355f388b98488bd71219` (merged PR #356)

## Decision boundary

This review proves that the merged Slice 3 code passed CI, reached the reported
Vercel deployments, and remains inactive for the production CoachCarter
school. It does not activate retirement, mutate production, change a provider
or environment, create or alter a payment, refund, payout, transfer, or earning,
replay a webhook, or authorise Slice 4.

The protected product specification and technical implementation plan were
reverified before this documentation edit. Their LF-normalised SHA-256 values
remain:

- product specification:
  `79778382071613EFBB9DEC4E17F135A63C9F8D8B3010D921882D7ED631530DD4`
- technical implementation plan:
  `64BC84E3CE8303E8CBE1C7FA0E8ADEB221E7F4AD3294C5871417E06F0EEAF916`

## Exact merge, CI, and deployment evidence

- GitHub reports PR [#356](https://github.com/coachcarteruk-gif/coachcarter-website/pull/356)
  merged to `main` at `2026-08-09T06:40:35Z` with exact merge commit
  `ea3a65cb3871924025f2355f388b98488bd71219`. Its source commit was
  `fc94e79da19ea2e82abfb58c9cc305547081eaec`.
- That merge commit was exact `origin/main` at the start of this verification.
- Exact post-merge Actions run
  [31299415244](https://github.com/coachcarteruk-gif/coachcarter-website/actions/runs/31299415244)
  was a `push` run on `main` at that exact merge SHA. It completed successfully.
  Job `syntax + encoding checks` (`93209674152`) and job `playwright e2e`
  (`93209698709`) both completed successfully with every executed step green.
- GitHub binds four successful production-target deployment records to that
  exact SHA. Read-only Vercel inspection independently reported each deployment
  `READY`:

| GitHub environment | GitHub deployment | Vercel deployment | Exact deployment URL |
|---|---:|---|---|
| `Production – coachcarter-website` | `5816273288` | `dpl_2kb6qo7n5bEzohVHZKK42WfJwDrR` | `coachcarter-website-2l0a1cics-coachcarteruk-2599s-projects.vercel.app` |
| `Production – coachcarter-website-main` | `5816269601` | `dpl_4AYHbx9aVkLftzW8DnyznUQizVAT` | `coachcarter-website-main-9h4q0blw3-coachcarteruk-2599s-projects.vercel.app` |
| `Production – cc-simon-s2-shadow-01` | `5816269367` | `dpl_A9oeRQWx9kC9JukKnhuNgjiyPTv1` | `cc-simon-s2-shadow-01-mf32v7yti-coachcarteruk-2599s-projects.vercel.app` |
| `Production – cc-simon-s2-shadow-03` | `5816269694` | `dpl_66NbmuLbRrS4VDai7bEBXYcoHNDz` | `cc-simon-s2-shadow-03-n2f05ldkp-coachcarteruk-2599s-projects.vercel.app` |

GitHub supplies the commit-to-deployment binding; Vercel supplies the exact
deployment identity and terminal readiness state. Passive public GET checks
returned HTTP 200 for `https://www.coachcarter.uk/`,
`/learner/book.html`, and `/accept-offer.html`.

## Production inactive evidence

The only active state is the exact nested JSON Boolean:

```text
schools.config.features.retire_incompatible_products === true
```

Missing rows, missing keys, malformed config, string `"true"`, numeric `1`,
Boolean `false`, and JSON `null` are inactive. A retirement-state read failure
fails closed with HTTP 500 rather than allowing creation.

One minimum-field, school-scoped production Neon read ran inside a serializable
read-only transaction. It selected only transaction mode, row existence,
`id`, `name`, `slug`, the nested retirement value, and that value's JSON type;
it did not select or print the complete config or any credential. The result
was:

| Field | Verified value |
|---|---|
| transaction mode | read-only |
| row exists | yes |
| school id | `1` |
| school name | `CoachCarter Driving School` |
| school slug | `coachcarter` |
| retirement value | SQL `NULL` (path absent) |
| retirement JSON type | SQL `NULL` (path absent) |

Therefore production school `1` is inactive. No school config update was
issued.

## Preserved behavior and local verification

Merged CI already passed at the exact deployed SHA. Fresh verification from a
clean isolated worktree based on that SHA additionally passed:

- syntax for `200` JavaScript files;
- C1 controls for `272` files;
- `112/112` focused non-browser assertions covering the strict active state,
  stable 410 contract, pre-mutation gates, credit balance reads and scoped
  spending contracts, existing offer behavior, recurring-block status and
  management, reserved moves, booking statuses, webhook settlement, BCS, and
  historical source/price snapshots;
- `53/53` additional non-browser assertions covering ordinary direct booking,
  fixed/free one-off offers, Lesson Credit reads, Reserved Weekly Slot UI and
  management boundaries, immutable payment-contract evidence, and the exact
  one-payment/one-lesson origin whitelist;
- `8/8` installed-system-Chrome assertions, with two live-API tests skipped by
  design because `CC_TEST_API` was absent. Six assertions proved inactive
  legacy fixed/repeating-offer behavior and two proved active-state retirement
  UI and the one-lesson handling of a grandfathered fixed offer.

The first browser attempt used a temporary Python static server that did not
support extensionless routes and consequently returned harness-level 404s.
The same unchanged tests passed after the temporary loopback harness was
corrected to match clean-URL behavior. The temporary files and test artifacts
were removed. A separate additional contract batch initially stopped during
test discovery because the isolated process had no Stripe credential; it
passed with a visibly synthetic, non-authenticating `sk_test_...` constructor
placeholder and made no Stripe request.

Together with the code and exact-main CI, these checks preserve:

- ordinary one-off lesson booking and its server-priced checkout contract;
- fixed one-off and free-trial offers that produce one lesson;
- grandfathered aggregate and per-instructor Lesson Credit reads, scoped
  spending, and 48-hour cancellation returns;
- existing recurring series, recurring-block status, Reserved Weekly Slot
  occurrence moves, cancellations, reschedule guards, series information, and
  instructor/admin management;
- historical `booking_credit_sources`, `credit_source_adjustments`,
  `refund_events`, `refund_event_lines`, Stripe references, BCS rows, and price
  snapshots;
- idempotent completion of pre-activation credit, offer, and Reserved Weekly
  Slot webhooks already in flight.

Legacy-credit and retired multi-booking sources remain outside the Slice 2
one-payment/one-lesson whitelist and remain £0 automated Simon-launch earnings.

## Activation procedure — prepared, not executed

This is an operator runbook, not authority to activate. Activation requires a
new production-change approval, completed customer/product communication,
confirmed rollback ownership, and a fresh check that the approved deployment is
still serving the exact intended commit.

### 1. Preflight and stop conditions

1. Reverify `origin/main`, the production alias, exact deployment SHA, green CI,
   and the two protected hashes.
2. Confirm the approved target is exactly school `1`, name
   `CoachCarter Driving School`, slug `coachcarter`.
3. Start a serializable read-write transaction and lock only that row. Select
   only the identity, config/root type, `features` type, retirement value, and
   retirement JSON type:

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE;

SELECT
  id,
  name,
  slug,
  jsonb_typeof(config) AS config_json_type,
  CASE WHEN config ? 'features' THEN jsonb_typeof(config -> 'features') END
    AS features_json_type,
  config #> '{features,retire_incompatible_products}' AS retirement_value,
  jsonb_typeof(config #> '{features,retire_incompatible_products}')
    AS retirement_json_type
FROM schools
WHERE id = 1
FOR UPDATE;
```

4. Stop and `ROLLBACK` if the row count is not exactly one; any identity differs;
   config is non-null and not an object; `features` exists and is not an object;
   the retirement path is no longer absent; the deployment/CI/hash binding is
   uncertain; communications or an operator are not ready; or any payment,
   refund, payout, transfer, reconciliation, webhook replay, credential, or
   Slice 4 action would be needed.
5. Capture the minimum preflight row, UTC timestamp, approved change reference,
   operator, and exact deployment identity. Do not capture the complete config.

### 2. Exact school-scoped activation transaction

Only after the preflight passes in the same transaction, run this guarded
update. It preserves every other config and feature key, requires the currently
verified absent path, and cannot affect another school:

```sql
UPDATE schools
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{features}',
  COALESCE(config -> 'features', '{}'::jsonb)
    || jsonb_build_object('retire_incompatible_products', true),
  true
)
WHERE id = 1
  AND name = 'CoachCarter Driving School'
  AND slug = 'coachcarter'
  AND (config IS NULL OR jsonb_typeof(config) = 'object')
  AND (
    config -> 'features' IS NULL
    OR jsonb_typeof(config -> 'features') = 'object'
  )
  AND config #> '{features,retire_incompatible_products}' IS NULL
RETURNING
  id,
  name,
  slug,
  config #> '{features,retire_incompatible_products}' AS retirement_value,
  jsonb_typeof(config #> '{features,retire_incompatible_products}')
    AS retirement_json_type;
```

Require exactly one returned row with JSON Boolean `true` and type `boolean`.
Otherwise `ROLLBACK` and stop. Re-read the same minimum fields inside the
transaction, then `COMMIT`. Immediately perform a fresh read-only, exact-school
postflight and capture the same minimum fields as after evidence.

### 3. Expected active-state smoke checks

First run the complete active-state 410 matrix against an identical
non-production deployment. In production, use only authenticated, read-only GET
checks that cannot create money or product state:

- Reserved Weekly Slot preview for a valid existing school-1 anchor booking must
  return HTTP `410`, code `PRODUCT_CREATION_RETIRED`, discriminator
  `reserved_weekly_slot` before preview construction.
- If an already-existing, unexpired school-1 flexible-offer token is available,
  `GET /api/offers?action=get-offer&token=...` must return HTTP `410`, code
  `PRODUCT_CREATION_RETIRED`, discriminator `flexible_offer`. Do not create an
  offer to manufacture this smoke fixture.

Also confirm ordinary public booking and fixed-offer pages still return 200.
Do not submit a booking or accept an offer as an activation smoke. Stop and
immediately execute rollback if a safe check has the wrong status, code,
discriminator, or school scope; a supported one-off surface is unavailable; a
state read fails; monitoring reports an unexpected error; or any check would
cross into mutation or money movement.

## Rollback procedure — prepared, not executed

Rollback is an exact inverse config change to JSON Boolean `false`; it never
deletes or rewrites bookings, credits, ledgers, Stripe references, or history.

1. Start a new serializable read-write transaction. Lock exact school `1` with
   the same minimum-field preflight query. Require exact identity and current
   retirement value JSON Boolean `true` with JSON type `boolean`; otherwise
   `ROLLBACK` and stop.
2. Run:

```sql
UPDATE schools
SET config = jsonb_set(
  config,
  '{features}',
  (config -> 'features')
    || jsonb_build_object('retire_incompatible_products', false),
  true
)
WHERE id = 1
  AND name = 'CoachCarter Driving School'
  AND slug = 'coachcarter'
  AND jsonb_typeof(config) = 'object'
  AND jsonb_typeof(config -> 'features') = 'object'
  AND config #> '{features,retire_incompatible_products}' = 'true'::jsonb
RETURNING
  id,
  name,
  slug,
  config #> '{features,retire_incompatible_products}' AS retirement_value,
  jsonb_typeof(config #> '{features,retire_incompatible_products}')
    AS retirement_json_type;
```

3. Require exactly one returned row with JSON Boolean `false` and type
   `boolean`; otherwise `ROLLBACK` and stop. Re-read the same minimum fields,
   `COMMIT`, and immediately confirm Boolean `false` in a fresh read-only
   transaction.
4. Capture operator, UTC timestamps, reason, exact deployment, before/after
   minimum fields, and passive page health. Escalate the incident; do not replay
   webhooks, alter payments, issue refunds, change payouts/transfers, reconcile,
   rewrite history, or begin Slice 4 as part of rollback.

Neither activation nor rollback was executed during this review.

## Review outcome

Slice 3 is merged, deployed, and verified inactive for production school `1`.
The deployed code and fresh local checks preserve the supported one-off and
grandfathered contracts while the active gates remain green. Production
activation remains a separate approval and Slice 4 remains unauthorised.
