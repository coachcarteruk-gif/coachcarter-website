# Handover — Free Trial Self-Serve Booking (2026-04-26)

> Read this before resuming any free-trial / homepage CTA / booking-system work.
> Self-contained — assumes the next session has zero memory of this one.

## What shipped today

Branch `free-trial-self-serve` → PR [#102](https://github.com/coachcarteruk-gif/coachcarter-website/pull/102), 6 commits.

| Commit | Summary |
|---|---|
| `b58faf6` | Backend: new `book-free-trial` action on `/api/slots` |
| `cea5a6c` | Backend: `'trial'` slug added to `validSlugs` in `instructor.js` |
| `30fa493` | Frontend: `/free-trial.html`, `/free-trial.js`, `/free-trial-success.html` |
| `b060b16` | Fix: C1 guard normalises phone to both `07xxx` and `+447xxx` |
| `ef0d860` | Homepage: dual hero CTA + final CTA repointed at `/free-trial.html` |
| `571d112` | Docs: roadmap 2.84 + PROJECT.md updates |

**The PR is open but not merged.** The frontend pages are not yet served on production until Fraser merges. However, the DB changes ARE already live (see "DB state" below).

## What the feature does

Anyone can visit `/free-trial.html`, pick a free 60-minute slot from any opted-in instructor, fill in name/email/phone/pickup, and get a confirmed booking — no Stripe, no payment, no account creation step. They receive a confirmation email containing a 7-day magic-link to sign in and manage the booking. The instructor receives an email + (best-effort) WhatsApp.

### Flow at a glance

```
/free-trial.html
  ↓ (slot picker fetches /api/slots?action=available&lesson_type_id=37)
  ↓ user picks slot, fills form
  ↓ POST /api/slots?action=book-free-trial
       ↓
       1. validate inputs
       2. rate-limit (10/IP/hr, 3/phone/hr)
       3. resolve trial lesson type (active=true, slug='trial', school 1)
       4. one-trial guard: email OR phone (any status)
       5. slot conflict checks
       6. find-or-create learner (phone collision → insert without phone)
       7. INSERT lesson_bookings (payment_method='free', minutes_deducted=0)
       8. generate magic-link token, INSERT magic_link_tokens (7-day expiry)
       9. send learner email (with magic-link button) + instructor email
       10. fire-and-forget WhatsApp to both
       ← return { ok:true, redirect_url:'/free-trial-success.html' }
  ↓ (NO session cookie set)
/free-trial-success.html (static page)
  ↓ user clicks magic-link in email
/learner/login.html?token=XXX
  ↓ verifies token, sets cc_learner cookie, redirects
/learner/  (logged in to existing or newly created learner_users row)
```

## DB state — already live in production

These changes were applied directly during the build session, BEFORE the PR was opened. They affect production today.

```sql
-- Activated Free Trial lesson type (was active=false, no public page used it)
UPDATE lesson_types SET active = true WHERE slug = 'trial' AND school_id = 1;
-- (Type id 37, name 'Free Trial', duration 60 min, price_pence 0)

-- Opted Fraser (id 4) into the trial type (was ["standard","2hr"])
UPDATE instructors SET offered_lesson_types = '["standard","2hr","trial"]'::jsonb WHERE id = 4;

-- Simon Edwards (id 6) intentionally left NULL — Fraser confirmed Simon already
-- opted in via prior conversation. NULL = "all standard slugs" includes trial.
-- Demo Instructor (id 5) is NULL but excluded everywhere by email match.
```

**Rollback path for the DB changes:**
```sql
UPDATE lesson_types SET active = false WHERE slug = 'trial' AND school_id = 1;
UPDATE instructors SET offered_lesson_types = '["standard","2hr"]'::jsonb WHERE id = 4;
```

If the PR is reverted but the DB changes are not, the trial type will surface in the slot picker at `/learner/book.html` for any logged-in learner, but no payment path can charge for it (Stripe rejects £0 line items). It's safe-by-failure but UX-confusing.

## Architecture decisions worth knowing

### Why no session cookie on booking?

The `handleFreeOffer` flow in `api/offers.js` sets a session cookie because it has token-gated trust — the offer was created by an instructor and only that token-holder can accept it. Self-serve has no equivalent token. Setting a cookie on free-trial booking would let anyone create an account and log in as any email by submitting the form. So we send a magic-link instead. First session = one click after the email arrives.

This was Concern C4 from `/scientific-critical-thinking` review. Was a deliberate design choice.

### Why no Stripe?

Two reasons:
1. The Free Trial type's `price_pence` is 0. Stripe rejects £0 sessions outright.
2. `mode: 'setup'` (card capture only, no charge) was considered but rejected as too complex for v1. Fraser's call: rate-limiting + phone dedup + email dedup is enough abuse protection.

### Why a separate handler instead of extending `checkout-slot-guest`?

Considered. Decided against because: the paid handler is 200+ lines of Stripe-specific logic, and stuffing a "if free trial, skip Stripe" branch into it would tangle two flows. The new handler shares ~30 lines of validation/rate-limit/conflict-check code with the paid one — duplication is intentional and acceptable. If/when a third "guest free flow" is added (referral redemption?), extract a helper.

### Why one-trial guard hits `lesson_bookings`, not `learner_users`?

So that an existing paid customer CAN book a free trial (they don't have one in the bookings table for this type), but no one can book TWO. The guard is keyed on "any prior booking of `lesson_type_id = 37`" matched by email or phone, regardless of status. Cancelled bookings count, so cancel/rebook abuse is closed.

### Why `validSlugs` was hardcoded

The check at `instructor.js:855` had `['standard', '2hr', '3hr']` hardcoded, even though `lesson_types` is the source of truth. Adding `'trial'` made four. There's also a `'1hr'` slug in the DB that's missing from the validator (existing drift, not introduced by this work). A TODO comment was added to dynamicise from the table. Worth doing, but out of scope for v1.

## Known limitations (TODO list for whoever picks this up)

### High-priority

1. **WhatsApp delivery investigation.** Confirmation WhatsApp messages did not arrive at Fraser's `+447903081618` during end-to-end testing. The shared `sendWhatsApp` helper is used by paid bookings too — Fraser said he's never received one. Could be: (a) Twilio sandbox phone not opted in, (b) `TWILIO_WHATSAPP_FROM` configured for a number that isn't WhatsApp-enabled, (c) silently-caught Twilio API errors. Not free-trial-specific. **Action:** check Twilio console delivery status for any recent message attempts; verify `TWILIO_WHATSAPP_FROM` env var matches a WhatsApp Business sender; add error logging to `sendWhatsApp` instead of `console.warn` so failures are visible in Vercel logs.

2. **C1 phone-bypass edge case.** End-to-end test surfaced a real hole: if a free trial form's phone number collides with an existing real `learner_users` row, the find-or-create fallback inserts the new learner with `phone=null`. A second free-trial attempt with a different email but the same phone slips past the guard because the prior booking's resolved learner has `phone=null`. **Action:** add a `guest_phone` column to `lesson_bookings` (nullable, populated only by `book-free-trial`), and update the C1 guard to check that column directly. Migration is one new column + an index. Probably 30 minutes.

### Medium-priority

3. **`validSlugs` drift.** The hardcoded list at `instructor.js:855` already has drift (`'1hr'` exists in DB but not in the validator). Now also has `'trial'`. **Action:** replace the hardcoded array with a query to `lesson_types WHERE school_id = ${schoolId} AND active = true`. ~15 min.

4. **Slot picker shows ALL of an instructor's slots.** A learner browsing free-trial slots sees every available 60-min window in the next 14 days. Fraser may want to constrain free trials to specific times (Mon/Wed evenings only?). **Action:** new column on `instructors` like `free_trial_availability_window` (jsonb day-of-week + time ranges) and filter in the `available` action when `lesson_type_id = trial`. Or simpler: a generic `lesson_type_constraint` table. Discuss with Fraser before building.

### Low-priority / future flips

5. **`REQUIRE_REFERRAL` flag.** A constant inside `handleBookFreeTrial` (`api/slots.js`) is currently `false`. Flipping to `true` makes free trial booking require `referral_code` in the body. The frontend already captures `?ref=XXX` and forwards it. Don't flip this until: (a) referrers know to share their referral link, (b) `credits.js` is extended to fire the referrer's reward when a referred learner takes a free trial (currently rewards trigger on credit purchase only), (c) homepage CTA is updated to either hide free-trial unless `?ref` is present, or show "by invitation only" copy. Half-day of work probably.

6. **Test plan in the PR includes a manual booking step.** It's worth Fraser actually doing this on the deployed PR before merge: book through the page, confirm calendar lands, click magic-link, verify guard. The build session did this against the preview already, but production deploy may surface env or routing differences.

## Files changed (full list)

### New files
- `public/free-trial.html` — public marketing/booking page, ~250 lines including inline CSS
- `public/free-trial.js` — slot picker + form submit, ~230 lines
- `public/free-trial-success.html` — minimal post-booking confirmation page
- `docs/handover-2026-04-26-free-trial.md` — this file

### Modified files
- `api/slots.js` — new `handleBookFreeTrial` ~290 lines, route registered at line 100
- `api/instructor.js` — `validSlugs` extended (1 line change)
- `public/index.html` — hero dual CTA + final CTA repointed
- `.claude/launch.json` — added `vercel-dev` preview config alongside `static-server`
- `DEVELOPMENT-ROADMAP.md` — entry 2.84 added
- `PROJECT.md` — `book-free-trial` added to api/slots.js action table; new prose bullet

### DB changes (no migration file — applied directly via throwaway scripts during build)
- `lesson_types.active = true` for slug `trial`
- `instructors.offered_lesson_types` updated for Fraser (id 4)

## Verification status

| Check | Result |
|---|---|
| Backend handler syntax-clean | ✅ `node --check` |
| `/free-trial.html` renders correctly desktop + mobile | ✅ preview screenshots |
| Slot picker loads slots from API | ✅ 75 slots across 10 days at test time |
| Form validation works | ✅ tested invalid email rejection |
| **End-to-end booking** | ✅ booking 185 created at 2026-04-27 14:30 with throwaway email |
| Booking row has correct fields | ✅ `payment_method='free'`, `created_by='free_trial_self_serve'`, `minutes_deducted=0` |
| Magic-link token generated | ✅ 7-day expiry, stored in `magic_link_tokens` |
| Learner confirmation email arrives | ✅ Fraser confirmed via inbox check |
| Instructor confirmation email arrives | ✅ Fraser confirmed via inbox check |
| WhatsApp delivery | ❌ never arrived — see TODO #1 |
| C1 email guard blocks retry | ✅ 409 with friendly message |
| C1 phone bypass via different email | ⚠️ confirmed weakness — see TODO #2 |
| Test data cleaned up | ✅ both bookings + learners deleted from DB |

## Context for next session

### User profile
- Fraser is a solo driving instructor in Reading, not a software engineer
- Had a strong product instinct in this session: pushed back on my initial "leave the final CTA pointing at the paid path" recommendation with "anyone getting into the car for a free trial lesson is never a regression" — and was right
- Tends toward "ship now" energy but accepts well-grounded push-back; used `/scientific-critical-thinking` deliberately during planning and acted on the findings

### What worked
- **Verify-first, build-second.** The plan v1 → v2 → v3 progression closed three real concerns (C1, C2, C4) before writing any code. Each /scientific-critical-thinking pass found real issues. Without C4, the build would have shipped an account-creation-as-anyone vector.
- **Reuse over rebuild.** The whole flow ended up being ~290 lines of new backend + 230 lines of frontend because `handleFreeOffer`, `findOrCreateLearner`, `magic_link_tokens`, `sendMagicLinkEmail` all already existed.
- **Throwaway scripts for DB ops** — clean pattern for one-shot reads/writes against prod DB without polluting the repo. Created → ran → deleted.

### What didn't work first time
- **Preview tool fought with the existing dev server.** I started Vercel dev in the background early ("/branch" setup), and later when I wanted to use the preview MCP, port 3000 was taken. Resolved by killing the background server and letting the preview tool relaunch on 3000. Future sessions: prefer `preview_start vercel-dev` from the start over starting a manual `vercel dev` first.
- **WhatsApp diagnosis.** Spent some cycles trying to find Twilio errors in the preview log buffer — the helper catches them and `console.warn`s, which Vercel dev streams differently per request. Moved on rather than digging deeper since it's not free-trial-specific.

### Useful one-shot Node script template

For ad-hoc DB reads/writes against prod (used heavily during this build):

```js
// scripts/_tmp_<name>.js
const fs = require('fs');
const envText = fs.readFileSync('.env.local', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}
const { neon } = require('@neondatabase/serverless');
(async () => {
  const sql = neon(process.env.POSTGRES_URL);
  // ... query / mutate ...
})().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
```

Run with `node scripts/_tmp_<name>.js`, then `rm scripts/_tmp_<name>.js`. Don't commit. `psql` is not installed locally on Fraser's Windows machine — this is the cleanest substitute.

## What I would NOT do in the next session

- **Don't merge this PR without doing the manual booking test on the deployed Vercel build.** Build session verified against preview, not prod deploy. Different env, different routing.
- **Don't try to "fix" the C1 phone bypass without adding the `guest_phone` column.** The current limitation is documented and intentional. Patching with array-of-variants checks won't actually close the hole (was tried during build, reverted).
- **Don't add a session cookie on booking response.** This was the C4 fix and is load-bearing security.
- **Don't extend `checkout-slot-guest` to also handle free trials.** They are deliberately separate handlers. See "Architecture decisions" above.
- **Don't activate any new lesson type without first verifying the public surface.** The Free Trial type was inactive for months precisely because no public page used it. Activating before the page existed would have surfaced it confusingly in `book.html` and possibly broken the Stripe checkout path.
