# Stripe Connect Simon Launch — Technical Implementation Plan

**Status:** interim v1 hardening implementation plan; no production behaviour is activated by this document
**Product authority:** `docs/stripe-connect-simon-launch-product-spec.md`, interim v1 rebaseline approved 13 August 2026; long-term payout-v2 target preserved
**Prepared against:** frozen `origin/main` `4a6ba4fafbebe167b113e61e80b0c0a711da3ccf` (merged PR #387) and the preserved Slice 4/A8 retry-01 evidence
**Scope:** immediate Simon Express/v1 hardening and reviewed first payout; deferred Accounts v2/payout-v2 architecture

## 0. Purpose, authority, and non-goals

This plan translates the launch product specification into a code-level, reviewable implementation sequence. The immediate milestone is a hardened, human-controlled use of the existing Express/v1 path. It explicitly supersedes the former requirement to finish Accounts v2 and payout v2 before Simon can be onboarded or initially paid, while preserving that architecture and all evidence as inactive long-term work.

The governing order is:

1. `docs/stripe-connect-simon-launch-product-spec.md` for the target product contract.
2. `AGENTS.md` and `CLAUDE.md` for repository, tenancy, money, privacy, and removed-surface constraints.
3. Current accounting and lifecycle documentation, especially `docs/booking-statuses.md`, `docs/stripe-connect.md`, `docs/per-instructor-credits-audit.md`, `docs/refund-operator-runbook.md`, and `docs/refund-exposure-valuation-audit.md`.
4. Existing production behaviour for facts not redefined by the new specification.
5. The older Payout v2 documents only where their mechanisms remain compatible.

This plan does **not** authorize migrations, production code changes, Stripe object creation, live refunds, transfers, data backfills, or cutover. Each implementation slice below remains inert until its explicit activation gate is approved.

### 0.1 Controlling interim v1 launch rules

- CoachCarter remains school-wide on `payout_engine_version='v1'` during the interim period.
- The current `api/connect.js` and `api/_payout-helpers.js` paths are evidence of the starting point, not proof that Simon can safely use them unchanged.
- Account/invite operations must be school-scoped and audit-logged, and account creation must persist a durable identity before Stripe so ambiguous success is reconciled without duplicate creation.
- Simon's onboarding state must establish a deliberate `payouts_start_date` and `payouts_paused=true`; historical `chargeable` rows must not enter his first calculation.
- Interim positive eligibility requires `chargeable` plus an approved, exact CoachCarter Stripe-funded source after the start boundary. Cash, Setmore/external, historic credit, pre-start, ambiguous and test-account sources are manual or £0.
- The read-only Fraser preview must show exact lessons, funding evidence, Stripe fees, the current `weekly_franchise_fee_pence` value and proposed transfer.
- Negative/insufficient weeks remain human-handled. Do not add automatic invoicing, Bacs collection or deferred franchise debt automation.
- Simon remains paused until Fraser separately approves the first eligible run. Onboarding, the first reviewed payout and later unattended operation are separate authority boundaries.
- The retained Accounts v2 test account shell, intents, attempts, A8 retry-01 evidence and related observations remain immutable historical evidence. They are not deleted, replaced, Production-mapped or reused as the v1 identity.
- Two payout-v2 shadow Fridays, school-wide v2 cutover and four v2 live-run approvals are not interim prerequisites.
- The authoritative lesson rule remains the three-state lifecycle: instructors are paid for calendar lessons unless the learner gave at least 48 hours' notice. No routine outcome-confirmation ledger or prompt is introduced for interim v1.

### 0.1a Superseded payout-v2 launch rules (deferred historical target)

The following rules governed the 1/11 August payout-v2 launch sequence. They remain long-term design context but no longer control the immediate Simon milestone.

- One immutable, school-scoped cutover timestamp separates legacy and launch accounting. The Stripe payment creation timestamp—not the booking date, reschedule date, webhook receipt time, or later data repair—selects the regime forever.
- Pre-cutover payments remain manual forever. Simon's existing £55 Laura payment, its £1.03 Stripe fee, and the associated September reserved lessons therefore cannot enter automated earnings or transfers.
- Automated earnings require one successful CoachCarter Stripe payment mapped to exactly one lesson, exact paid amount, exact Stripe fee, available funds, a valid active agreement, and an eligible instructor-confirmed outcome.
- New learner credit purchases, repeating bookings, and Reserved Weekly Slot creation are retired. Existing credits may still be spent and returned but generate £0 automated instructor earnings.
- Lesson outcome confirmation replaces automatic calendar-state payout eligibility. No learner approval, dual confirmation, or admin eligibility override is introduced.
- Instructor split is applied to the exact post-fee amount. The weekly franchise fee is an additional agreement obligation and is never folded into an individual lesson allocation.
- Weekly lock is Friday 12:00 Europe/London; transfer submission is Friday 14:00 Europe/London. Locked batches are immutable.
- The first live batch includes both Fraser and Simon, has no artificial amount cap, and requires Fraser's named approval.

### 0.2 Deferred payout-v2 technical decisions

These decisions describe the preserved long-term architecture. They are not requirements for the interim v1 hardening and must not reintroduce routine outcome confirmation into that milestone.

- Preserve the existing three booking states (`scheduled`, `chargeable`, `refunded`) for calendar compatibility, but stop using `chargeable` alone as evidence that money may be paid. A separate append-only lesson-outcome ledger becomes the payout gate.
- Introduce an immutable `lesson_payment_contract` linking exactly one eligible Stripe payment source to exactly one economic lesson across reschedules. A replacement booking carries the same contract; it does not create a second earning.
- Represent automatic refunds with a durable intent and append-only attempts before calling Stripe. `refund_events` remains the accounting-success ledger rather than the only operational record.
- Represent franchise fees and lost-dispute recovery as append-only instructor obligations with append-only applications. Do not import the historic £414 figure or reuse legacy recovery records.
- Materialize one instructor statement batch per active agreement, including £0 batches. Create source-linked Stripe transfer intents per payment charge inside that statement because Stripe requires an immutable `source_transaction` per transfer.
- Run financial schedules from an hourly dispatcher plus database occurrence/lease rows. Derive Friday noon, Friday 14:00, and daily 21:00 in `Europe/London`; never hardcode UTC hours through daylight-saving changes.

### 0.3 Immediate implementation boundary — Simon interim v1 hardening

This docs-only rebaseline authorises no runtime change. The next code milestone is limited to:

1. a durable, school-scoped Express/v1 account-creation command that records intent before Stripe, uses stable idempotency/reconciliation semantics, and audit-logs account creation and invitation;
2. atomic onboarding safeguards that set Simon's deliberate `payouts_start_date` and `payouts_paused=true` before eligibility can be reached;
3. a Simon-specific v1 eligibility/read-model boundary that requires both `chargeable` and exact approved CoachCarter Stripe funding after the start date, with deterministic manual/£0 dispositions for cash, external/Setmore, historic credit, pre-start, ambiguous and test sources;
4. a read-only Fraser preview derived from the same trusted calculation, itemising lesson/source identity, gross, Stripe fee, configured `weekly_franchise_fee_pence` and proposed transfer;
5. a first-run approval guard that cannot be satisfied by onboarding completion or preview generation and that leaves Simon paused when evidence is incomplete; and
6. focused fault-injection, tenant, audit, start-boundary, funding-origin, preview and authority tests.

The milestone does not create or send an account invitation, unpause Simon, run production eligibility, submit a transfer, activate a controller, operate A8/A9, switch engines or modify v2 evidence. Ongoing unattended Simon payouts are explicitly outside this milestone.

### 0.3a Superseded payout-v2 MVP implementation boundary (deferred)

The table and controls below preserve the prior payout-v2 beta plan. They no longer block the interim v1 milestone.

The product-specification MVP overlay controls launch scope. The fuller architecture below remains the target backlog, but the following capabilities are the only beta blockers:

| MVP capability | Required implementation | Explicitly deferred |
|---|---|---|
| Connect completion | Finish the existing Slice 4 staging reconciliation for Simon's retained intent; hosted onboarding; current readiness; immutable agreement | Account replacement, approximate matching, direct provider creation outside the application route |
| Eligible lesson | Direct single-slot post-cutover payment contract, exact fee/availability, explicit instructor outcome, same-contract reschedule, manual hold flags | Practical-test, offer and captured-request origins; learner issue portal; automated notifications/reminders |
| Weekly accounting | Pure plan, post-fee split, Simon £90/Fraser £0 obligations, carry-forward, £0/held statements, protected balance | Automated refund/dispute obligations; polished statement delivery and bank correlation |
| Approval and movement | Privileged manual materialization, exact Fraser approval, durable source-linked transfer, same-identity reconciliation, engine isolation | Hourly dispatcher, automatic Friday lock/transfer, automatic catch-up, ordinary-admin mutation |
| Rollout | Two shadow Fridays, controlled cutover, first four live runs manually approved/reconciled/reviewed | Unattended operation until a separate reviewed activation |

Automatic refund submission is not part of the MVP. The existing reviewed operator refund path remains the execution mechanism; launch code needs only to classify the affected contract safely, block earning/transfer, preserve append-only audit evidence and expose the hold to Fraser. The same fail-closed manual-hold rule applies to learner complaints, disputes and ambiguous payment evidence. A post-transfer incident pauses further affected-instructor runs until reviewed resolution/adjustment evidence exists.

The MVP still requires the hard contracts that make later automation safe: authenticated `school_id`, append-only financial identity, exact source evidence, immutable cutover/agreement/statement facts, protected cash, deterministic idempotency, ambiguity reconciliation, restricted mutation authority, and school-wide v1/v2 routing. No per-instructor mixed engine or legacy fallback is permitted.

Runtime gates must be canonical exact-true controls with an exact-false disabled baseline. The reviewed staging controller logic should be version-controlled and tested, including Vercel deployment URL-to-ID resolution and present-false gate inventory, before any further operational run. Temporary external controllers are not the long-term activation mechanism.

## 1. Current-state architecture map

| Concern | Current implementation | Safe to reuse | Must change or retire |
|---|---|---|---|
| Connect onboarding | `api/connect.js` creates v1 Express accounts, Account Links, status, dashboard links, and admin invites; the account call precedes durable local identity and onboarding does not establish Simon's start/pause boundary | Authenticated instructor/admin route shapes, hosted onboarding, existing school-scoped lookups and audit vocabulary | Immediate: durable ambiguity recovery, complete school scope/audit, deliberate `payouts_start_date`, paused-by-default Simon onboarding. Long term: Accounts v2 remains deferred. |
| Legacy payouts | `api/cron-payouts.js` and `api/_payout-helpers.js` compute from `chargeable` bookings; they honour `payouts_start_date`, `payouts_paused` and `weekly_franchise_fee_pence`, but do not require exact approved funding evidence and delete claims on transfer error | Interim calculation structure and admin-editable fee only after focused hardening; existing pre-payout `mark-not-delivered` exception | Immediate: exact approved-source filter, itemised read-only preview and first-run human approval. Long term: durable source-linked payout v2 remains deferred. |
| Payout v2 source ingestion | `api/_payout-v2-source-writer.js`, Stripe event receipts, canonical fingerprints, and migration 035 funding-source tables | Exact PaymentIntent/Charge/balance-transaction capture, idempotent event receipt, immutable evidence patterns | Require payment creation/availability times and a one-payment/one-lesson contract; reject goodwill, cash, credits, recurring, flexible, and multi-booking sources |
| Payout v2 earnings | `api/_payout-v2-earning-planner.js` supports commission **or** franchise, `chargeable` state, goodwill/external sources, and historic recovery | Deterministic planning/fingerprinting approach | Formula, eligibility, agreement model, outcome requirement, obligation ordering, source eligibility, and zero-statement behaviour |
| Payout v2 materialization | `api/_payout-v2-materializer.js` locks, writes immutable rows, and protects against concurrent claims | Transactional locking, canonical plan verification, append-only materialization | New run/batch/earning/obligation schema and Friday window semantics |
| Payout v2 transfers | `api/_payout-v2-transfer-executor.js` persists an intent before Stripe, uses stable idempotency, handles ambiguous results, and uses `source_transaction` | Core intent/attempt/reconciliation state machine | New batch grouping, exact source allocations, first-run approval, shared lock, and user-facing status language |
| Stripe webhooks | `api/webhook.js` validates the platform signature and records supported payment evidence; `api/_payout-v2-webhook.js` models connected events | Signature-first processing, event receipts, replay/out-of-order patterns | Split platform, Accounts v2 thin-event, and connected-account endpoints; dispatch refunds, disputes, transfers, capability state, and bank-payout evidence |
| Booking/payment entry points | `api/slots.js`, `api/offers.js`, `api/webhook.js` support direct bookings, practical test-date bookings, repeating bookings, flexible offers, reserved/repeating flows, and credits | Direct single-slot, practical test-date checkout, one-off one-lesson offer, and captured one-lesson request | Stop new repeats/reserved/flexible-credit products; require atomic one-payment/one-lesson contract creation; reject ambiguous shapes |
| Learner credits | `api/credits.js`, `learner_credit_balances`, `booking_credit_sources`, and adjustment ledgers | Existing-credit spend/return and immutable credit accounting | Keep self-serve purchases retired; mark all credit-funded lessons as £0 automated payout; remove purchase and repeat/reserved invitations |
| Booking lifecycle | `api/_booking-status.js` and booking APIs use `scheduled`/`chargeable`/`refunded`; post-end becomes `chargeable` automatically and instructors can mark an unpaid lesson not delivered | Authoritative interim lifecycle and 48-hour rule | Do not add routine outcome confirmation for interim v1. An outcome ledger remains deferred payout-v2 work. |
| Rescheduling | `api/instructor.js` and `api/slots.js` create replacement rows and copy financial/credit fields | Same-instructor availability and replacement-booking mechanics | Preserve the immutable payment contract, send immediate email/SMS, require a real replacement, and prevent duplicate earnings |
| Refund planning | `api/_refund-planner.js` identifies credit/repeat/direct/offer cases and can resolve exact fee evidence | Source-resolution helpers, preview formatting, exact fee lookup | Remove paid-out blanket block for target payments, use exact contract economics, calculate policy-specific original-method refunds, and reject legacy/ambiguous sources |
| Refund execution | `api/_refund-executor.js` calls Stripe before a durable operational intent and treats errors as definite failures | Existing authorization, operator audit vocabulary, final ledger helpers | Durable intent/attempt/reconcile states, stable identity, automatic eligible flows, and post-payout recovery accounting |
| Refund accounting | `refund_events`, `refund_event_lines`, `credit_source_adjustments`, and `booking_credit_sources` | Append-only success ledger and line-level audit | Add operational intent layer and exact links; never rewrite historic rows |
| Agreement/pricing | Instructor columns and old payout policy select commission or franchise; some screens recompute live prices | Existing instructor identity and school membership | Append-only agreement versions; split snapshot at payment; weekly fee at batch lock; active/onboarding state |
| Admin payout UI | `api/admin.js`, `public/admin/portal.js`, and `public/admin/portal.html` expose legacy overview/process/refund controls | Authenticated admin shell and read-only legacy links | Remove launch mutation from ordinary admin controls; add readiness, first approval, issues, disputes, obligations, batches, and reconciliation |
| Instructor UI | `public/instructor/earnings.*`, `dashboard.*`, and shared booking actions expose computed legacy earnings and “not delivered” credit behaviour | Auth shell, calendar actions, Connect entry points | Outcome workflow, immutable statements, current Connect readiness, issue/reschedule states, and transfer—not bank-paid—copy |
| Learner UI | `public/learner/lessons.*`, booking and offer pages support credit/repeat/reserved cancellation semantics | Auth, lesson list, direct checkout shell | Exact cancellation refund preview/receipt, post-cutover product removal, issue acknowledgement, and reschedule messaging |
| Notifications | Mail/SMS wrappers and `notification_log` record attempts for 90 days | Delivery adapters and general observability | Durable financial-notification evidence, daily 21:00 instructor reminders, issue/dispute/statement templates, and exact policy wording |
| Scheduling | Vercel invokes individual UTC crons, including payouts Friday 09:00 UTC | Vercel as wake-up mechanism | Hourly London-aware durable dispatcher; global finance lock; missed-occurrence recovery |
| Platform balance | `api/_platform-balance.js`, `_payout-v2-protected-balance.js`, and `cron-balance-snapshot.js` mix v1 payout estimates and coarse credit exposure | Exact-liability query/fingerprint patterns | Recalculate protected balance from new refunds, disputes, locked/in-flight transfers, and obligations; leave v1 only as labelled context |
| Reconciliation | `api/cron-reconcile-payments.js` scans recent Checkout sessions and alerts | Alerting shell | Contract/source reconciliation by stable Stripe identities, full lifecycle state, pagination/checkpoints, and ambiguity handling |

## 2. Conflict matrix

The final column identifies the concrete code/schema, whether it is reused, changed, or retired, and the main compatibility or migration risk. This keeps product conflict and implementation disposition in the same review surface.

| Topic | Current behaviour | New agreed rule | Required target behaviour | Components, reuse/retire decision, and compatibility risk |
|---|---|---|---|---|
| Payout eligibility | `chargeable` booking is sufficient | Interim v1 keeps `chargeable` required but adds exact approved CoachCarter Stripe funding after `payouts_start_date` | Status plus trusted funding evidence; excluded sources are manual/£0 | Harden the v1 eligibility query/read model without changing the three-state lifecycle. Preserve the outcome-ledger design only for deferred payout v2. |
| Automatic completion | Ended scheduled bookings can flow toward payment | Calendar lessons remain payable under the 48-hour rule; no routine confirmation | Keep the existing `scheduled` to `chargeable` transition and `mark-not-delivered` exception; funding evidence is the additional Simon gate | Do not build `_lesson-outcomes.js` for the interim milestone. Risk is confusing source eligibility with delivery confirmation. |
| Learner confirmation | Older removed flows considered dual confirmation | No learner approval or dual confirmation | Do not restore prompts, votes, or confirmation states | No schema/UI resurrection. Risk is opportunistic reuse of removed confirmation concepts; enforce by API/UI tests. |
| Admin override | Admin can manually process or influence old payout state | No admin payout-eligibility override | Admin impersonation invokes the same instructor endpoint and is attributed; no direct eligibility mutation | Change `api/admin.js`, `api/instructor.js`, admin UI/authority. Retire launch `process-payout` and generic eligibility controls. |
| Outcome revision | No durable revision sequence | Instructor may revise until batch lock, then immutable | Append superseding revisions; DB transaction rejects changes once locked | New outcome table/module; reuse booking ownership. Migration risk is race with Friday materialization, addressed by shared locks. |
| Direct refund basis | Credit-first, estimated list price, or blanket paid-out block | Exact original payment and exact nonreturned fee | Use immutable contract values and Stripe identities; no list-price fallback | Change `_refund-planner.js`; reuse exact source/BCS lookup only when consistent. Risk: incomplete old evidence is manual, never guessed. |
| Late learner cancellation | Current status lifecycle may pay without explicit outcome | No refund; instructor confirms late cancellation/no-show | Release the slot, then pay only after eligible instructor outcome | Change `api/slots.js`, outcome module, booking release fields. Compatibility: preserve current legacy cancellation handling. |
| Instructor cancellation | Often returns credits | Full original-method gross refund; platform absorbs fee | Eligible launch direct payment gets durable full refund and no earning; legacy credits still return and earn £0 | Change `api/instructor.js` and refund executor; reuse credit ledgers. Risk: mixing refund regimes, controlled by contract/cutover. |
| Failed refund | No durable pre-call operational intent | Cancellation stands; definite failure is pending manual resolution | Persist intent first; confirmed failure never reopens booking | Replace target executor path, add intent/attempt schema. Risk: deploy ordering; schema and disabled writer land first. |
| Ambiguous refund | Exceptions are treated alike | Reconcile same identity; never make a new refund identity | `reconciling` plus stable key; lookup/webhook closes original | Reuse transfer ambiguity pattern; change refund executor/webhook. Risk: double refund if old retry control remains reachable. |
| Paid-out refunds | Planner blocks automated refund | Refund can occur; future accounting corrects instructor share | Refund eligible contract, then append bounded obligation when required | Change planner/executor; new obligations. Retire `BOOKING_ALREADY_PAID_OUT` as a blanket launch block, retain for legacy paths. |
| Pricing | Live instructor/school fallback is recomputed | Actual paid amount and payment-time split are immutable | Snapshot gross, fee, split, identities in contract | Change source writer/Checkout/webhook; new contract. Risk: historic rows lack evidence, so no backfill or automatic eligibility. |
| Commission/franchise | Engine chooses commission **or** franchise | Split per lesson **plus** weekly franchise fee | Separate lesson allocation and weekly obligation | Retire target policy branch in `_payout-v2-earning-planner.js`; new agreement/obligation schema. Existing rows retain old accounting version. |
| Lesson formula | Gross commission and fee ordering differ | `(gross - exact Stripe fee) × split` | Integer half-up per lesson; platform gets remainder | Replace planner formula/tests; reuse integer/fingerprint patterns. Migration risk: never recalculate old materialized rows. |
| Franchise shortfall | Older designs subtract fee or fail batch | Full fee assessed; insufficient earnings transfer £0 and debt carries | Append fee obligation, apply earnings oldest-first, carry balance | New obligation/application tables; retire old shortfall semantics. Protected-balance/read model must include held payables correctly. |
| Obligation ordering | Historic recovery mechanisms are separate | Oldest first; same timestamp dispute before franchise fee | Sort `(incurred_at, type_rank, id)` with dispute first | New allocation module/constraints. Risk: nondeterminism under concurrency, covered by row locks and canonical sort. |
| Historic recovery | Payout v2 can import £414 opening amount | Clean post-cutover start; no historical liability | Never activate/import legacy recovery; keep rows read-only | Retire launch use of `_payout-v2-historical-import.js`/`_payout-v2-recovery.js`. No destructive migration. |
| Eligible sources | Payout v2 permits goodwill/external cash and credits | Exactly one CoachCarter Stripe payment to one lesson | Whitelist direct slot, practical test-date checkout, one-off offer, captured one-lesson request; others £0 | Change source certification/planner; retain source rows for audit. Risk: a positive funding row must not imply eligibility. |
| Repeats/reserved | Active surfaces create series/multiple bookings | No new repeats or Reserved Weekly Slot | Disable creation UI/API; preserve existing rows/manual treatment | Change `slots.js`, learner/admin UI, related tests. No data deletion; compatibility gate is school/cutover aware. |
| Flexible offers | One payment grants credit or covers many bookings | One payment maps to one lesson | Retire flexible/repeating launch checkout; one-off one-lesson only | Change `offers.js`, webhook, offer UI. Existing offers remain legacy/manual; do not split payments arithmetically. |
| Reschedule identity | Replacement copies selected financial fields | Same instructor and immutable financial basis | Carry the one contract to a real replacement transactionally | Change `instructor.js`/`slots.js`; new contract link/unique active guard. Risk: two active bookings/double claim under races. |
| Cutover discriminator | Older plans mix service date, imports, first-instructor flags | Stripe payment creation timestamp only | Contract regime set once from Stripe evidence | New launch config/contract; retire old cap-based cutover schema for target. No later recategorization or backfill. |
| First batch | Older plan is Fraser-only with £10 cap | Fraser and Simon, full amounts, Fraser approval | Run-level approval covers both full statement batches | Change cutover/authority/materializer; retire cap/single-instructor tests and columns for target. Risk: old guard silently truncating transfer. |
| Weekly time | Legacy cron is Friday 09:00 UTC | Friday noon lock, 14:00 transfer, Europe/London | Hourly dispatcher derives/stores zoned occurrences | Replace `cron-payouts.js` mutation and `vercel.json` schedule. DST and overlapping-cron risk require occurrence rows/global lock. |
| Late confirmation | Weekly-period logic can permanently omit lesson | Locked batch unchanged; later confirmation not current | Eligible unclaimed lesson rolls to next lock with original service date | Change planner selection/statement line model. Risk: double claim, prevented by unique contract earning claim. |
| Statement coverage | History centres on positive payouts | Every active agreement receives a statement including £0 | Materialize batch/statement for each active version | New run/batch/statement tables; reuse email adapter. Risk: assuming zero transfer means no batch. |
| Transfer success copy | Copy can imply bank arrival | “Transferred to Stripe,” not bank paid | Transfer created/reconciled is distinct from bank payout | Change `_payout-email.js` and portals; reuse connected bank visibility separately. Compatibility copy tests required. |
| Transfer failure | Legacy claims can be deleted/retried | Stable plan/key; ambiguity blocks | Reuse durable intent/attempt state; never release ambiguous plan | Reuse/change `_payout-v2-transfer-executor.js`; retire `_payout-helpers.js` claim deletion. Risk: overlapping old cron/admin. |
| Lock ownership | Cron/admin can overlap money paths | Shared global lock | One finance mutation lock around materialize/transfer/reconcile commands | Change authority/cron/admin modules. Row locks remain defence-in-depth; avoid long external calls while DB transaction is open. |
| Connect data | One-way onboarding boolean | Current Accounts v2 requirements/capabilities | Append observations and derive current readiness | Change `connect.js`; new state events; reuse account scope registry. Risk: capability regression hidden by stale true value. |
| Stripe account API | Legacy Accounts v1 Express | Accounts v2 hosted onboarding with Express dashboard access | Recipient-configured Accounts v2 account, Express dashboard, and v2 Account Link | Replace creation/status path, retain old IDs as legacy evidence. Never delete/recreate on ambiguity. |
| Dispute opening | Not integrated with planner | Pre-payout blocks; post-payout opening does not withhold | Map to contract; exclude only unlocked affected lesson | New dispute modules/schema; reuse webhook receipt patterns. Locked batch immutability avoids retroactive mutation. |
| Dispute loss | No target recovery rule | Future recovery is the proportional part of the original instructor share and never more than that share | One idempotent final-loss obligation using half-up proportional rounding; platform absorbs fees/excess | New obligation source and dispute event state; formula and worked examples are locked in section 13. |
| Issue report | No payout-specific signed learner path | Signed/rate-limited; pre-noon blocks, post-noon does not | Persist cutoff classification at submission | New issue/token/action schema/API/UI. Risk: token/PII abuse and lock race, handled transactionally. |
| Notification evidence | General log is purged after 90 days | Financial notices/statements need durable audit | Separate append-only financial delivery attempts | Reuse mail/SMS adapters, not retention table. Migration adds no historic synthetic delivery evidence. |
| Tenant scope | Old queries default to school 1 or broad IDs | Every tenant row/query scoped by `school_id` | Auth-derived scope and tenant-safe keys everywhere | Change affected APIs and all new schema; no `school_id || 1`. Compatibility risk is legacy ID-only joins, covered by cross-school tests. |
| Stripe SDK/version | Floating `stripe:^14.0.0`, global client | Accounts v2/current event/API semantics | Pin/test modern client and explicit API version first | Change package/client boundary; behaviour-preserving Slice 0. Risk: SDK response/type changes across all existing Stripe flows. |

## 3. Target architecture and end-to-end flows

### 3.1 Accounting boundaries

The system has three explicit layers:

1. **Payment evidence:** immutable Stripe facts and the one-payment/one-lesson contract.
2. **Lesson accounting:** append-only instructor outcomes, issues, refunds/disputes, exact earning, and obligation applications.
3. **Money movement:** immutable Friday runs/statements, durable source-linked transfer intents, Stripe reconciliation, and connected bank-payout visibility.

No frontend action, booking status, live price, or Connect dashboard flag may jump directly from layer 1 to layer 3.

### 3.2 Eligible direct payment flow

1. A supported direct checkout is created with authenticated `school_id`, instructor, learner, booking proposal, and a server-calculated price. Metadata includes a stable payment-contract candidate UUID and supported origin.
2. The success webhook is verified and recorded idempotently. In one database transaction it writes/updates exact Stripe funding evidence, creates the lesson booking, and creates one immutable lesson payment contract linked to both.
3. The contract records Stripe payment creation time and selects `legacy` or `launch` using the immutable school cutover. It snapshots gross pence, exact Stripe fee pence, currency, split basis points, and source identities. Until exact fee and funds-availability evidence arrive, it is `evidence_pending` and cannot earn.
4. After the lesson end, the instructor records an outcome. A reschedule links a real same-instructor replacement to the same contract. Delivered or late-cancel/no-show can become payable; instructor non-delivery starts a full refund and is not payable.
5. Before Friday noon, the planner independently proves every eligibility predicate. At noon, a serializable/locked transaction writes the run, statements, earnings, weekly obligations, obligation applications, and transfer allocations.
6. At 14:00, an approved run's transfer plans are submitted by stable idempotency keys. The UI reports “Transferred to Stripe” only after the Stripe transfer is reconciled as created.

### 3.3 Cancellation and refund flow

- **Learner, 48 hours or more:** cancel and release the slot transactionally; calculate `gross - exact nonreturned Stripe fee`; show gross, fee, and net before confirmation; persist the automatic refund intent before Stripe; successful refund produces the immutable event/lines. The lesson never earns.
- **Learner, under 48 hours:** cancel/release without refund. The instructor later confirms `late_learner_cancel_or_no_show` after the scheduled end. That explicit outcome can earn.
- **Instructor non-delivery/cancellation:** cancel/release and plan a full-gross original-method refund. The platform absorbs the Stripe fee. No earning is created.
- **After a transfer:** a valid refund remains executable. If the product rule makes the instructor responsible for returned principal, create an obligation capped by that contract's locked instructor share; never rewrite the transferred statement.
- **Credit-funded or legacy lesson:** preserve existing credit-return/manual rules and record automated payout as £0. The new Stripe refund executor must not manufacture a payment contract for it.

Cancellation state is committed before external submission. A definite Stripe failure leaves the lesson cancelled and the slot open, marks the intent `failed_confirmed`, alerts operators, and exposes pending manual resolution. A timeout or uncertain response marks `reconciling`; all follow-ups reuse the original intent and idempotency key.

### 3.4 Weekly lock, fee, debt, and transfer flow

- Define each run as `[previous Friday 12:00 Europe/London, current Friday 12:00 Europe/London)` for display and agreement-fee assessment. Eligible unclaimed lessons may have older service dates; late confirmations roll forward rather than disappearing.
- Select every agreement version active at the exact lock instant. Materialize a statement even if the instructor has no earnings, is not transfer-ready, or owes more than that week's earnings.
- For each eligible lesson: `net = gross - Stripe fee`; `instructor_share = round_half_up(net × split_bps / 10,000)`; `platform_share = net - instructor_share`. All amounts are integer minor units and the equation is enforced by the database.
- Assess the full weekly franchise fee from the agreement version effective at lock. Add it as an obligation; do not allocate it across lessons.
- Apply available instructor shares to outstanding obligations ordered by `(incurred_at, type rank, id)`, where final dispute losses sort before weekly franchise fees at the same instant.
- If obligations consume all earnings, transfer £0. Unapplied obligation principal carries forward. Manual repayment, clearance, write-off, and corrections are new append-only application/adjustment rows; principal rows are immutable.
- Allocate obligation applications across earnings, then allocate the remaining instructor share back to exact payment sources in deterministic `(stripe_payment_created_at, payment_contract_id)` order. Create one or more transfer plans with immutable `source_transaction` and a total no greater than that charge's available source balance. Persist each earning disposition so the ordering is auditable rather than recomputed later.
- Lock all rows and claims at noon. No later outcome, issue, refund, dispute opening, agreement edit, or bank-readiness change mutates that run.

### 3.5 Issues and disputes

A learner issue URL uses a signed, single-purpose token containing school, learner, booking, nonce, and expiry. Submission is authenticated by the token, rate-limited, recorded append-only, and acknowledged generically. If received before the run lock it blocks that lesson; if received after lock it cannot affect the locked run. It never alerts the instructor automatically.

Stripe disputes are mapped through Charge/PaymentIntent to the payment contract. An open dispute blocks an unlocked lesson. Opening after transfer does not withhold new unrelated money. A won dispute changes no prior accounting. A final loss creates one idempotent future obligation for no more than the original instructor share; processing fees, platform share, and dispute fees remain platform costs. Evidence packs and manual response status are versioned, with admin deadline alerts and three-day/24-hour reminders.

## 4. Database implementation

Use additive migrations after `035_payout_v2_ledger_foundation.sql`; never edit an applied migration. Keep the old Payout v2 tables and recovery history read-only until retention decisions are separately approved. Every new tenant table has a non-null `school_id`, composite tenant-safe foreign keys (or a transactionally enforced equivalent where existing tables lack composite uniqueness), and school-first indexes.

### 4.1 Changes to existing tables

#### `payout_funding_sources`

Add only if the data is not already represented consistently:

- `stripe_payment_created_at timestamptz`
- `stripe_funds_available_at timestamptz`
- `payment_origin text` constrained to supported enumerated values
- `source_booking_id bigint null`
- `lesson_payment_contract_id uuid null`
- `evidence_completeness text` (`pending`, `complete`, `contradictory`)
- `contradiction_code text null`

Add a school-scoped unique index for non-null PaymentIntent ID and another for Charge ID. Add a unique partial index on `lesson_payment_contract_id`. Exact Stripe fee must remain nullable while evidence is pending; **zero is not a missing-fee default**. Source writer updates may fill previously unknown Stripe facts but must reject changes to a non-null contradictory fact and record the contradiction for review.

Do not use positive `platform_goodwill`, `external_cash`, credit grants, or historic-import sources in the launch planner. Preserve their rows for old audits.

#### `lesson_bookings`

Add:

- `lesson_payment_contract_id uuid null`
- `slot_released_at timestamptz null`
- `slot_release_reason text null`

The nullable link allows legacy and credit-funded lessons to remain valid. Add a partial unique index preventing more than one active (`scheduled` or `chargeable`) booking from holding the same contract. Because existing reschedule code can create old/refunded and replacement rows, history may contain multiple rows with the link, but only one may be active.

#### `booking_earnings`, `booking_earning_sources`, `payout_batches`

Do not change the meaning of already materialized rows. Add target-version columns only if reuse is less risky than parallel tables:

- `accounting_version text` with launch value `simon_launch_v1`
- outcome revision/contract/run links
- exact split snapshot and source-allocation fields

Recommended approach: retain `booking_earnings` and `booking_earning_sources` for compatible per-lesson rows, but introduce new run and disposition tables below. The migration must replace old equation assumptions for **new-version rows only**: franchise fee is not a per-lesson allocation, and an instructor share can be consumed by obligations before transfer. Existing rows remain checked under their original version.

`payout_batches` may remain the instructor statement-batch row only if the migration can add a non-null `payout_run_id` for new rows, `agreement_version_id`, `statement_status`, and new conservation constraints without weakening old records. Otherwise create `instructor_payout_batches` and leave the old table untouched. The implementation PR must choose one based on a migration rehearsal; parallel tables are the safer default.

### 4.2 New cutover and feature-control tables

#### `stripe_connect_launch_configs`

One row per school:

- `id uuid primary key`
- `school_id bigint not null unique`
- `cutover_at timestamptz not null`
- `accounting_version text not null`
- `mode text not null` (`disabled`, `shadow`, `approval_pending`, `live`, `paused`)
- `created_by_admin_id bigint not null`
- `created_at timestamptz not null`
- `activated_at timestamptz null`
- `paused_at timestamptz null`
- `pause_reason text null`

Database trigger: `cutover_at`, `school_id`, and `accounting_version` are immutable after insert. Mode transitions are validated and audited; returning from `live` to `shadow` is not allowed because post-cutover payment classification must remain stable.

#### `stripe_connect_launch_events`

Append-only audit of mode change, first-run approval, pause, resume, and legacy-engine disablement:

- school/config, event type, actor type/id, reason, evidence JSON, occurred time
- unique idempotency identity per administrative command

The older single-first-instructor/cap cutover table is not populated for this launch; its shape contradicts the product contract.

### 4.3 `lesson_payment_contracts`

One immutable economic contract for each supported launch payment:

- `id uuid primary key` generated before Checkout
- `school_id`, `learner_id`, `instructor_id`
- `funding_source_id bigint not null unique`
- `origin text not null` (`direct_slot`, `test_date_direct`, `one_off_offer`, `captured_request`)
- `regime text not null` (`legacy`, `launch`)
- `stripe_payment_created_at timestamptz not null`
- `gross_amount_minor bigint not null check >= 0`
- `stripe_fee_minor bigint null check >= 0`
- `currency char(3) not null`
- `split_bps integer not null check between 0 and 10000`
- `agreement_version_id uuid null`
- `stripe_payment_intent_id text not null`
- `stripe_charge_id text not null`
- `stripe_balance_transaction_id text null`
- `stripe_funds_available_at timestamptz null`
- `evidence_status text not null` (`pending`, `complete`, `contradictory`, `ineligible`)
- `ineligibility_code text null`
- `created_at`, `completed_at`, `fingerprint`

Constraints:

- unique `(school_id, stripe_payment_intent_id)` and `(school_id, stripe_charge_id)`;
- one funding source and one economic contract;
- `regime` is deterministically checked against the school cutover and Stripe payment creation time in the creation transaction;
- immutable evidence trigger after `complete`; evidence completion can fill null fee/balance transaction/availability values but cannot replace a known value;
- a launch-complete contract requires exact fee, exact charge, active same-school instructor, supported origin, agreement/split snapshot, and one current booking link;
- no synthetic backfill for pre-cutover payments.

### 4.4 `lesson_outcome_revisions`

Append-only instructor outcome evidence:

- `id uuid primary key`
- `school_id`, `booking_id`, `lesson_payment_contract_id null`, `instructor_id`
- `revision_number integer not null`
- `outcome text not null` (`delivered`, `late_learner_cancel_or_no_show`, `instructor_non_delivery`, `rescheduled`)
- `supersedes_revision_id uuid null`
- `replacement_booking_id bigint null`
- `actor_type text not null` (`instructor`, `admin_impersonating_instructor`)
- `actor_instructor_id bigint not null`
- `actor_admin_id bigint null`
- `occurred_at`, `created_at`, `idempotency_key`, `reason_code null`

Unique `(school_id, booking_id, revision_number)` and command idempotency. A deferred constraint/transaction validates same-school instructor ownership, lesson has ended for payable outcomes, and `rescheduled` has one real same-instructor replacement carrying the same contract. The current revision is derived with `row_number`/max revision; no mutable `is_current` flag is required.

Outcome revisions are rejected if any related launch earning is locked. The rejection is enforced in the same transaction under a row/advisory lock, not only in JavaScript.

### 4.5 `lesson_issue_reports` and tokens

`lesson_issue_tokens` stores only a token digest, nonce, school, booking, learner, expiry, issue-purpose, created time, consumed time, and revocation time. `lesson_issue_reports` stores school, booking, learner, token ID, category, sanitized learner text, `reported_at`, `cutoff_classification` (`before_lock`, `after_lock`, `no_applicable_run`), applicable run ID, acknowledgement delivery state, and idempotency fingerprint.

Unique token consumption and rate-limit keys prevent duplicate/cost amplification. No report row is updated to “not blocking”; resolution is a separate append-only `lesson_issue_actions` row. Admin can record review/resolution but cannot make the lesson eligible for an already applicable run.

Add issue/report content and token identifiers to learner GDPR export. On deletion, anonymize learner free text and identity subject to financial/legal retention; do not hard-delete audit links.

### 4.6 Durable refund operation tables

#### `refund_intents`

- school, learner, instructor, booking, payment contract, funding source
- refund policy (`learner_early`, `instructor_non_delivery`, `dispute_or_operator_correction`)
- exact gross, absorbed Stripe fee, refund amount, currency
- Stripe PaymentIntent/Charge and eventual Refund ID
- stable internal identity and Stripe idempotency key
- state (`planned`, `submitting`, `reconciling`, `succeeded`, `failed_confirmed`, `manual_review`)
- cancellation/slot-release transaction timestamp
- source batch/earning link when already paid
- created/updated timestamps, operator/system actor, last error class/code

Unique `(school_id, stable_identity)` and non-null contract uniqueness per policy command. A successful intent links one `refund_event`; it does not replace the existing immutable accounting ledger.

#### `refund_attempts`

Append-only attempt number, intent, request fingerprint, idempotency key, Stripe request ID, response classification (`success`, `definite_failure`, `ambiguous`), sanitized error code, observed Refund ID/status, and timestamps. The idempotency key must equal the intent's stored key on every attempt.

State transitions use compare-and-set/locks. Only Stripe-confirmed terminal failures can become `failed_confirmed`; timeouts, network errors, and unknown responses become `reconciling`. Webhooks and polling may close a reconciling intent but cannot generate a second refund identity.

### 4.7 Agreements and Connect state

#### `instructor_payout_agreement_versions`

- school/instructor
- `version_number`
- effective `[starts_at, ends_at)`
- `status` (`draft`, `active`, `paused`, `ended`)
- `split_bps`
- `weekly_franchise_fee_minor`
- `currency`
- acceptance/evidence fields and document version
- Connect account ID/configuration ID
- created/approved actor and timestamps

No overlapping active/effective ranges for an instructor. Agreement rows are immutable after activation; correction means a new version. Payment contracts snapshot the active split/version at Stripe payment creation. The weekly fee is selected from the version active at the Friday lock.

Initial approved data is Simon £90 weekly fee and Fraser £0, expressed in minor units/configuration rather than code. Simon cannot be transfer-live until onboarding, agreement acceptance, and first-run approval are all present.

#### Connect observations

Reuse `payout_v2_connected_account_scopes` for account/context ownership if its constraints remain tenant-safe. Add `connect_account_state_events` as append-only observations of Accounts v2 requirements/capability events and explicit API refreshes: school, instructor, account, event ID/type, context, requirement summary, stripe-balance transfer capability status, dashboard type, observed_at, payload fingerprint, and sanitized evidence JSON. New Simon/future-instructor recipient accounts require `dashboard = 'express'`; any different observed dashboard value is a readiness blocker.

Derive current readiness from the latest authoritative observations plus an on-demand retrieve. Do not retain `onboarding_complete = true` as irreversible truth.

### 4.8 Runs, batches, earnings, dispositions, and statements

#### `payout_runs`

- school, accounting version, scheduled lock occurrence, exact `lock_at`, exact `transfer_at`
- service-window start/end
- state (`planned`, `shadowed`, `approval_pending`, `locked`, `transferring`, `transferred`, `reconciling`, `failed_confirmed`, `paused`)
- first-live flag and named approval ID/time
- planner version/fingerprint, totals, created/locked times

Unique `(school_id, accounting_version, lock_at)`. First live run cannot enter `locked` without Fraser's recorded approval and readiness evidence for both instructors. A trigger prevents financial fields/fingerprint from changing after `locked`.

#### `instructor_payout_batches` (recommended parallel table)

One child per active agreement at lock:

- run, school, instructor, agreement version, Connect account
- gross/Stripe fee/net/instructor share/platform share
- opening obligation, new obligation, applied obligation, closing obligation
- transfer planned/submitted amounts
- state and fingerprint

Unique `(school_id, payout_run_id, instructor_id)`. Conservation constraints assert lesson net equals instructor plus platform share; instructor share equals obligation application plus transfer allocation plus explicitly classified held amount. A £0 batch is valid and mandatory.

#### Earnings and dispositions

For each target-version `booking_earnings` row, store the payment contract, selected outcome revision, exact gross/fee/net, split basis points, instructor/platform shares, service date, selected run, fingerprint, and lock timestamp. Unique payment-contract claim prevents double pay across reschedules.

`payout_batch_earning_dispositions` allocates each earning's instructor share among:

- `obligation_application`
- `transfer_allocation`
- `held_connect_not_ready`

The agreed launch behaviour is to materialize the earning and £0 transfer statement for a not-ready account without losing the earning claim or blocking other ready instructors. The held amount remains a protected platform liability. Release requires an explicit later run/disposition using the original locked amount, not mutation of the locked statement, repricing, or lesson reconfirmation. This must be proven in slice tests.

#### `payout_statements` and `payout_statement_delivery_attempts`

One immutable statement per batch with statement number, display period, line-item JSON snapshot or normalized line rows, totals, obligation roll-forward, transfer status wording, generated time, content fingerprint, and durable storage reference if PDFs are later introduced. Start with HTML/email plus persisted canonical JSON; PDF is not a launch requirement.

Delivery attempts are append-only: recipient, channel, template version, statement fingerprint, provider message ID, outcome, error code, and times. These records are retained with financial audit data and do not depend on the 90-day general notification log.

### 4.9 Instructor obligations

#### `instructor_payout_obligations`

Immutable principal rows:

- school/instructor/agreement
- type (`weekly_franchise_fee`, `final_dispute_loss`)
- incurred_at and deterministic type rank
- original amount/currency
- source run for franchise fee or source dispute/payment contract for loss
- idempotency identity and evidence fingerprint
- created actor/time

Unique source identity prevents duplicate weekly fees or dispute recovery.

#### `instructor_payout_obligation_applications`

Append-only reductions/corrections:

- obligation, school/instructor
- application type (`batch_earnings`, `manual_repayment`, `manual_clearance`, `write_off`, `reversal`)
- amount, source batch/payment/reference, actor, reason, occurred time, idempotency identity

The sum of non-reversed applications cannot exceed principal. Manual clearance/write-off requires named privileged authority and audit reason; ordinary admin cannot use it as payout eligibility override. Allocation locks obligations in oldest-first order and ranks a final dispute loss before a franchise fee when timestamps tie.

### 4.10 Disputes and evidence

Create:

- `payment_disputes`: school, Stripe dispute/charge/PI, payment contract, current terminal state, amount/currency, reason, deadlines, current fingerprint.
- `payment_dispute_events`: append-only Stripe event ID/type, created time, observed status, evidence fingerprint; unique event ID/context for replay safety.
- `dispute_evidence_pack_versions`: immutable generated evidence snapshots, included record IDs, document hashes, creator, generation time, and manual Stripe-submission reference/status.
- `dispute_notification_attempts`: durable admin alerts, deadline reminders, three-day/24-hour reminders, and outcome notices.

Out-of-order events may advance the derived state only according to a monotonic transition table; an older event remains recorded but cannot reopen a terminal won/lost dispute. One final loss creates at most one obligation.

For a partial final principal loss, the obligation principal is:

```text
min(
  original instructor share,
  round_half_up(original instructor share × final disputed principal lost ÷ original gross payment)
)
```

Stripe dispute fees never enter the instructor obligation and remain CoachCarter's responsibility.

### 4.11 Scheduler and operation records

#### `financial_job_occurrences`

- school or global scope
- kind (`outcome_digest`, `weekly_lock`, `weekly_transfer`, `refund_reconcile`, `transfer_reconcile`, `dispute_deadline_reminder`)
- scheduled local label/time zone and exact scheduled UTC instant
- state, lease owner/expiry, attempt count, started/completed times, result fingerprint/error code

Unique `(scope, kind, scheduled_at_utc)`. This turns Vercel cron into a wake-up rather than the clock of record. Missed occurrences can be safely caught up within a bounded policy.

### 4.12 Migration, backfill, and integrity policy

- Migration A adds inert schemas, constraints, and diagnostics only.
- Migration B adds nullable links/columns to existing booking/source tables and compatible indexes.
- Seed only approved agreement/config data through a separately reviewed, school-scoped administrative migration or command. Do not hardcode Fraser/Simon IDs, percentages, or £90 in production JavaScript.
- Backfill **no** payment contracts, earnings, debts, or automatic refund eligibility for pre-cutover payments. Existing credit, booking-credit-source, BCS, refund, payout, and Stripe evidence remains untouched.
- Rehearse migrations against a production-shaped clone. Preflight must detect duplicate Stripe identities, cross-school links, overlapping agreements, multiple active bookings per candidate contract, invalid currencies, and incomplete source evidence.
- Postflight must prove row-count stability for all existing ledgers, zero launch earnings/transfers, no changed historic hashes, and all new feature modes `disabled`.
- Add database tests for append-only triggers, immutable cutover/contracts/runs/statements, tenant composite links, amount conservation, no over-application, unique contract claims, and same-key retry constraints.

## 5. Backend implementation by file and endpoint

The filenames below are implementation targets, not permission to combine all work into one PR. New modules should be small, deterministic, and dependency-injected for tests. All monetary endpoints use `requireAuth`/existing role helpers, derive `school_id` from trusted auth, validate same-school ownership, and never accept client prices, fees, split percentages, agreement IDs, Stripe amounts, or instructor scope as authority.

### 5.1 Stripe client boundary

#### New `api/_stripe-clients.js`

- Export separately named platform v1-resource and Accounts v2 clients/configuration rather than a process-global ambiguous client.
- Pin the Stripe API version explicitly and expose it to readiness diagnostics.
- Accept restricted-key environment variables for narrowly scoped runtime jobs where Stripe supports the required resource permissions; keep the general secret key out of frontend/build output.
- Centralize request timeouts, telemetry/app metadata, safe error classification, idempotency-key validation, and test injection.
- Fail closed if a money mutation is attempted without an explicit API version, expected key class, or feature mode.

At planning time, Stripe's official `stripe-node` changelog lists `22.4.0` with API `2026-07-29.dahlia`; the repository currently uses `stripe:^14.0.0`. The implementation must pin a tested version (not a floating major), run the complete Stripe/payment suite, and re-check Stripe's official compatibility documentation at that PR's date. Accounts v2 calls should use the pinned SDK surface where supported; any raw request fallback must still use the same pinned API version and response schemas.

### 5.2 Connect onboarding and readiness

#### Immediate interim v1 hardening in `api/connect.js`

- Introduce one durable, school-scoped account-creation intent keyed to Simon's instructor/school/mode and persist it before calling Stripe Accounts v1. Use one stable Stripe idempotency key where supported and reconcile the stored identity after timeouts or ambiguous responses; never treat a blank instructor mapping as permission to create again.
- Keep `type: 'express'` only as the explicitly owner-approved interim compatibility path. This is not a recommendation to use Accounts v1 for new platforms generally and must not replace the preserved Accounts v2 target.
- Require authenticated same-school instructor/admin scope on every read and update. Audit account creation, reconciliation, invitation, start-date selection and pause state without exposing provider secrets.
- Establish the deliberate `payouts_start_date` and `payouts_paused=true` state transactionally before returning or sending an onboarding link for Simon. A provider account must not make him eligible by itself.
- Keep onboarding invitation and account creation separable so implementation/testing cannot accidentally email Simon. Sending the invitation requires later operational authority.
- Preserve the retained test-mode Accounts v2 shell and its intent/attempt evidence without mapping, deletion, replacement or Production reuse.

#### Deferred payout-v2 refactor of `api/connect.js`

Retain authenticated routes but version their response contract. Proposed endpoints:

- `POST /api/connect/account`: instructor self-service or privileged school admin creates/retrieves the one same-school Accounts v2 account. Request contains no trusted economic fields. Use a deterministic database creation command and Stripe idempotency key; persist pending identity before external creation; reconcile ambiguous responses rather than creating another account.
- `POST /api/connect/onboarding-link`: create a single-use `/v2/core/account_links` link for the stored account with `configurations: ['recipient']`, secure return/refresh URLs, and current outstanding requirement collection. Return URL triggers a status refresh but is not proof onboarding completed.
- `GET /api/connect/status`: derive agreement state, current recipient capability/requirements, account ownership, transfer readiness, first-approval state, and blocking reasons. Never collapse readiness to one historical boolean.
- `POST /api/connect/dashboard-link`: create the supported dashboard login/access link only when the configured dashboard type allows it.
- `GET /api/connect/readiness-evidence` (privileged): show sanitized latest event/API observations and discrepancies for launch review.

Create Accounts v2 with recipient configuration for separate charges and transfers, Express dashboard access, and the Stripe-balance transfers capability request. The exact payload and response expansion must be contract-tested against the pinned API. The account is not ready until Stripe's current recipient configuration, Express dashboard, capability, and requirements response meet the launch predicate.

Remove `school_id || 1` and any unscoped instructor/account lookups. Ordinary admin may send onboarding invitations but cannot approve an agreement, override capability state, or mark an account complete.

#### New `api/webhook-connect-v2.js`

- Verify the dedicated Accounts v2 event signature before parsing/processing business data.
- Support thin events such as account requirements updates, recipient capability status updates, and recipient configuration updates using event context/object retrieval as Stripe requires.
- Register expected account/context/school ownership before applying an event.
- Record event receipt and state observation idempotently; unknown or cross-school context is quarantined and alerted, never guessed.
- Return success for a verified replay after confirming its prior fingerprint; reject an event ID with contradictory payload evidence.

#### New `api/webhook-connect-events.js` or a clearly separated route

Handle connected-account transfer/payout/bank visibility events with the connected webhook signing secret and account context. Reuse the compatible receipt and bank-visibility logic from `api/_payout-v2-webhook.js`. Do not mix this secret or trust boundary with Accounts v2 thin events or the platform payment endpoint.

### 5.3 Payment creation and one-lesson contracts

#### `api/slots.js`

- Direct single-slot Checkout may create a launch contract candidate UUID before Stripe. Metadata must contain only stable IDs and schema version; the server re-loads every trusted value.
- Reject `repeat_weeks > 1`, new Reserved Weekly Slot creation/move into a series, and any request that would map one payment to multiple lessons once the school reaches the product-retirement activation slice. Existing series rows remain viewable/manageable under legacy rules.
- Require a same-school active instructor and payment-time active agreement for launch-regime checkout. If evidence/config is incomplete, fail before Checkout rather than create an automatically ineligible payment.
- Preserve direct-pay single booking and existing-credit booking as separate paths. Credit path writes no launch payment contract and displays £0 automated payout semantics.
- Cancellation preview endpoint must return server-calculated policy, gross, fee, net refund, reason, and evidence state for supported direct contracts. Confirmation sends only a preview token/fingerprint, never an amount.
- Under-48 learner cancellation releases the slot but awaits instructor outcome after scheduled end; it does not pre-create an earning.

#### `api/offers.js`

- Permit a one-off offer only when acceptance creates one exact lesson and one payment contract.
- Disable new flexible-credit offers and repeating series at launch. Existing accepted offers/series keep legacy/manual behaviour.
- Snapshot the server-calculated paid amount and candidate contract identity in Checkout metadata.
- Do not interpret one payment spread over multiple bookings as eligible even if amounts can be divided arithmetically.

#### `api/webhook.js`

- Keep signature verification as the first action.
- Dispatch platform events to small handlers by schema version/event type: Checkout/PaymentIntent/Charge/balance transaction, refund, dispute, and transfer reconciliation.
- For a supported checkout, lock the contract candidate and Stripe identity, verify session/payment status, server metadata, instructor/school/learner, expected amount/currency, and one-booking shape. Write booking, funding source, and contract atomically or mark contradictory evidence without partial eligibility.
- Populate `stripe_payment_created_at` from the authoritative Stripe object and classify regime against immutable cutover. Webhook receipt time is never substituted.
- Obtain exact fee and funds availability from the Charge balance transaction. Until present, leave evidence pending and enqueue reconciliation. Never coerce missing fee to zero.
- Existing recurring, flexible-offer, credit, or pre-cutover events may complete their legacy product behaviour but must be explicitly classified ineligible for launch earnings.
- Map refunds/disputes by stable Stripe IDs and use replay/out-of-order-safe handlers.

#### Refactor `api/_payout-v2-source-writer.js`

- Retain canonical evidence/fingerprint/idempotency mechanics.
- Add the exact creation/availability/origin/contract fields and contradiction state.
- Split “record evidence” from “certify launch eligibility.” Recording a positive source does not imply it can fund an earning.
- Require school-aware identity queries and remove any funding-class path not in the product whitelist from the target planner.

#### Replace `api/cron-reconcile-payments.js` logic

Retain the route only as a compatibility wrapper to the financial dispatcher. New reconciliation must use persisted pending/reconciling records and cursors, not “last 25 hours of Checkout.” It must:

- retrieve known PaymentIntent/Charge/balance-transaction identities;
- fill only previously unknown evidence;
- detect one-to-many and amount/currency contradictions;
- retry contract finalization idempotently;
- paginate with checkpoints and bounded work;
- alert stale pending sources and never make an ambiguous source eligible.

### 5.3a Interim v1 payout selection and preview

Harden `api/_payout-helpers.js` and the narrow admin read surface without changing other instructors' economics:

- keep `CHARGEABLE`, unpaid-line-item, non-test-account and `payouts_start_date` predicates;
- add a fail-closed Simon funding classifier that accepts only explicitly approved exact Stripe-funded source shapes proving CoachCarter receipt, exact gross and attributed Stripe fee;
- produce reason-coded manual/£0 exclusions for cash, Setmore/external, historic credit, pre-start, ambiguous/contradictory evidence and test accounts;
- remove all list-price or zero-fee fallbacks from positive Simon lines when exact funding evidence is absent;
- calculate the weekly deduction from the loaded `weekly_franchise_fee_pence`, never a Simon-specific constant;
- expose a read-only, school-scoped Fraser preview that lists included/excluded lessons, evidence identities, gross, fees, weekly fee and proposed transfer; and
- add an explicit first-run approval/paused guard around any later Simon mutation path. Preview generation and onboarding completion cannot clear the guard.

Implementation must decide and test how the existing payout claim/transfer ambiguity weakness is contained for the reviewed first run. It may reuse a durable intent/reconciliation primitive, but it must not broaden the task into school-wide payout v2 or claim that current delete-on-error behaviour is safe.

### 5.4 Deferred payout-v2 outcomes, rescheduling, cancellation, and issues

This section is not part of the interim v1 milestone. Interim v1 uses the existing three-state lifecycle and `mark-not-delivered` exception; it does not add a routine outcome prompt or ledger.

#### New `api/_lesson-outcomes.js`

Pure validation and transactional command functions:

- determine current outcome revision;
- validate lesson end, cancellation timing, actor, same instructor/school, real replacement, and contract continuity;
- append a revision under booking/contract/run locks;
- reject revisions after earning/run lock;
- trigger but do not inline-execute refund or reschedule notifications;
- expose a deterministic eligibility reason list for planner and UI.

#### `api/instructor.js`

Add/version routes:

- `GET /api/instructor/lesson-outcome/:bookingId`: booking facts, current revision, revision deadline/lock state, allowed actions, and payment-evidence readiness without exposing learner payment secrets.
- `POST /api/instructor/lesson-outcome/:bookingId`: `delivered`, `late_learner_cancel_or_no_show`, or `instructor_non_delivery` with command UUID and current revision. Admin impersonation uses this command through an explicit impersonation context.
- `POST /api/instructor/reschedule/:bookingId`: require same instructor, real available replacement slot, command UUID, and contract-continuity transaction; append `rescheduled` outcome and release/replace the booking atomically.
- `GET /api/instructor/statements` and `/statements/:id`: immutable school/instructor-scoped statement reads, obligation roll-forward, source/service lines, and transfer status.

Replace the current “mark not delivered and return credit” launch path with policy-aware handling. Existing-credit lessons still use the credit ledger, but a launch direct-payment contract creates a full-gross refund intent. Do not let a generic booking update endpoint bypass outcome locks.

#### `api/slots.js` learner cancellation/reschedule routes

- Use a single transactional command for cancellation, slot release, refund intent creation, and idempotency identity.
- Enforce 48 hours using the authoritative lesson start instant and server time, with boundary tests at exactly 48 hours and DST transitions.
- A learner reschedule must preserve same instructor and contract financial basis; if it creates a replacement immediately, use the shared reschedule command and send immediate email/SMS.
- Reject reschedule when a refund is already planned/submitting/succeeded, an earning is locked, or a dispute/issue state makes the action contradictory.

#### New `api/lesson-issues.js`

- `POST /api/lesson-issues/token` from authenticated learner context creates/returns a short-lived single-purpose token for an eligible lesson.
- `POST /api/lesson-issues/report` verifies signature, digest, expiry, learner/booking relation, nonce use, school, rate limit, and sanitized payload; records cutoff classification in the same transaction.
- `GET /api/admin/lesson-issues` and `POST /api/admin/lesson-issues/:id/action` support review/audit only. They cannot add a payable outcome or alter a locked batch.
- Generic acknowledgement discloses no payout effect. No automatic instructor notification.

### 5.5 Refunds

#### Refactor `api/_refund-planner.js`

Create a target-contract planner that returns a closed discriminated result:

- eligible early learner cancellation: refund `gross - exact nonreturned Stripe fee`;
- eligible instructor non-delivery: refund full gross, platform fee absorption recorded;
- legacy/credit/multi-booking/ambiguous/payment-incomplete: no automatic Stripe refund, with a stable reason code and correct legacy/manual path;
- already locked/transferred: refund may remain eligible; planner supplies the original earning/share needed for a later obligation rather than blocking automatically.

The preview fingerprint includes contract ID, source identities, exact amounts, policy, cancellation timing, current outcome/refund/dispute state, and planner version. No list-price, current hourly-rate, or client-submitted fallback is accepted.

#### Replace target path in `api/_refund-executor.js`

- Lock booking/contract and validate the preview fingerprint.
- In one database transaction: cancel/release, persist refund intent and stable key, record command audit, then commit.
- Persist an attempt/state `submitting` before calling Stripe.
- Pass exact amount and stable idempotency key. Classify success, definite Stripe decline/invalid request, or ambiguity.
- On success, append existing `refund_events`/lines and any required payout obligation exactly once, then mark intent succeeded.
- On definite failure, mark `failed_confirmed`, alert admin, retain cancelled state, and show pending manual resolution.
- On ambiguity, mark reconciling and block new submissions until retrieval/webhook confirms the same refund.
- Never delete the intent/claim after an error.

Create `api/_refund-reconciler.js` for polling/webhook closure and `api/_refund-contracts.js` for transition/amount assertions. Keep `api/_refund-manual-bank.js`, incident repair, and operator runbook paths isolated for legacy/manual cases; do not let them masquerade as automatic success.

#### `api/admin.js` refund endpoints

- Keep preview/evidence inspection.
- Replace manual “execute” for an eligible learner/instructor launch action with status/retry-same-identity/reconcile controls.
- Restrict confirmed manual repair/clearance to named privileged roles, reason, evidence, and idempotent append-only commands.
- Return sanitized codes, never raw Stripe/SQL errors or account-existence details.

### 5.6 Agreement, earning, obligation, statement, and transfer modules

#### New `api/_payout-agreements.js`

Validate non-overlapping versions, acceptance, active-at-time selection, split snapshot, weekly fee-at-lock selection, and same-school Connect account ownership. Agreement edits create new versions; no in-place mutation after activation.

#### Replace target logic in `api/_payout-v2-earning-planner.js`

Keep a pure planner but implement the launch eligibility predicate exactly:

1. contract regime is launch and payment was created at/after cutover;
2. contract is complete, one payment/one lesson, and no contradictory evidence;
3. PaymentIntent/Charge succeeded, exact fee is known, and funds are available by planning time;
4. lesson ended and the current eligible outcome was recorded strictly before `lock_at`;
5. no prior earning claim, refund/planned refund, blocking issue, open/lost dispute ambiguity, or conflicting reschedule;
6. same-school active agreement and Connect recipient readiness are valid according to the agreed lock policy;
7. source is a whitelisted direct payment origin, never credit/goodwill/external cash/admin/manual/off-system.

Compute exact per-lesson allocation with one exported half-up integer function. Select every active agreement for a statement. Assess fee and dispute obligations independently, allocate oldest-first, and generate source-linked transfer plans. Return explicit exclusion reasons, canonical sorted inputs, totals, and fingerprint.

Retire target use of `api/_payout-v2-historical-import.js` and `api/_payout-v2-recovery.js`. They remain legacy/inactive and must be feature-gated away from launch rows.

#### Refactor `api/_payout-v2-materializer.js`

- Accept only an independently recomputed launch plan with matching fingerprint.
- Acquire the shared global finance lock plus school/run locks.
- Materialize run, all active-agreement batches (including zero), earnings/claims, franchise obligations, dispute obligations/applications, dispositions, statements, and transfer intents atomically.
- Verify conservation and protected-balance assertions in transaction.
- Never update/delete a locked financial row on subsequent calls; an exact replay returns the existing run.
- A first-live plan remains `approval_pending` until a separate named approval command records evidence. Approval never changes amounts.

#### Refactor `api/_payout-v2-transfer-executor.js`

Preserve its strongest contracts: intent before Stripe, stable identity/key, `source_transaction`, explicit `submitting/reconciling/transferred/failed`, and no new key after ambiguity. Extend it to:

- execute only locked, approved, transfer-due runs;
- acquire the shared finance lock and claim each plan safely;
- validate total allocations against each charge/source transaction and protected platform balance;
- allow multiple source-linked transfers inside one instructor statement while preserving statement total;
- record Stripe request IDs and Transfer IDs append-only;
- use the connected recipient account associated with the snapshotted agreement;
- describe success as transfer to Stripe, not bank arrival.

#### New `api/_payout-obligations.js` and `api/_payout-statements.js`

The first owns principal/application commands, oldest-first allocation, balance queries, manual repayment/clearance authority, and idempotency. The second renders a canonical, escaped statement model and persists delivery attempts. Neither recomputes historic rows from mutable instructor settings.

#### `api/_payout-email.js`

Replace legacy calculation/copy with statement rendering. Include service lines, gross/fee/net/split, obligation opening/new/applied/closing totals, transfer total/status, and “Transferred to Stripe” wording. Do not claim bank receipt or show a 1–2 day promise as a guarantee.

### 5.7 Runs, authority, admin endpoints, and protected balance

#### New `api/_financial-authority.js` or extend `api/_payout-v2-authority.js`

Define named capabilities separately:

- view financial readiness;
- approve first live run (Fraser only at launch);
- pause/resume launch;
- retry a confirmed transfer/refund failure using the same identity;
- record obligation repayment/clearance;
- view dispute evidence.

Ordinary admin auth is insufficient for mutation. Every command has school scope, command UUID, reason/evidence, actor, and append-only event.

#### `api/admin.js`

Add read endpoints for launch readiness, shadow differences, runs/batches/statements, Connect blockers, pending evidence/refunds, transfer reconciliation, obligations, issues, and disputes. Add narrow command endpoints for first-run approval, pause, same-identity retry/reconcile, evidence-pack generation, and privileged obligation actions.

Remove/disable the old `process-payout` mutation for a launch-live school. Legacy manual records remain readable and explicitly labelled pre-cutover. A school-scoped engine router—not date guesses in handlers—selects legacy/manual versus launch read/action behaviour.

#### Refactor `api/_payout-v2-protected-balance.js` and `api/_platform-balance.js`

Compute launch protected amount from exact outstanding automatic refunds, open dispute exposure borne by platform, locked/planned/in-flight transfers, and other expressly approved liabilities. Instructor obligations are not platform cash by themselves; only their application changes a payable transfer. Separate legacy credit/refund exposure visibly. The old coarse v1 30-day inflow/payout widget cannot authorize a transfer.

Keep `api/cron-balance-snapshot.js` only as labelled observability until replaced by the dispatcher. Alerts and diagnostics must be school-scoped and must not use hardcoded business thresholds as accounting rules.

### 5.8 Disputes

#### New `api/_stripe-disputes.js`

- Map verified Stripe events to the exact contract using charge/PI IDs.
- Store every event idempotently and derive monotonic current status.
- Block only unlocked affected earnings while a dispute is open.
- On win: close with no earning/obligation rewrite.
- On final loss: calculate the approved recovery amount, append one obligation, and leave processing/platform/dispute fees to the platform.
- If the dispute opens after a locked/transferred batch, do not mutate or withhold that batch.

#### New `api/_dispute-evidence.js`

Build immutable evidence-pack versions from booking, payment contract, outcomes, messages/notifications where lawfully retained, issue/refund history, and acceptance records. Sanitize learner/instructor PII in logs. Submission to Stripe remains manual for launch; record external submission reference and timestamps without claiming automated acceptance.

#### Admin notification path

On open/update/deadline/final result, persist a durable notification attempt and use existing email delivery. The scheduler emits missing-response reminders at three days and 24 hours before Stripe's deadline. Event replay must not resend the same logical notice.

## 6. Frontend implementation

Frontend changes consume server policy/read models; no browser code calculates refund values, eligibility, split, debt, or readiness.

### 6.1 Instructor portal

#### `public/shared/instructor-booking-actions.js`

- Replace the launch “not delivered” checkbox/action with an outcome dialog after lesson end: Delivered; Learner cancelled late/did not attend; Instructor did not deliver; Reschedule.
- Show the current revision and that it can be changed until the displayed Friday lock. Disable with an immutable statement link after lock.
- Reschedule selects a real same-instructor slot, shows that the original financial basis is preserved, and submits one command UUID. On success show email/SMS confirmation status without retrying the booking mutation.
- Do not show learner confirmation, admin override, or “automatic payment because it was on the calendar.”

#### `public/instructor/dashboard.js` / `.html`

- Add a 21:00 reminder inbox/count and unresolved ended lessons with lock cutoff.
- Connect card shows agreement, onboarding requirements, recipient capability, and readiness blockers separately.
- Do not display a stale one-way `onboarding_complete` result.

#### `public/instructor/earnings.js` / `.html`

- Replace live recomputation from current rates with server-returned immutable statements.
- Display each lesson's actual paid amount, Stripe fee, post-fee amount, split/share, obligation applications, weekly fee, carried balance, transfer amount, and status.
- Show £0 statements and distinguish `Locked`, `Transfer scheduled`, `Transferred to Stripe`, `Reconciling`, and `Transfer failed—under review`.
- Bank payout visibility, if shown, is a separate Stripe-reported status and never inferred from transfer age.

#### `public/instructor/profile.js` / onboarding files

- Use Accounts v2 hosted onboarding links and refresh status after return.
- Show agreement version/acceptance and Connect requirements. Do not allow frontend mutation of split/fee/account ownership.

### 6.2 Learner portal

#### `public/learner/lessons.js` / `.html`

- Cancellation preview shows exact gross, exact nonreturned Stripe fee, and net refund for 48h+ launch direct payments.
- Under 48h shows no refund and explains that the slot will be released; do not promise instructor payout or expose instructor accounting.
- Instructor non-delivery receipt states full original payment refund. Customer-facing timing is “typically 5–10 business days,” never a guarantee.
- Pending/failed/reconciling refund status uses neutral support copy and never invites a second cancellation/refund submission.
- Add the signed issue-report entry/acknowledgement. Do not reveal whether it blocked a payout and do not alert the instructor in the browser.
- Reschedule receipt confirms same instructor/replacement and immediate email/SMS dispatch.

#### `public/learner/book.js` / `.html`, `buy-credits.*`, offer acceptance pages

- Remove new credit purchase, repeat-weeks, Reserved Weekly Slot, and flexible/repeating offer entry points at the retirement activation gate.
- Keep existing credit balance/spend presentation and existing-series management; label it as existing credit, not new purchase availability.
- Direct checkout UI submits only selected lesson/instructor and an anti-replay command; price is rendered from a signed/server preview and recalculated server-side at Checkout creation.
- One-off offer acceptance must identify one lesson. Unsupported existing offer shapes remain legacy/manual and do not claim automatic payout/refund coverage.

### 6.3 Admin portal

#### `public/admin/portal.js` / `.html`

Replace the launch payout process button with read-only launch panels and narrow approved actions:

- readiness checklist for Fraser and Simon;
- immutable cutover and engine mode;
- agreement/onboarding/capability blockers;
- two shadow-Friday comparisons;
- first-run full totals and named approval;
- runs, £0 statements, transfer intents/reconciliation;
- pending/ambiguous/failed refunds;
- outstanding obligations and append-only manual repayment/clearance controls for authorized users;
- lesson issues and dispute deadlines/evidence packs.

Legacy payout/refund information remains under a clearly labelled “pre-cutover/manual history” section. No generic “mark paid,” “make eligible,” or edit-locked-batch control is added.

#### `public/admin/dashboard.js` / `.html`

Replace coarse balance permission signals with exact launch readiness/protected-balance summaries and links to evidence. Preserve alerts, but do not imply that a positive platform balance makes a specific transfer safe.

### 6.4 Accessibility, copy, and privacy acceptance

- All outcome/refund dialogs support keyboard focus, labelled fields, error summaries, and non-colour state indicators.
- Display currency from server minor units with the contract currency; do not assume GBP in reusable components, although launch configuration is GBP.
- Escape learner issue/evidence text and never render raw provider errors.
- Exact policy copy is covered by UI contract tests: “Transferred to Stripe,” 5–10 business days as an estimate, full/net refund breakdown, no bank-paid claim, and no learner payout-decision wording.

## 7. Scheduling and Europe/London timing

### 7.1 Vercel schedule

Add one hourly wake-up, recommended `0 * * * *`, to `vercel.json` for `/api/cron-financial-operations`. Keep each execution bounded below Vercel limits. During rollout, retain old cron definitions only while their mutation paths are explicitly engine-gated; remove the Friday 09:00 legacy payout cron before launch activation to eliminate double-pay risk.

### 7.2 New `api/cron-financial-operations.js`

- Authenticate only `CRON_SECRET`; an ordinary admin token cannot invoke the cron route.
- Acquire a short global dispatcher lease, enumerate due occurrences from database time-zone calculations, then run bounded jobs.
- Use Postgres `AT TIME ZONE 'Europe/London'` or an equivalently tested IANA-time-zone library to map local scheduled instants to UTC. Store both the local label/time zone and exact UTC occurrence.
- Daily at 21:00 local: email each instructor one digest of ended unresolved lessons that can still affect a future lock. No SMS.
- Friday at 12:00 local: calculate and atomically lock the run. Eligible outcome timestamps must be `< lock_at`; equality is conservatively next week.
- Friday at 14:00 local: submit locked/approved transfer plans. It never recalculates the noon batch.
- Periodically reconcile pending payment evidence, refund ambiguity, transfer ambiguity, and Stripe bank-payout evidence.
- Emit dispute response reminders at three days and 24 hours before the stored Stripe deadline.

### 7.3 DST and missed-run behaviour

- Noon, 14:00, and 21:00 are unambiguous local hours across UK DST changes, but their UTC value changes. Tests cover the March and October transition weeks.
- Generate occurrences by local calendar date first, then convert to UTC. Do not add seven 24-hour durations to the last UTC run.
- If Vercel wakes late, claim the persisted due occurrence once. A late noon lock uses its precomputed `lock_at`, so outcomes recorded after noon remain next-week even if the job ran at 12:07.
- A missed transfer occurrence may be caught up using the already locked plan and same transfer identities. A missed lock must alert and require the documented safe catch-up authority if the bounded automatic grace period is exceeded; it cannot use a later cutoff silently.
- A failed job releases only its lease, not immutable financial claims. Retries operate on the same occurrence and plan fingerprint.

### 7.4 Concurrency

Use a shared global advisory/lease identity such as `payout-v2-money-mutations` for cron and privileged admin money commands. Within it, take deterministic school/run/intent locks. The global lock prevents overlapping protected-balance decisions; row locks and idempotency retain correctness if a process dies. Read-only preview and status endpoints do not need the global lock.

## 8. Stripe integration plan

This section reflects official Stripe material available on 1 August 2026 and must be revalidated during the dependency slice.

### 8.1 Account model and onboarding

- Use Accounts v2 recipient configuration because CoachCarter is the platform merchant of record and uses separate charges and transfers.
- Request the recipient Stripe-balance transfers capability and set Accounts v2 dashboard access to Express, as approved in section 13.
- Use hosted onboarding through Accounts v2 Account Links with recipient configuration, refresh URL, return URL, and currently due/eventually due collection appropriate to the selected policy.
- A return redirect is not readiness. Retrieve current account/configuration/requirements and process the Accounts v2 events.
- Store account/context ownership before accepting events, and keep Fraser/Simon accounts school-scoped.

Official references: [Accounts v2 create](https://docs.stripe.com/api/v2/core/accounts/create), [Accounts v2 Account Links](https://docs.stripe.com/api/v2/core/account-links/create), [connected account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration), and [Accounts v2 event types](https://docs.stripe.com/api/v2/core/events/event-types).

### 8.2 Charges, transfers, refunds, and disputes

- Keep platform Checkout/PaymentIntents and create separate transfers only from locked instructor allocations.
- Set `source_transaction` to the exact platform Charge for each transfer. Stripe permits multiple transfers against a charge up to its transferable amount, which matches per-source allocations inside a weekly statement.
- Preserve one stable Stripe idempotency key per internal transfer/refund intent. Store intent/attempt before the request and reconcile uncertainty with the same identity.
- Funds availability is an explicit eligibility predicate derived from the relevant Stripe balance transaction; do not infer it from payment success alone.
- Refunding a separate charge does not automatically reverse its transfers. CoachCarter's ledger must execute the refund and, where the agreed policy permits, recover only through future instructor obligations; locked statements remain unchanged.
- For platform separate charges, the platform balance bears refunds and disputes. The protected-balance query must therefore cover these exposures.
- Use dynamic payment methods in Checkout unless a product rule or verified compatibility constraint requires a narrower set; never implement client-trusted method/amount logic.

Official references: [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), [Connect charge types](https://docs.stripe.com/connect/charges), and [Connect disputes](https://docs.stripe.com/connect/disputes).

### 8.3 Webhook topology

Provision and document three trust boundaries:

1. Platform payments/refunds/disputes/transfers endpoint and secret.
2. Accounts v2 thin events endpoint and secret/context retrieval.
3. Connected-account transfer/bank-payout events endpoint and secret/account context.

All endpoints verify signatures on raw bodies before parsing, record idempotent receipts, tolerate replay/out-of-order delivery, and quarantine unknown ownership. Secret rotation has an overlap procedure and never logs secrets or full sensitive payloads.

### 8.4 Keys and operational security

- Use restricted keys wherever the job's Stripe resource set supports it; document the minimal permissions for account onboarding, payment evidence, refunds, transfers, and reconciliation separately.
- Keep live/test keys and webhook secrets separate, rotate immediately if exposed, restrict access by environment, and ensure `.env*` remains uncommitted.
- Do not expose raw Stripe errors, request bodies, bank details, or account-existence signals. Store provider request IDs and sanitized codes for support.
- Stripe recommends least privilege and key rotation; implementation review must use the [official API key best-practices guidance](https://docs.stripe.com/keys-best-practices).

## 9. Reviewable PR sequence

Every slice below has an explicit inactive state and rollback. Do not merge multiple money-mutating slices merely to shorten the rollout. Each PR updates this plan's traceability/checklists and any affected runbook.

### 9.0 Immediate delivery sequence — Simon interim v1 hardening

Deliver one tightly scoped implementation PR (or a small dependency chain if review requires separation) covering:

1. **Account identity and onboarding safety:** durable intent before provider creation, stable ambiguity reconciliation, exact tenant/audit checks, deliberate `payouts_start_date`, paused-by-default state, and invitation separation.
2. **Funding-backed eligibility:** a reviewed source allowlist tied to exact CoachCarter Stripe receipt; reason-coded manual/£0 handling for every prohibited source class; no fallback estimates.
3. **Read-only Fraser preview:** exact lesson/source lines, gross, Stripe fees, current `weekly_franchise_fee_pence`, exclusions and proposed transfer from the same calculation used by the guarded path.
4. **Human-control boundary:** first-run approval distinct from onboarding and preview, safe pause on incomplete evidence, no unattended continuation, and documented manual handling for negative/insufficient weeks.
5. **Verification:** fault-injection around ambiguous account/transfer outcomes, tenant/auth/audit tests, start-date and pause tests, funding-origin truth table, preview conservation and explicit proof that v2 evidence is untouched.

All code remains unoperated until a later authority explicitly names the account/onboarding or payout action. The implementation PR must not create/match/map an account, send Simon an invite, unpause him, query production payout candidates, move money, run A8/A9 or change an engine/gate.

### 9.0a Superseded payout-v2 MVP delivery sequence (deferred)

The original MVP A-E sequence below is preserved as long-term history. It is no longer the immediate launch sequence.

The original Slices 0–13 remain the full-target backlog and historical traceability structure. For the approval-controlled MVP, use the following narrower sequence and do not treat deferred Slice 5/6/10/11 automation as launch blockers.

1. **MVP A — Connect completion and repeatable staging control.** Complete Simon's retained Accounts v2 reconciliation/onboarding/agreement work without replacement creation. Move the corrected deployment-URL-to-ID and present-false gate logic into a reviewed, locally self-tested operator controller. Keep all money, link, dashboard, agreement, webhook-processing and live gates disabled except for each separately approved minimal operation window.
2. **MVP B — Direct-slot contract and outcome eligibility.** Enable only direct single-slot contract evidence, explicit instructor outcomes, immutable same-contract rescheduling, and audited admin-visible manual holds. Other origins are deterministic manual/£0. No automatic refund, issue, reminder or dispute mutation is reachable.
3. **MVP C — Planner, obligations, statements and approval.** Implement/reconcile the launch planner around exact direct-slot evidence, post-fee split, Simon £90/Fraser £0 weekly obligations, carry-forward, protected cash, immutable statements and exact Fraser approval. Provide the minimum admin/instructor read surfaces needed to inspect evidence and blockers.
4. **MVP D — Durable movement and school-wide routing.** Adapt the existing durable transfer/reconciler to the MVP statements, use source-linked stable identities, add the privileged manual commands, and prove v1 hard-refusal for the cut-over school. No automatic scheduler invokes money mutation.
5. **MVP E — Shadow and controlled cutover.** Run and sign off two distinct shadow Fridays, rehearse pause/rollback and ambiguous outcomes, then conduct the cutover. Require Fraser approval and exact reconciliation on each of the first four live Friday runs. A separate docs/code/config review is required before unattended execution.

Each MVP item should remain one or more small PRs with its own inactive gate, focused database and fault-injection tests, rollback boundary and living-log handover. “MVP” changes scope, not review quality or mutation safety.

### Slice 0 — Stripe dependency and client boundary

**Scope:** pin/test a current Stripe SDK/API version; add `_stripe-clients.js`; preserve existing behaviour.  
**Files:** `package.json`, lockfile, new `api/_stripe-clients.js`, callers adapted mechanically, Stripe test fixtures.  
**Schema:** none.  
**Tests:** all existing payment/Checkout/webhook/refund/Connect/Payout v2 tests; client version, test/live separation, timeout, restricted-key selection, safe error classification.  
**Acceptance:** existing test behaviour is unchanged; API version is explicit; no global unversioned client; official version choice recorded.  
**Inactive:** no launch config/schema exists and all routes retain legacy engine behaviour.  
**Rollback:** revert dependency/client PR; no database or Stripe object compatibility dependency has been activated.

### Slice 1 — Inert schema foundation and integrity diagnostics

**Scope:** additive launch config, contracts, agreements, outcomes, refund intents, issues, obligations, runs/batches/statements, disputes, job occurrences, state observations, and constraints.  
**Files:** new migrations after 035, the repository bootstrap aggregate `db/migration.sql` if it mirrors current schema, pre/post diagnostics under `db/diagnostics/`, schema tests, rollout manifest/rehearsal docs.  
**Schema:** all section 4 tables; nullable existing-table links; no seed/cutover rows.  
**Tests:** migration from production-shaped fixture, tenant/FK/index/append-only/immutability/conservation/unique claim/over-application tests.  
**Acceptance:** pre/post counts and historic fingerprints match; zero launch rows; feature is disabled without application code.  
**Inactive:** no launch config row and no route writes new tables.  
**Rollback:** forward-only corrective migration if needed; because nothing writes the schema, application rollback is immediate and tables can remain unused.

### Slice 2 — Payment evidence and one-payment/one-lesson contracts

**Scope:** extend source writer; candidate identity; webhook materialization/reconciliation; launch origin whitelist; no payout.  
**Files:** `api/webhook.js`, `api/_payout-v2-source-writer.js`, new contract/reconcile modules, `api/slots.js`, `api/offers.js`, `api/cron-reconcile-payments.js`, related tests.  
**Schema:** use Slice 1 contract/source/link fields.  
**Tests:** direct slot, practical test-date checkout, one-off offer, captured request; replay/out-of-order; exact fee/availability; mismatched amount/currency/school; one-to-many; pre-cutover; missing fee; concurrent webhook; reschedule link.  
**Acceptance:** shadow/test payments form exactly one contract; contradictory/incomplete evidence cannot become complete; no historic backfill; no earning/transfer created.  
**Inactive:** writer is enabled only for test school/mode `shadow`; planner and transfers ignore contracts.  
**Rollback:** disable writer flag; evidence rows are immutable audit and can remain. Checkout metadata addition is harmless to legacy handlers.

### Slice 3 — Retire incompatible new products

**Scope:** disable new learner credit purchases, repeats, Reserved Weekly Slot creation, flexible/repeating offers; preserve existing balances/series.  
**Files:** `api/credits.js`, `api/slots.js`, `api/offers.js`, `public/learner/buy-credits.*`, `book.*`, offer pages, instructor/admin offer surfaces, docs/tests.  
**Schema:** none beyond optional school feature-state audit.  
**Tests:** creation APIs return stable retired response; hidden UI cannot be bypassed; existing credits spend/return; existing series/reserved rows remain manageable; all such lessons are £0 launch payout.  
**Acceptance:** no supported path creates a new multi-booking payment/credit purchase; legacy data is unchanged.  
**Inactive:** school-scoped retirement flag first tested in staging/shadow; do not flip production until product communication/readiness approval.  
**Rollback:** re-enable entry-point flag before cutover only; after cutover do not reintroduce shapes without a new product decision.

### Slice 4 — Accounts v2 onboarding and agreement readiness

**Scope:** Accounts v2 recipient creation/link/status, event endpoints, state observations, agreement version admin workflow.  
**Files:** `api/connect.js`, `_stripe-clients.js`, new webhook/connect/agreement modules, instructor onboarding/profile UI, admin readiness UI, `vercel.json`, tests/runbook.  
**Schema:** account state events and agreement versions.  
**Tests:** tenant/role isolation; deterministic ambiguous account creation; link refresh/return; event signature/context/replay/order; capability regression; agreement overlap/immutability; dashboard type.  
**Acceptance:** Fraser and Simon each have one correctly scoped test/staging account, current blockers are explainable, and no boolean can falsely preserve readiness.  
**Inactive:** production account creation behind named enablement; agreement/status cannot activate payouts.  
**Rollback:** disable v2 create/link routes and return to legacy onboarding UI; retain account/evidence rows; do not delete Stripe accounts.

**Interim disposition:** deferred. Preserve the retained test-mode Simon shell and all reconciliation evidence exactly; do not complete, replace, map or reuse it for the Production v1 identity. Slice 4 acceptance is not a prerequisite for the interim v1 account or first reviewed v1 payout.

### Slice 5 — Outcomes, rescheduling, issue reports, and reminders

**Scope:** outcome revisions, same-contract reschedule, admin impersonation audit, signed issue path, daily 21:00 digest.  
**Files:** `api/instructor.js`, `api/slots.js`, new `_lesson-outcomes.js`/`lesson-issues.js`, notification templates, shared instructor actions, learner lessons UI, dispatcher skeleton, tests.  
**Schema:** outcome, issue token/report/action, financial delivery/job rows.  
**Tests:** every outcome/revision/lock state; lesson-end boundary; same instructor/replacement/contract; concurrency; impersonation; token signature/expiry/replay/rate limit/GDPR; pre/post-noon issue; 21:00 London/DST/no-SMS.  
**Acceptance:** outcome writes are append-only, cannot revise locked lessons, and never by themselves create earnings; immediate reschedule email/SMS is idempotent.  
**Inactive:** collect only in shadow for post-cutover test contracts; legacy payout engine ignores outcomes.  
**Rollback:** hide outcome UI/disable write feature; retained revisions remain audit-only; legacy booking state is not rewritten.

**MVP disposition:** implement outcome revisions and same-contract rescheduling; replace issue-report and reminder automation with audited manual holds and defer their UI/delivery work.

### Slice 6 — Durable automatic refunds

**Scope:** exact refund planner, transactional cancellation/intent, Stripe executor, reconciliation, post-payout obligation hook, learner/admin UX.  
**Files:** `_refund-planner.js`, `_refund-executor.js`, new `_refund-contracts.js`/`_refund-reconciler.js`, `api/slots.js`, `api/instructor.js`, `api/admin.js`, `api/webhook.js`, learner/admin UI, emails/tests/runbook.  
**Schema:** refund intents/attempts plus links to existing refund ledger and obligations.  
**Tests:** 48h exact boundary; early net and instructor full refund; fee known/missing; pre-cutover/credit/multi-booking; paid/unpaid; success/definite failure/timeout/webhook reconciliation; same key; concurrent click; cancellation persists; school/auth; exact copy.  
**Acceptance:** no external call precedes the durable intent; an ambiguous call cannot create a second identity; exact existing ledgers close once on success; failure does not reopen the slot.  
**Inactive:** executor `shadow` writes previews/intents only with a fake/test Stripe adapter; production automatic submission is separately gated.  
**Rollback:** disable submission; preserve/reconcile all existing intents manually with same identities; never delete them or fall back to a second refund.

**MVP disposition:** deferred. Add only the classification/hold integration needed to prevent a refunded, refund-pending or ambiguous lesson from entering a batch. Continue using the existing reviewed operator refund procedure.

### Slice 7 — Launch earning, fee/debt, statement planner

**Scope:** pure target planner, agreement selection, split rounding, obligations/applications, £0 statements, protected balance preview.  
**Files:** `_payout-v2-earning-planner.js`, new agreement/obligation/statement modules, protected-balance modules, admin/instructor read models, tests.  
**Schema:** use run/batch/earning/disposition/obligation/statement rows but do not materialize production.  
**Tests:** complete eligibility truth table; £55/£1.03/90% = £48.57 instructor and £5.40 platform; rounding residuals; weekly £90/£0; no earnings/partial/full coverage; oldest/tie ordering; late confirmation roll; zero statement; prohibited source classes; exact conservation.  
**Acceptance:** canonical plan is deterministic under shuffled inputs/time injection; v1 and target are visibly separate; no £414 import/cap/Fraser-only logic remains in target.  
**Inactive:** preview/shadow reads only; no financial rows or Stripe calls.  
**Rollback:** disable target preview endpoint; no money state to undo.

### Slice 8 — Atomic Friday materialization and shadow comparison

**Scope:** financial dispatcher lock occurrence, target materializer, immutable first approval, two-model shadow report.  
**Files:** `_payout-v2-materializer.js`, `_payout-v2-shadow.js`, authority module, `cron-financial-operations.js`, `vercel.json`, admin readiness UI, diagnostics/tests/runbook.  
**Schema:** run/batch/earning/claims/obligations/dispositions/statements/job occurrences.  
**Tests:** serial/concurrent locks; exact noon cutoff; late job; DST; replay; all active agreements including £0; first approval; mutation rejection; shadow differences; shared cron/admin lock.  
**Acceptance:** two rehearsal Fridays can materialize immutable shadow evidence with zero transfer intents executable; target expected results are independently reviewed, not judged by matching incompatible v1 formulas.  
**Inactive:** mode `shadow`; transfer executor rejects all shadow runs; no production email statement unless explicitly marked preview.  
**Rollback:** pause scheduler/materializer; immutable shadow rows remain diagnostic and are excluded from live uniqueness by mode/version.

### Slice 9 — Source-linked transfers and reconciliation

**Scope:** adapt durable transfer executor, statement delivery, connected bank-payout read model, protected-balance hard gate.  
**Files:** `_payout-v2-transfer-executor.js`, `_payout-v2-webhook.js` or new endpoints, `_payout-email.js`, statement module, protected-balance modules, dispatcher/admin/instructor UI, tests/runbook.  
**Schema:** transfer intent/attempt allocation links and durable delivery evidence.  
**Tests:** one/multiple charges; source cap; one statement/multiple transfers; success; definite failure; timeout/ambiguous lookup; same key; crash between Stripe/DB; concurrent cron/admin; account mismatch; insufficient protected balance; copy/status.  
**Acceptance:** test-mode end-to-end moves only the planned amount to the correct recipient; no ambiguous plan is released; statement total equals transfer intents; bank status is separate.  
**Inactive:** executor allows Stripe test mode only and rejects production config until cutover authorization.  
**Rollback:** pause submissions; reconcile already submitting/ambiguous identities; locked amounts/claims remain and are not replanned.

### Slice 10 — Dispute lifecycle and future recovery

**Scope:** verified dispute events, planner block, evidence packs/manual response tracking, reminders, final-loss obligation.  
**Files:** `api/webhook.js`, new dispute modules, dispatcher, admin UI/email, planner/obligation modules, tests/runbook.  
**Schema:** disputes/events/evidence/notifications and obligation source link.  
**Tests:** replay/out-of-order; pre/post-lock; win/loss; partial loss rule; max original share; duplicate final event; deadline reminders; evidence hash; tenant/privacy; platform fee absorption.  
**Acceptance:** opening affects only an unlocked related lesson; terminal loss creates exactly one bounded obligation; locked statements never change; no automatic Stripe evidence submission.  
**Inactive:** event ingestion/evidence display may run in shadow; obligation creation gated until formula decision and launch mode.  
**Rollback:** disable derived action/notifications while preserving receipts; manually review any already-created obligation rather than delete it.

**MVP disposition:** deferred. Use a privileged manual hold/freeze and reviewed append-only correction process; no automated dispute obligation or reminder is required for beta launch.

### Slice 11 — Complete production UX, operations, and legacy separation

**Scope:** finish instructor/learner/admin read models and copy; engine router; legacy manual report; runbooks/alerts/GDPR.  
**Files:** section 6 frontend, `api/admin.js`, `api/instructor.js`, `api/learner.js`/`slots.js`, notification/GDPR handlers, docs and UI tests.  
**Schema:** only missing audit/delivery links found in rehearsal.  
**Tests:** role/school access; all exact copy; £0 statement; legacy vs launch records; disabled controls; export/anonymization; accessibility; raw error/PII leakage.  
**Acceptance:** users cannot reach old launch-incompatible mutations; every financial status has an evidence-backed read; pre-cutover/manual is unmistakable.  
**Inactive:** production screens are read-only/readiness until launch mode and cutover time.  
**Rollback:** route UI to legacy/read-only panels; backend money gates remain authoritative.

### Slice 12 — Two shadow Fridays and readiness sign-off

**Scope:** operate two complete shadow cycles using production evidence with no Stripe transfers; close discrepancies; rehearse pause/reconcile/incident paths.  
**Files:** no feature scope; only reviewed bug fixes, fixture/diagnostic updates, and signed readiness records.  
**Schema:** shadow/run evidence only.  
**Tests:** execute runbook, migration postflight, Connect capability refresh, source completeness, expected statements for both instructors, refund/transfer ambiguity game days, DST/calendar check.  
**Acceptance:** two consecutive Friday target plans are independently correct; no unresolved high-severity discrepancy; Fraser and Simon onboarding/agreements ready; named operator coverage and alerts verified.  
**Inactive:** mode remains `shadow`; old v1 payout is still the only active regime before cutover.  
**Rollback:** extend shadow period; do not schedule cutover.

### Slice 13 — Controlled cutover and first live batch

**Scope:** insert immutable cutover config, activate product retirements/contract writer/outcomes/refunds, disable legacy payout mutations, approve and execute first full run for Fraser and Simon.  
**Files:** reviewed configuration/operational command and runbook evidence only; no new feature code in cutover PR.  
**Schema/data:** approved agreement versions, account mappings, launch config/cutover; no historic contract, earning, or debt backfill.  
**Tests:** final production-readiness queries; pre/post-cutover synthetic payment classification; legacy manual report; first-run dry calculation; protected balance; exact approval/lock/transfer identities.  
**Acceptance:** post-cutover payments classify correctly; pre-cutover Simon/Laura/September remain manual; Friday run contains both instructors/full eligible values/£0 where dictated; Fraser approves fixed totals before lock; 14:00 executor reconciles every transfer; statements deliver.  
**Inactive before action:** `approval_pending`; transfer endpoint rejects until exact signed command.  
**Rollback/incident:** pause new submissions immediately, keep post-cutover classification and immutable rows, reconcile all submitting/ambiguous Stripe identities, use manual processing only under incident runbook. Never re-enable v1 for post-cutover payments or move the cutover timestamp.

## 10. Comprehensive test strategy

### 10.1 Unit and contract tests

- Integer money helpers: half-up split at <.5, exactly .5, >.5, zero, large safe bounds; platform remainder conservation; no float arithmetic.
- Time: exact 48-hour boundary, lesson end, `< noon` cutoff, equality, Friday windows, late confirmations, March/October Europe/London transitions, late cron wake-up.
- Regime: Stripe creation one millisecond before/at/after cutover; webhook and reschedule later; immutable result.
- Eligibility truth table: each required predicate independently absent/contradictory, plus valid combination.
- Source shape: direct slot, practical test-date checkout, one-off offer, captured request; credit, goodwill, external cash, manual/admin, flexible, recurring, one-to-many, zero/missing fee, unavailable funds.
- Outcome revision transition/actor/lock matrix and reschedule continuity.
- Refund policy/formula/state transitions/error classification/idempotency.
- Agreement active-at-payment and active-at-lock selection; overlap rejection; split/fee version separation.
- Obligation ordering, partial applications, manual repayment/clearance/reversal, duplicate source, no over-application.
- Dispute monotonic transition, recovery cap, evidence-pack fingerprint, notice deduplication.
- Canonical plan/statement fingerprints stable under input ordering and JSON property ordering.

### 10.2 Database integration tests

- Every tenant query/foreign key rejects cross-school instructor, learner, booking, contract, account, run, refund, issue, and dispute links.
- Append-only/immutability triggers reject UPDATE/DELETE on contracts after completion, outcome revisions, locked earnings/runs/statements, obligation principal/applications, attempts/events.
- Unique partial active-booking contract guard works during concurrent reschedules.
- Concurrent webhook creates one source/contract/booking and contradictory replay is quarantined.
- Concurrent outcome revision and Friday lock has one deterministic winner at exact locks.
- Concurrent cancel/refund commands create one intent; slot remains released under all outcomes.
- Materialization replays return the same run; two processes cannot claim one contract.
- Full money conservation at lesson, batch, source transfer, obligation, and run levels.
- Transfer/refund crash windows: before request, after request/before response persistence, after provider success/before DB closure.
- Scheduler occurrence uniqueness, lease expiry, bounded catch-up, and same occurrence retry.
- Migration pre/post checks preserve existing row counts/hashes and add no live target data.

Run integration tests with `CC_TEST_DB=1` and the repository's test database policy. Never point destructive fixtures at production or use real live-mode Stripe objects.

### 10.3 API/security tests

- Learner/instructor/admin/superadmin authorization and explicit impersonation; ordinary admin cannot approve, override, clear debt, or invoke cron.
- `school_id` is always auth-derived; forged query/body IDs and Stripe metadata cross-links fail closed.
- Webhook raw signature before parsing; wrong endpoint secret, connected context, replay, out-of-order, unknown account, contradictory event ID.
- Signed issue tokens: tamper, expiry, nonce replay, wrong learner/booking/school, rate limit, text sanitation.
- Server pricing and preview fingerprints reject modified amount, fee, split, timing, policy, currency, or stale state.
- No raw SQL/Stripe stack/account-existence leak; logs exclude tokens, keys, bank data, and unnecessary PII.
- Restricted key selection and missing/misconfigured key fail closed before mutation.

### 10.4 End-to-end business scenarios

1. £55 payment, £1.03 fee, 90% split: delivered, confirmed pre-noon, £48.57 instructor share and £5.40 platform remainder before weekly obligations.
2. Same numbers, Simon £90 fee: full £48.57 applies to oldest obligation, transfer £0, £41.43 fee balance carries; statement still sent.
3. Fraser £0 weekly fee: eligible share transfers in full after readiness/approval.
4. No lessons: Simon receives £0 statement and new £90 obligation; Fraser receives £0 statement and £0 new obligation.
5. Multiple lessons/charges in one statement: exact source-linked transfers sum to the statement and respect each charge limit.
6. Delivered confirmation after Friday noon: excluded this week and included next week unchanged.
7. Instructor revises delivered to non-delivery before lock: no earning, full refund. Same change after lock is rejected.
8. Learner cancels at 48h+: preview gross/fee/net, slot release, exact refund, no earning.
9. Learner cancels at 47:59:59: no refund; instructor later confirms late cancel/no-show; eligible at next lock.
10. Instructor cancels: full gross refund, platform absorbs fee, no earning.
11. Refund provider timeout: booking stays cancelled, intent reconciling, second click cannot create a new refund; webhook closes same intent.
12. Refund definite failure: cancelled slot stays open; status/manual alert; same identity only under approved reconciliation.
13. Reschedule: original and replacement share one contract; only replacement outcome can claim one earning; immediate email/SMS once.
14. Pre-noon signed issue: affected lesson blocked. Post-noon submission: locked batch unchanged.
15. Dispute before lock: blocked. Opening after transfer: statement unchanged. Win: no recovery. Final loss: bounded future obligation.
16. Accounts v2 capability regresses after onboarding: readiness becomes blocked; old true observation cannot override current state.
17. Transfer times out: plan reconciling, no new key/claim release; lookup finds the existing Transfer.
18. Simon Laura £55 pre-cutover and associated September/rescheduled booking: always £0 automatic and visible on manual legacy report.
19. Existing credit lesson delivered: spend/return ledgers behave as today and automated earning is £0.
20. Attempted new repeat/reserved/flexible checkout: UI absent and direct API rejects without creating Checkout.

### 10.5 Regression suites

At minimum keep green the existing tests covering:

- Payout v2 source ingestion, schema integrity, materialization, transfer executor, webhook, shadow, cutover, protected balance, and tenancy—updating assertions only where the product spec deliberately conflicts.
- Refund planner/executor/events/notes/manual-bank/incident readiness and cancellation BCS integrity.
- Slot/offer/request Checkout, effective pricing, list-price snapshots, school scoping, and webhook idempotency.
- Credit grant/spend/return/reconciliation, with new-purchase retirement and £0 payout assertions.
- Booking status, instructor non-delivery, reschedule credit-returned, repeats/reserved legacy preservation, auth, and UI contract tests.

Conflicting tests must be renamed/replaced with an explicit reference to the new product rule; never weaken them merely to pass. Especially remove target expectations for Fraser-only/£10 cap, historic £414 recovery, positive goodwill/external funding, commission-or-franchise, paid-out refund blocking, and Friday 09:00 UTC.

### 10.6 Operational verification

- Stripe test-mode account onboarding/capability event/retrieval.
- Test clocks or deterministic fixtures for Friday cycles; do not alter production time.
- Provider event replay and delivery-order permutations.
- Protected-balance reconciliation against Stripe platform balance and exact DB liabilities.
- Email rendering/delivery sandbox for instructor digest, reschedule, refund, statement, dispute alert/reminders/outcome.
- SMS sandbox only for reschedule; prove no daily-outcome SMS.
- Accessibility/browser checks on mobile and desktop for all altered portals.
- Load test bounded Friday plan/materialization and webhook storms with database locks/leases.

## 11. Rollout plan for Fraser and Simon

The immediate rollout is deliberately smaller than the payout-v2 phases below:

1. Merge and review the Simon interim v1 hardening with all external operations disabled.
2. Under later account/onboarding authority, create or reconcile one Production Express/v1 identity through the hardened route, set the deliberate start date, keep Simon paused and send an invitation only if that authority explicitly includes it.
3. Under separate payout-review authority, generate the read-only funding-backed preview while Simon remains paused. Fraser reviews every included/excluded lesson, exact Stripe evidence, fee, configured weekly fee and proposed transfer.
4. Only a further exact first-run approval may temporarily permit the reviewed transfer path. Missing or changed evidence stops and leaves Simon paused.
5. After reconciliation, return to or keep the paused human-controlled state. One success does not schedule or authorise another run.

Accounts v2 completion, the two shadow Fridays, controlled v2 cutover and first four v2 live-Friday approvals remain deferred long-term phases. The detailed phases below are preserved for that later work and do not govern the interim v1 rollout.

For the superseded approval-controlled payout-v2 MVP, the phase plan below was read with these overrides:

- test and shadow only the direct single-slot origin; other origins remain manual/£0;
- rehearse manual refund/issue/dispute holds rather than their deferred automatic executors;
- use privileged manual commands for the Friday-noon plan and intended 14:00 transfer window; do not enable the hourly financial mutation dispatcher;
- retain two independently accepted shadow Fridays;
- require Fraser's exact approval, post-transfer reconciliation and signed review for each of the first four live Fridays; and
- do not enter Phase E automatic execution without a separate owner decision, implementation review, regression run and gate change.

### Phase A — Foundation and test-mode evidence

1. Treat the merged inactive foundation through Slice 4 as the baseline; do not replay or replace completed schema/client/Accounts v2 work.
2. Rehearse additive migrations and verify existing accounting hashes/row counts.
3. Configure test-mode Accounts v2 recipients and agreement versions for Fraser and Simon. Confirm dashboard decision and hosted onboarding.
4. Exercise one supported direct payment per origin and every ineligible source shape. Verify exact fee and availability evidence.
5. Merge product retirement, outcomes, refunds, planner, transfers, and disputes only behind their stated gates.

### Phase B — Production onboarding and shadow

1. Create/map the production Accounts v2 recipients using approved idempotent commands; never delete/recreate on uncertainty.
2. Complete hosted onboarding and signed agreement acceptance. Record Simon £90 and Fraser £0 in active agreement versions; record the approved split basis points rather than relying on current instructor columns.
3. Refresh current requirements/capabilities immediately before each readiness review.
4. Select and record the immutable cutover timestamp only after two shadow Fridays pass. Shadow planning may model a proposed boundary, but no production payment is classified launch until the real config exists.
5. Run two consecutive Friday shadow cycles. Independently calculate expected target statements from exact source/outcome/agreement evidence. V1 results are contextual and may legitimately differ.
6. Rehearse refund/transfer timeout, global pause, missed noon job, issue-before-lock, dispute, and secret/key rotation procedures.

### Phase C — Cutover

1. Freeze unrelated payment/refund/payout deployments for the cutover window.
2. Run readiness diagnostics: migrations, config, exact account ownership, current capabilities/requirements, agreements, protected balance, pending/ambiguous Stripe operations, scheduled occurrences, alerts/operator coverage.
3. Insert/activate one immutable school cutover; enable post-cutover contract/outcome/refund rules and incompatible-product retirement.
4. Disable `api/cron-payouts.js` and old admin payout mutation for the school before any post-cutover payment can be considered. Keep legacy manual report and records.
5. Verify synthetic/test-mode boundary classification and a real low-risk post-cutover production payment's evidence without manufacturing an earning.
6. Monitor payment evidence completeness, outcome reminders, refund intents, issues, disputes, and current Connect readiness continuously through first Friday.

### Phase D — First live Friday

1. Before noon, produce a frozen readiness report for both Fraser and Simon, all eligible lesson/source evidence, outstanding obligations, protected balance, and exact proposed totals.
2. Fraser reviews and records the named approval against the exact run fingerprint. There is no £10 cap and no Fraser-only batch.
3. At Friday noon London, materialize both active-agreement statements atomically. Any unresolved blocker pauses the run; it does not partially improvise eligibility.
4. Between noon and 14:00, reconcile locked totals, transfer source caps, Connect readiness, and platform protected balance. Do not change statement contents.
5. At 14:00, submit stable source-linked transfers. Reconcile every success/definite failure/ambiguity. Report “Transferred to Stripe” only for created/reconciled Transfers.
6. Send every statement, including £0, and verify durable delivery attempts. Bank arrival remains Stripe-reported evidence, not an assumption.
7. Keep Simon in approval-controlled mode until his onboarding/agreement/first-run conditions are all completed; a blocker yields a £0/held state according to the finalized lock policy, never an unsafe transfer.

### Phase E — Post-first-run automation

Phase E is deferred from the MVP. Success of the first run does not enable automatic Friday execution. Complete four Fraser-approved, exactly reconciled live Fridays first. A later PR and operational approval must demonstrate the scheduler, alert coverage, deferred incident automation and gate transition before unattended execution can be enabled.

### Pause and rollback principles

- The safe operational rollback is **pause new Stripe mutations**, not delete ledgers, move cutover, unclaim earnings, or run v1 against post-cutover payments.
- Continue webhook receipt and reconciliation while submissions are paused; otherwise ambiguity grows.
- Pre-cutover remains manual; post-cutover remains under the launch regime even during an incident.
- A locked batch is never recalculated. Corrective economics use future append-only obligations/adjustments under explicit authority.
- If Connect capability regresses, stop affected new transfers, retain claims/statements, and reconcile capability. Do not redirect to a different account without a new approved agreement/account mapping.

## 12. Product-rule traceability checklist

Immediate interim-v1 traceability:

| Product rule | Implementation location | Primary acceptance evidence |
|---|---|---|
| One recoverable v1 identity, no duplicate after ambiguity | hardened `api/connect.js` command/intent/reconciler | timeout/crash/retry fault-injection and one-identity assertion |
| Tenant scope and complete audit | Connect account/invite/start/pause commands | cross-school rejection and audit contract tests |
| Deliberate start date and paused default | onboarding transaction/readiness guard | historic-backlog exclusion and `payouts_paused=true` tests |
| `chargeable` plus exact approved funding | hardened v1 eligibility classifier | source-origin truth table and missing/contradictory evidence tests |
| £90 comes from configuration, not code | `weekly_franchise_fee_pence` read | changed-config preview/calculation test and no Simon constant |
| Fraser read-only preview and first-run approval | admin preview plus guarded mutation boundary | exact-line conservation, stale-fingerprint and no-unattended-run tests |
| Three-state/48-hour rule, no routine confirmation | existing booking lifecycle and `mark-not-delivered` | regression proving no new outcome prompt/ledger dependency |
| Preserve v2 shell/A8 evidence | no writes to v2 identity/evidence tables | zero-delta assertion in focused tests and rollout review |

The table below is the preserved long-term payout-v2 traceability matrix.

| Product rule | Implementation location | Primary acceptance evidence |
|---|---|---|
| Payment creation timestamp controls forever | launch config + payment contract creation | before/at/after cutover and reschedule tests |
| Pre-cutover Simon/Laura/September manual | no backfill + legacy report | named end-to-end scenario and cutover diagnostic |
| Exactly one Stripe payment to one lesson | contract/source unique constraints + webhook | one-to-many rejection/concurrency tests |
| Exact price/fee/funds available | contract evidence + source writer | missing/contradictory/availability tests |
| Direct slot/test-date/one-off/captured request only | origin whitelist in Checkout/webhook/planner | origin truth table |
| New credits/repeats/reserved retired | APIs and UI feature activation | bypass and legacy-preservation tests |
| Existing credits £0 automated | no contract/eligibility source | credit spend/return + £0 test |
| Instructor outcome required/revisable until lock | outcome revisions + materializer locks | transition/race tests |
| No learner approval/admin override | endpoint/authority/UI absence | authorization/UI contracts |
| Daily 21:00 email, no SMS | financial dispatcher + template | London/DST/dedup/channel tests |
| Same-instructor real reschedule, same basis | shared reschedule command/unique active link | concurrency/contract continuity test |
| Immediate reschedule email/SMS and issue link | notification outbox/delivery | once-only delivery test |
| 48h+ net refund | exact refund planner | gross/fee/net boundary test |
| Under 48h no refund/payable outcome | cancellation + later outcome | 47:59:59 scenario |
| Instructor non-delivery full refund/platform fee | refund planner/contract | full-gross/no-earning test |
| Stable refund identity and ambiguity reconcile | intent/attempt state machine | crash/timeout/webhook test |
| `(gross-fee) × split`, integer pence | planner money helper | £55 example and rounding suite |
| Split snapshot at payment | agreement + contract | agreement-change-after-payment test |
| Fee at Friday lock | agreement version + obligation | effective-boundary test |
| Friday noon immutable lock/14:00 transfer | occurrence/run/executor | DST/late-job/no-recalc test |
| Active-agreement £0 statements | batch/statement materialization | no-lesson/full-debt cases |
| Full weekly fee/debt/oldest first/tie rule | obligation ledgers | allocation-order suite |
| Manual repayment/clearance append-only | obligation applications/authority | immutability/auth/idempotency tests |
| First batch both/full/Fraser approval | run approval contract | first-run end-to-end test |
| Durable transfer plan/source/key/lock | transfer executor + global authority | concurrency/ambiguity/source cap tests |
| “Transferred to Stripe,” not bank paid | statement/read model | exact-copy contract tests |
| Signed rate-limited issue cutoff | issue token/report | security and pre/post-noon tests |
| Disputes pre-lock block/post-lock no withholding | dispute state + planner | event timing suite |
| Win no change/loss capped future recovery | obligation source | terminal dispute tests |
| Manual dispute evidence and reminders | evidence versions + dispatcher | 3-day/24h/dedup tests |
| Accounts v2/hosted onboarding/restricted keys | Connect/client/webhook slices | API contract/security tests |
| Two shadow Fridays | shadow runs/readiness record | signed rehearsal evidence |
| No historic debt/import/cap | inactive legacy modules/new cutover | zero-import diagnostic/target tests |

## 13. Owner decisions

The first four implementation-planning questions were settled on 1 August 2026. The MVP launch decision was settled on 11 August 2026. They must not be reopened by later slices unless Fraser explicitly changes the product policy.

### Decision 1 — Partial dispute-loss recovery: proportional

For a partial final dispute loss, recover the half-up rounded proportional part of the instructor's original share:

```text
min(
  original instructor share,
  round_half_up(original instructor share × final disputed principal lost ÷ original gross payment)
)
```

The platform absorbs its proportional share, the original processing-fee impact, all Stripe dispute fees, and any remainder. A 50% loss on an original £48.57 instructor share therefore creates a £24.29 obligation.

### Decision 2 — Practical test-date checkout: eligible

The existing practical test-date direct checkout is an approved launch origin under `test_date_direct` when it proves the same one-payment-to-one-90-minute-lesson contract and every normal payment, fee, cutover, outcome, school and availability predicate. Failure to prove that contract makes the individual payment ineligible/manual; it does not enable a fallback value.

### Decision 3 — Instructor Stripe dashboard: Express

New Simon and future-instructor Accounts v2 recipient configurations use Express dashboard access, subject to Stripe's pinned API accepting the reviewed UK recipient configuration. A different dashboard mode is not an automatic fallback; it blocks readiness until reviewed.

### Decision 4 — Connect temporarily not ready: held payable

At Friday lock, an otherwise valid earning is calculated and locked even if that instructor's connected account is temporarily unable to receive a transfer. The instructor receives a £0 transfer statement showing the explicit `held_connect_not_ready` amount, while ready instructors continue normally.

The held amount remains a protected platform liability. Once readiness is proven, a later run releases the original locked amount without repricing, mutating the locked statement or requiring lesson reconfirmation. It is never treated as franchise debt, platform revenue or forfeited earnings.

### Decision 5 — Superseded payout-v2 MVP before full automation

On 11 August 2026 the direction was to keep the new Accounts v2/source-backed system and launch a narrow beta rather than putting Simon onto the legacy engine. That sequencing decision is preserved historically but was explicitly superseded on 13 August 2026 by Decision 6. Its architecture remains the long-term target.

### Decision 6 — Hardened interim v1 for Simon

Keep CoachCarter school-wide on v1 and make the next implementation a focused Simon interim-v1 hardening. Simon may be onboarded through one recoverable, tenant-scoped, audit-logged Express/v1 identity and initially paid only through a paused-by-default, exact-funding, Fraser-reviewed path. Accounts v2/payout v2, A8/A9, two shadow Fridays, v2 cutover and four v2 live approvals remain deferred and are not interim prerequisites. The retained v2 test identity/evidence is preserved and cannot become the Production v1 identity. Account onboarding, first reviewed payout and unattended future payouts require separate authority.

## 14. Recommended starting point

Start from frozen merged PR #387 at `4a6ba4fafbebe167b113e61e80b0c0a711da3ccf` and implement **Simon interim v1 hardening**. Do not resume MVP A, A8, A9, Accounts v2 reconciliation or onboarding as the next milestone.

The first PR should harden account identity/ambiguity recovery, tenant/audit controls, deliberate start/pause state, exact Stripe-funded v1 eligibility, the itemised Fraser preview and the first-run authority boundary. It must include focused tests and remain unoperated. Do not create an account, send an invite, inspect production candidates, unpause Simon, transfer money, change an engine/gate or modify the retained v2 evidence under this plan.
