# Handover — Free Trial verified in production (2026-04-26, evening)

> Read this before resuming any free-trial / login-flow / WhatsApp / `guest_phone`
> work. Self-contained — assumes the next session has zero memory of this one.

This session was the verification follow-up to the build session
(`docs/handover-2026-04-26-free-trial.md`). PR #102 has been **merged into
main** (merge commit `5c962bc`) and the flow is **verified working end-to-end
in production**. Test data was cleaned up; production DB is in the same
state as before the test except the merge has happened.

## What this session did

1. Pre-merge sanity check on PR #102 — read the diff, confirmed:
   - All SQL via tagged template literals
   - No per-file CORS
   - `school_id` filter on every query
   - Cookie-consent + posthog-loader on both new HTML pages (no inline PostHog)
   - Magic-link, no session cookie (the C4 fix from the build session)
   - Rate limit (10/IP/hr, 3/phone/hr)
   - One-trial guard correctly hits `lesson_bookings`, not `learner_users`
2. Inspected live DB state — confirmed `lesson_types.id=37` slug `'trial'` is
   active, Fraser (id 4) has `["standard","2hr","trial"]`, Simon (id 6) is
   NULL (i.e. all slugs incl. trial). Two pre-existing trial bookings (ids 92,
   94) from `setmore_sync`, neither is Fraser's.
3. Merged PR #102 via merge commit. Polled `coachcarter.uk/free-trial.html`
   until 200.
4. Hit a stale rate-limit row from the **previous** session's testing
   (`free_trial_phone:07903081618` count=3, `free_trial_ip:::1` count=3) —
   cleared it before testing.
5. Fraser drove the booking flow on his phone:
   - Inputs: name `Free Trial Test`, email
     `coachcarteruk+freetrial-2026-04-26@gmail.com`, phone `07903081618`,
     pickup `39 rg6 1dx`, slot Tue 28 Apr 09:30
   - Frontend redirected to `/free-trial-success.html` ✅
   - DB inspection: booking id 187, learner id 72 (alias), magic-link token
     id 157, all fields correct
6. Magic-link clicked → JWT cookie set → got blocked at the
   "One last step" terms-acceptance gate (see "New issue surfaced" below)
7. Worked around by visiting `/learner/` directly → landed on learner home,
   saw the test booking ✅
8. Cleaned up all synthetic test data: booking 187, token 157, learner 72,
   both rate-limit rows for the test phone/IP. Verified gone.

## Verification scorecard

| Check | Result |
|---|---|
| `/free-trial.html` renders in prod | ✅ |
| `/api/slots?action=available&lesson_type_id=37` returns slots | ✅ (74 across 10 days) |
| `book-free-trial` POST creates booking | ✅ booking id 187 |
| Booking has `payment_method='free'`, `created_by='free_trial_self_serve'`, `minutes_deducted=0` | ✅ |
| Learner row created | ✅ id 72 |
| Magic-link token (7-day expiry) | ✅ |
| Rate-limit incremented (1/10 IP, 1/3 phone) | ✅ |
| Learner confirmation email arrives | ✅ |
| Instructor confirmation email arrives | ✅ |
| Magic-link → JWT cookie → logged in as alias | ✅ |
| Booking visible in learner area | ✅ |
| WhatsApp delivery | ❌ — see TODO #1 |
| Phone-collision fallback fires (real account owns phone, alias gets `phone=null`) | ✅ confirms documented C1 weakness |

## TODOs for the next session (recommended order)

### 1. **Fix terms-acceptance "Continue" button** — newly surfaced this session

`public/learner/login.js` lines 383–406 + `public/learner/login.html` line 205.
After magic-link verify, if `terms_accepted` is false the user lands on
screen `terms`. Tapping the orange "Continue" button on Fraser's phone did
nothing. Console showed no errors, no `Saving…` state on the button —
suggests the click handler didn't fire at all.

Suspect: the `change` listener on `#terms-checkbox` enables the button only
when the **checkbox itself** fires `change`. On mobile, tapping the
**label** (which contains links to /terms.html and /privacy.html) may not
reliably bubble a change event to the inner checkbox, so the button stays
`disabled` and looks identical whether the box is ticked or not.

**Affects every new learner on mobile** including everyone who comes
through the new free-trial CTA. **Highest user-impact item on the board
right now.**

Verify reproduction first: open `/learner/login.html`, request a magic
link, click it on a phone, observe whether the button enables when you tap
the checkbox vs the surrounding label area. Console-check
`document.getElementById('accept-terms-btn').disabled` after each tap to
distinguish "button enabled but click does nothing" from "checkbox change
never fired".

Likely fix is small (~10–20 lines):
- Read button-disabled state from a fresh check rather than relying on the
  change event
- Or attach the listener to the label/click instead of checkbox/change
- Or use `input` event instead of `change`

Don't fix without first reproducing on a phone — could turn out to be a
cookie / JWT / `ccAuth.fetchAuthed` failure that's silently caught at line
402, and the diagnostic above will tell which.

This screen pre-existed PR #102. Not caused by this work.

### 2. **WhatsApp delivery investigation** (was TODO #1 in the build session, still TODO)

WhatsApp messages don't arrive for paid OR free-trial bookings. The
`sendWhatsApp` helper catches errors and `console.warn`s — failures are
invisible. Check:
- Twilio console for delivery status of any recent attempts
- `TWILIO_WHATSAPP_FROM` env var matches a WhatsApp Business sender
- Whether sender is in sandbox mode (Fraser's number must be opted in)
- Add `console.error` instead of `console.warn` in the helper so failures
  surface in Vercel logs

### 3. **Close the C1 phone-bypass** (was TODO #2 in the build session, still TODO)

This session **confirmed the bypass is real** — booking 187 created a
learner row (id 72) with `phone=null` because the form's phone collided
with the existing real `learner_users.id=15` (Fraser's account). A second
free-trial attempt with a different email and the same phone would slip
past the dedup guard.

Fix: add `guest_phone` column to `lesson_bookings`, populated only by
`book-free-trial`, used in the C1 guard alongside the email-and-phone
lookup. Schema migration in `db/migration.sql` + handler change. ~30–45
min including end-to-end verify.

Don't try to "patch" without the column — was tried during build, reverted.

### 4. **PostHog CSP regression** — surfaced in console during this test

`public/posthog-loader.js` line 13 fetches
`https://eu-assets.i.posthog.com/static/array.js`, but the page CSP only
whitelists `https://eu.i.posthog.com`. Browser blocks the script. Means
analytics is silently broken on at least `/learner/login.html`. Likely
broken everywhere posthog-loader is used.

Fix: add `https://eu-assets.i.posthog.com` to `script-src` in middleware.js
(or wherever CSP is set) and to `script-src-elem` if defined. Tiny change.

### 5. **Stale rate-limit hangover from testing**

Both this session and the build session had to manually clear stale
`free_trial_*` rate-limit rows before re-testing. Worth either:
- Adding a "skip rate limit if `req.headers['x-test-key'] === SECRET`"
  bypass for end-to-end testing, OR
- Just remembering to clear before re-test (current pattern)

Low priority — only matters if free-trial is being re-tested often.

### 6. **Carry-over from build session** (still TODO, not blocking)

- `validSlugs` drift in `instructor.js:855` — hardcoded list, should query
  `lesson_types`. Has TODO comment.
- Slot-picker shows ALL of an instructor's free-trial slots — Fraser may
  want to constrain (Mon/Wed evenings only?). Discuss before building.
- `REQUIRE_REFERRAL` flag in `handleBookFreeTrial` — currently `false`,
  documented when to flip.

## DB state right now

Same as the build session left it, modulo:
- PR #102 is merged (lesson_types/instructors changes were already live)
- Both pre-existing setmore-sync trial bookings (ids 92, 94) still there —
  not test data, real historical bookings classified under the trial type
  *before* it was activated. They block the slot for those days but
  otherwise inert. **Don't delete.**

No test data left over from this session.

## Scripts pattern (copy from previous handover)

The throwaway-script pattern from the build session worked again:

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

Run with `node scripts/_tmp_<name>.js`, then `rm` the file. Don't commit.
For destructive scripts, **always include a pre-flight SELECT to confirm
the row matches expected synthetic test markers** (e.g.
`created_by='free_trial_self_serve'`) before DELETE — there's a real
account row (id 15) and a real Fraser-the-instructor row (id 4) sharing
the test phone number, so a careless WHERE clause is genuinely dangerous.

## What I would NOT do in the next session

- Don't re-verify PR #102 — it's merged and verified.
- Don't try to fix the terms-button bug without first reproducing it on a
  phone. Could be a different root cause than the obvious
  checkbox-change-event hypothesis.
- Don't treat the WhatsApp issue as free-trial-specific — it affects all
  booking flows.
- Don't delete bookings 92 or 94 — they're real historical data.
- Don't merge any future free-trial work without re-verifying end-to-end
  in prod, since this session re-confirmed that preview deployments are
  behind 401 deployment protection (couldn't drive the test from
  terminal — Fraser had to do it in his browser).
