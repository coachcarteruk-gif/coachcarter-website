# Learner Packages test-purchasing operator runbook

This runbook covers the Full Curriculum Stripe test-purchasing exercise only. It does not authorise live payments, refunds, Lesson Credit changes, Pay As You Go changes, instructor earnings, payouts, Stripe Connect transfers, Flexible 30 Hours fulfilment, or Manoeuvres fulfilment.

## Fixed safety boundary

- The production Vercel project serving `coachcarter.uk` is `coachcarter-website`. Verify that project name and the `coachcarter.uk` domains before inspecting or changing configuration. Do not trust a local `.vercel/project.json`; local worktrees can be linked to isolated Simon projects.
- No live-mode resource, key, event, Checkout Session, or PaymentIntent is permitted.
- The catalogue gate is `schools.config.features.learner_packages_enabled === true`.
- The separate purchase gate is `schools.config.features.learner_package_purchasing_test_enabled === true`.
- Missing, false, string, numeric, or malformed gate values are disabled.
- Keep the purchasing gate false until every preflight item passes and Fraser explicitly approves enabling it for school 1.
- Only `/api/package-webhook` can fulfil. The success and cancel URLs only poll the owned attempt.
- Treat every Stripe and bank-authorisation redirect URL as credential-bearing. Never read, print, copy, log, screenshot, or include the complete URL in diagnostic output; query parameters and fragments can contain a PaymentIntent client secret. Inspect only visible page state and separately captured, non-secret object identifiers.

## Required Stripe test resources

Create every resource while the Stripe Dashboard is in test mode:

1. A dedicated Payment Method Configuration named clearly, for example `CoachCarter Learner Packages - TEST`.
   - It must be active and have `livemode=false`.
   - Pay by Bank must be available with its effective display preference on.
   - Card, Link, wallets, deferred payment methods, bank debit, and every method other than Pay by Bank must have an effective display preference off.
   - It must not be the Reserved Weekly Slot configuration.
2. A dedicated restricted test key named clearly, for example `CoachCarter Learner Packages Checkout - TEST`.
   - It must begin with `rk_test_`.
   - Grant Checkout Sessions Write. This permits Checkout creation and implies the read access needed by the package diagnostics; leave refunds, transfers, payouts, Connect, customers, subscriptions, disputes, and unrelated resources at None.
   - Store the one-time key value directly in Vercel. Never paste it into source, a ticket, chat, terminal output, or a local committed file.
3. A separate test webhook endpoint at `https://www.coachcarter.uk/api/package-webhook` using snapshot events only. Use the `www` hostname exactly: the apex `https://coachcarter.uk/api/package-webhook` currently returns a Vercel `307` canonical-host redirect, which Stripe records as a failed delivery rather than following to fulfilment:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - Record its signing secret directly in Vercel. Do not reuse `STRIPE_WEBHOOK_SECRET`.

## Required Vercel production variables

Set these server-only sensitive values on the `coachcarter-website` project in the Production environment only:

| Variable | Required evidence |
|---|---|
| `STRIPE_PACKAGES_TEST_RESTRICTED_KEY` | Present; value class is `rk_test_`; dedicated key has only the permission above. |
| `STRIPE_PACKAGES_TEST_PAYMENT_METHOD_CONFIGURATION` | Present; points to the dedicated active test Payment Method Configuration; effective methods are Pay by Bank on and all others off. |
| `STRIPE_PACKAGES_TEST_WEBHOOK_SECRET` | Present; belongs only to the test `/api/package-webhook` endpoint and its five-event subscription. |

Do not set a package variable to a shared or live value. Do not add these values to Preview unless that deployment has an explicitly isolated non-production database and a separate approved test exercise.

Changing a Vercel variable does not update an existing deployment. Redeploy the exact reviewed commit after configuration, then confirm the new production deployment is `READY` before any gate change.

## Preflight with both gates off

1. Confirm production is the reviewed commit and is `READY`.
2. Confirm `/api/packages?action=catalogue` still returns the four school-1 catalogue products, `phase: catalogue_only`, `purchasing_test_enabled: false`, and `checkout_available: false`.
3. Confirm the three package variables exist in Production without reading or printing their values.
4. Use Stripe test-mode inspection to prove:
   - the restricted key is test mode and least privilege;
   - the Payment Method Configuration is test mode, dedicated, active, and Pay by Bank-only;
   - the webhook is test mode, enabled, points to the exact non-redirecting `https://www.coachcarter.uk/api/package-webhook` production URL, and subscribes to exactly the five events above.
5. Run focused package tests and JavaScript syntax checks.
6. Run `tests/learner-packages-full-curriculum.integration.spec.js` only with `CC_TEST_DB=1`, `CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1`, and the hard-pinned disposable `POSTGRES_URL_TEST`. Never point it at the production host.
7. Confirm checkout creation fails closed for missing credentials, live credentials, missing or non-dedicated configuration, either disabled gate, cross-school/invalid learner, unsupported product, wrong version/price/currency/terms, and ambiguous Stripe responses.

## Enable for the named school

Enabling requires a separate explicit approval after preflight. The only authorised database mutation is the existing audited school-1 admin action that writes JSON Boolean `true` at `features.learner_package_purchasing_test_enabled`. Do not change `learner_packages_enabled`, pricing, product versions, or any other school config in the same operation.

Immediately re-read the catalogue as the verified test learner. Expected state is `phase: full_curriculum_test_foundation`, `purchasing_test_enabled: true`, and Checkout available only for Full Curriculum after a same-school future first-test record is manually verified and no active Full Curriculum enrolment exists.

## End-to-end success exercise

Use a disposable same-school verified learner created for the exercise:

1. Record future first-test facts and have a school-1 admin verify them.
2. Start one Full Curriculum Checkout from the learner page. Verify the server amount is GBP 200000 pence from the current immutable version, the Checkout ID begins `cs_test_`, `livemode=false`, and only Pay by Bank is offered.
3. Authorise the Stripe test payment. Do not infer success from the browser return, and do not inspect or record the resulting redirect URL. Confirm settlement only from the signed webhook, the application read model, and a sanitized read-only provider diagnostic.
4. Confirm the signed test webhook processes the paid event and creates exactly one `learner_package_purchases` row, one unstarted `full_curriculum_enrolments` row with status `paid_matching`, and one pending matching record, all with school 1.
5. Confirm the purchase and enrolment point to the same attempt, learner, product version, amount, currency, terms, Checkout Session, PaymentIntent, Payment Method Configuration, and verified first-test evidence.
6. Replay the same event and then deliver a supported failure/expiry event out of order. Confirm the durable event receipt is counted, the paid attempt is not downgraded, and purchase/enrolment counts remain one.
7. Confirm no rows attributable to the exercise were created in Lesson Credit balances/ledgers, refund ledgers, instructor earnings, payout line items, transfers, or Stripe Connect records.

## Disable safely

Set only `features.learner_package_purchasing_test_enabled` back to JSON Boolean `false` through the audited school-1 admin action. Confirm the catalogue remains visible while `phase`, `purchasing_test_enabled`, and `checkout_available` return to the catalogue-only state.

Do not delete or disable the webhook endpoint while a test payment is unresolved. Disabling the gate blocks new Checkout creation; verified webhook settlement must remain available for an already-created test Checkout so a paid learner is not stranded. After every attempt is in a terminal or explicitly reviewed state, the Stripe test endpoint/key/configuration may be disabled or rotated only under a new approved change.

## Diagnose and stop conditions

- `PACKAGE_TEST_*_MISSING`, credential errors, or HTTP 503: keep the purchasing gate off; verify presence, environment scope, deployment age, and test-mode identity without exposing values.
- `review_required`: do not start another Checkout. Compare the exact stored attempt with the Stripe test Checkout/PaymentIntent using the read-only admin diagnostic.
- Invalid signature: verify the signing secret belongs to this exact endpoint; never fall back to the legacy webhook secret.
- Live event or live credential rejection: stop immediately, keep/return the gate off, preserve non-secret evidence, and audit Stripe/Vercel configuration before retrying.
- Any credential-bearing URL or secret appearing in operator, browser, terminal, screenshot, or diagnostic output: stop immediately, keep/return the purchasing gate off, preserve only sanitized evidence, create no replacement Checkout, and perform no webhook replay in that exercise. Do not repeat the exposed value. Rotate a Stripe/Vercel key or webhook secret only when the exposed value is that credential or separate evidence proves it compromised; a terminal test PaymentIntent client secret does not by itself justify rotating unrelated credentials.
- Tenant, learner, product, version, amount, currency, terms, test evidence, Checkout, PaymentIntent, or Payment Method Configuration mismatch: grant nothing and investigate the contradiction.
- Provider timeout or ambiguous response: keep the attempt `review_required`; never create a replacement session or change the idempotency key until exact provider failure/expiry is proven.
- Any credit, refund, earning, payout, transfer, Connect, Flexible 30 Hours, or Manoeuvres mutation: stop the exercise and treat it as an incident.

The normal final state after a successful controlled exercise is catalogue still enabled, purchasing gate disabled, test Stripe resources retained for diagnosis, and a concise evidence record containing only non-secret identifiers and row counts.

## Controlled pilot evidence — 15 August 2026

The School 1 exercise used disposable learner `CoachCarter Full Curriculum Pilot Learner 2` (learner 156) and attempt `e5905b24-dc37-4231-aeb5-57d3bef4eddc` against the reviewed production deployment in Stripe Sandbox mode.

- Full Curriculum was the only purchased product. The server amount was GBP 200000 pence, the Checkout identity had the `cs_test_` prefix, and Pay by Bank was the only offered payment method.
- The sanitized read-only provider diagnostic reported `consistent_paid`, `livemode=false`, Checkout `complete`, payment `paid`, exact amount and currency matches, and no contradictions.
- The signed webhook created exactly one `learner_package_purchases` row, one unstarted `paid_matching` enrolment, and one pending matching record. Programme weekly opportunities remained zero.
- A credential-bearing redirect URL appeared in diagnostic output during the payment exercise. The purchasing gate was immediately disabled, no replacement Checkout was created, no credential value was retained in this record, and the original exercise stopped.
- After a separate explicit approval, a replay-only exercise resent the retained Sandbox `checkout.session.async_payment_succeeded` event `evt_1U4gSDIqhTSdZedStBAYa75S` once to the existing production package webhook. Its durable delivery count increased from one to two and remained `processed`; the purchase, enrolment, and matching counts remained exactly one.
- Post-replay read-only checks found zero learner credit-balance rows, credit transactions, bookings, booking-credit sources, credit-source adjustments, refund events or lines, booking earnings, payout line items, payout-batch earnings, payout transfers, and payout-transfer attempts attributable to learner 156. The learner shadow balance remained zero minutes.
- Final control state was catalogue enabled, purchasing gate disabled, no Checkout available, and the dedicated test webhook retained and active. No live Stripe resource or credential was used.
