# Franchise Pre-Signing Payout Rehearsal — 2026-05-10

**Plan ref:** `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md` item 1.7
**Spec:** `docs/franchise/spec-1.7-rehearsal-checklist.md`
**Outcome:** ✅ pre-signing-day payout stack passes end-to-end. Two minor findings worth flagging before instructor #2 starts. Both small.

---

## Setup verified

| Layer | State |
|---|---|
| Stripe mode | TEST mode (`sk_test_…`, sandbox banner shown) |
| Stripe webhook secret | TEST mode (`whsec_…` from new test endpoint, **NOT prod**) |
| Postgres | Neon branch `rehearsal-1-7` (host `ep-delicate-shadow-abcpe05o`), forked from prod 2026-05-10 07:38 BST. Auto-deletes 2026-05-13. |
| Stripe Connect account | Test Express account `acct_1TVRcPEtWstlRCkh` ("Test Instructor"), capabilities: Transfers, Payouts. Status: Enabled. |
| Test instructor in DB | `instructors.id = 16`, `weekly_franchise_fee_pence = 19500` (Full Franchise — triggers week-1 deposit path) |
| Stripe platform balance | Topped up to £100 GBP via "Add funds" (test mode only) |
| Migration state | 1.3+2.10 columns hand-applied to branch (was missing — see Finding 1) |

---

## Phase A — Week 1 worst case (1 booking, £82.50 revenue)

**Inserted:** 1 completed booking (Standard, £82.50, dated 5 days ago).

**Helper return:**
```json
{
  "amount_pence": 0,
  "lesson_count": 1,
  "shortfall_pence": 36250,
  "deposit_deducted_pence": 0,
  "prior_shortfall_recovered_pence": 0,
  "status": "completed"
}
```

**Hand-computed expectation:** revenue (£82.50) < fee+deposit (£195+£250 = £445), so payout is £0. The fee is partially covered (£82.50 of £195), the deposit is entirely uncovered (£0 of £250), and the rest rolls into shortfall: £112.50 + £250 = **£362.50 shortfall**.

**Match:** ✅ exactly.

**DB persisted:**
| field | value | check |
|---|---|---|
| `amount_pence` | 0 | ✅ |
| `franchise_fee_pence` | 8250 | ✅ actual fee deducted (capped at gross) |
| `shortfall_pence` | 36250 | ✅ £362.50 carried |
| `shortfall_recovered_from_payout_id` | NULL | ✅ first week, nothing to recover |
| `deposit_deducted_pence` | 0 | ✅ none collectable |
| `stripe_transfer_id` | NULL | ✅ Stripe correctly skipped (would have rejected amount=0) |
| `status` | `completed` | ✅ marked completed despite no transfer (so week-2 detects this as "not week 1 anymore") |
| `payout_line_items` | 1 row, `instructor_amount_pence = 0` | ✅ booking marked paid → not re-picked next run |

---

## Phase A2 — Week 2 recovery (7 bookings, £577.50 revenue)

**Inserted:** 7 completed bookings (Standard × 7, dated 2 days ago).

**Hand-computed expectation:** revenue £577.50 ≥ fee+priorShortfall (£195+£362.50 = £557.50) → £20 to instructor, prior shortfall fully recovered, no new shortfall. No deposit (not week 1).

**First attempt result:** ✅ maths perfect, ❌ Stripe transfer FAILED with "insufficient available funds" → caught Finding 2.

**After topping up Stripe test balance to £100 and retrying:**
```json
{
  "amount_pence": 2000,
  "lesson_count": 7,
  "shortfall_pence": 0,
  "deposit_deducted_pence": 0,
  "prior_shortfall_recovered_pence": 36250,
  "transfer_id": "tr_1TVRqcIqhTSdZedS4HrfqIKZ",
  "status": "completed"
}
```

**DB persisted:**
| field | value | check |
|---|---|---|
| Payout id=1 (week 1) `shortfall_recovered_from_payout_id` | **3** | ✅ recovery linkage applied to the recovering payout |
| Payout id=2 (failed retry) `status` | `failed` | ✅ rollback worked — line items deleted, prior shortfall NOT marked recovered |
| Payout id=3 (week 2) `amount_pence` | 2000 | ✅ £20.00 to instructor |
| Payout id=3 `transfer_id` | `tr_1TVRqc…` | ✅ real Stripe transfer fired |
| `payout_line_items` total | 8 (1 + 7) | ✅ all bookings attributed |

---

## Findings

### Finding 1 — Migration must run BEFORE deploy of 1.3+2.10 code goes live (POLICY, not bug) 🟡

**What happened:** The Neon branch was forked from prod *before* we ran the 1.3+2.10 migration. First helper invocation crashed with `column "shortfall_pence" does not exist`. Hand-applied the same SQL from `db/migration.sql` to the branch and proceeded.

**Production impact:** If the 1.3+2.10 deploy goes live without anyone calling `GET /api/migrate?secret=…` afterwards, the **next Friday cron at 09:00 UTC will crash with this same error for every instructor**. Email alerts via `_error-alert.js` will fire but no payouts will go out.

**Fix:** No code change needed. Add the migration step to the deploy checklist for whoever ships this. Or — automate by calling the migrate endpoint as a Vercel build hook.

**Tier assignment:** No tier — operational practice, not a code item. **Action: append a "post-deploy" line to the next-session memory and the FRANCHISE-PLAN-OF-ACTION pre-deploy reminder so it's the first thing future-Fraser checks before the first instructor #2 payout cycle.**

### Finding 2 — Stripe platform balance must be ≥ instructor payout amount (POLICY discovery, not bug) 🟡

**What happened:** Phase A2's first attempt failed with `insufficient available funds`. The platform Stripe account had £0 balance in test mode. The transfer of £20 to the connected instructor account couldn't fire.

**Production impact:** **Should be a non-issue in live mode** — your platform balance is continuously fed by real card/Klarna payments coming in throughout the week, and at 09:00 Friday you'd typically have the entire week's gross sitting in the Stripe balance ready for transfer. But there's an edge case: if all that week's payments are still in **pending** status (Stripe holds funds for ~1-2 days for first-time customers, refund-prone activity, etc.), available balance might be lower than expected. With multiple instructors, this edge case compounds — you'd transfer to one instructor successfully then fail on the second.

**Fix opportunity:** Could add a balance pre-check at the top of `processAllPayouts` — refuse to start if `stripe.balance.retrieve().available[GBP] < sum(estimated payouts)`. Surfaces the issue cleanly instead of partial fan-out where some instructors get paid and others don't.

**Tier assignment:** **Tier 3 / new plan item.** Suggest plan item `3.10 — pre-payout Stripe balance check` to be addressed when adding the second instructor (currently a one-instructor system, so the partial-fan-out concern doesn't bite).

### Finding 3 — `platform_fee_pence` semantics in zero-payout case (LOW PRIORITY) 🔵

**What:** In the £0-payout case, `platform_fee_pence` is `gross - amount = 8250 - 0 = 8250` — i.e. it represents *the entire revenue* not *the platform's fee slice*. The actual fee deducted lives in `franchise_fee_pence` (also 8250 in this case). They're the same number this week but the semantics drift in mixed cases (where deposit + shortfall are also in the deduction stack).

**Impact:** Reporting only. The cron and helpers themselves don't read `platform_fee_pence`. Only matters for human inspection of `instructor_payouts` rows.

**Fix opportunity:** Either rename the column to `total_deducted_pence`, or restrict its meaning. Or just document.

**Tier assignment:** Tier 4. Doesn't bite anyone today. Worth surfacing only if a future audit query depends on this column.

### Things that work — confirm they can wait

- **Stripe-fee passthrough (B3.4)** — confirmed deferred. The £20 transfer here would normally have ~£0.50 Stripe fee deducted from the platform balance. In the current code, instructor gets £20 and CCL absorbs the £0.50. Per agreement, this should pass through to the instructor (£19.50 to instructor, £0.50 fee). Tier 3, defer to month 2 of instructor #2's operation as planned.
- **Statement itemisation (B3.5)** — confirmed deferred. The "Weekly Statement" email body would normally itemise: gross / franchise fee / Stripe fee / deposit / shortfall / recovered. Currently shows summary only (with conditional sub-lines for deposit/shortfall/recovery from this rehearsal's code). Tier 3, defer.
- **`list_price_pence` snapshot (B3.3)** — confirmed deferred. The helper currently does live `lesson_types.price_pence` lookup which is fine until prices change. Tier 3, defer until Phase 1 schema migration.
- **Instructor email statement** — not exercised in this rehearsal. The cron's email send happens in `cron-payouts.js`, not in `processPayoutForInstructor`. The new sub-line code lives there but wasn't fired because we called the helper directly. **Worth re-rehearsing** by hitting the actual cron endpoint with admin auth, just to verify the email template renders correctly with the new fields.

---

## Acceptance criteria check

- [x] A test payout has been triggered and observed end-to-end (DB row + Stripe Dashboard + helper return).
- [x] You've walked through the projection's worst-case week-1 scenario and seen actual platform behaviour (£0 / £362.50 shortfall / no deposit deducted).
- [x] You've catalogued every gap between agreement commitments and code (Finding 1, 2, 3 + confirmation that Tier 3 items can wait).
- [x] Each gap mapped: Finding 1 = operational checklist, Finding 2 = new plan item 3.10, Finding 3 = Tier 4.
- [x] Zero real money moved (verified: test mode throughout, transfer id `tr_1TVRqc…` is a test transfer).
- [x] Cleanup SQL ready (below).

---

## Cleanup SQL (to re-run rehearsal from clean state)

Run against the rehearsal branch (or, after rotating to a fresh branch, ignore — branch deletion is the cleanup).

```sql
-- Remove the test instructor's bookings, line items, and payouts
DELETE FROM payout_line_items
 WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE instructor_id = 16);
DELETE FROM instructor_payouts WHERE instructor_id = 16;
DELETE FROM lesson_bookings WHERE instructor_id = 16;
DELETE FROM instructors WHERE id = 16;
```

The Connect Express account in Stripe (`acct_1TVRcPEtWstlRCkh`) can be deleted from the Stripe Dashboard (Connect → Accounts → ... menu → Reject/Remove) or left to expire.

---

## Recommended actions

1. **Add a pre-deploy reminder** for whoever ships the 1.3+2.10 code: run `GET /api/migrate?secret=$MIGRATION_SECRET` immediately after deploy. Update `FRANCHISE-PLAN-OF-ACTION-2026-05-09.md` and the next-session memory.
2. **Add new plan item `3.10 — pre-payout Stripe balance check`** to Tier 3 of the action plan. Triggers when adding instructor #3 (multi-instructor amplifies partial-fan-out risk).
3. **Re-rehearse the email path** — hit the actual `cron-payouts.js` endpoint via curl (with admin auth) to confirm the statement email body renders correctly with deposit/shortfall/recovery lines. Trivial; ~15 min.
4. **Restore `.env.local` to production values** — comment out the rehearsal lines, uncomment the originals. Done before next dev session.
5. **Rotate exposed credentials** (separate from this rehearsal but listed for completeness):
   - Neon `neondb_owner` password
   - Stripe live secret + webhook secret (and ALL OTHER LIVE SECRETS that were exposed in this session's transcript: Resend, Setmore, Anthropic, Cloudflare, Twilio, SMTP, Google ×3, getAddress, OpenRouteService, ADMIN_SECRET, MIGRATION_SECRET, JWT_SECRET, CRON_SECRET).
6. **Delete Neon branch `rehearsal-1-7`** when done (auto-expires 2026-05-13 anyway, so optional).

---

## What this rehearsal did NOT do (intentional gaps)

Per spec section "What this rehearsal does NOT do":
- Did not test Phase 2A per-instructor credit scoping (Phase 1 schema not shipped).
- Did not test consent flow / content-licensing economics.
- Did not test Lead Floor rebate calculations.
- Did not test offer-based recurring-series booking against new shortfall logic — separate edge-case rehearsal worth doing post-Phase 1.

Plus the email-body rehearsal noted in Finding 3, which is a 15-min follow-up.

---

## Bottom line

✅ **Pre-signing-day Tier 1 is complete.** The shortfall + deposit logic shipped in commit `d0452ea` works exactly as specified through both happy path and recovery. No code changes needed before signing day; one operational checklist item (run migration) and one new Tier 3 plan item (balance pre-check). Free to send the agreement to the solicitor and proceed with planning instructor #2's start date.
