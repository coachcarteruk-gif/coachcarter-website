# Social Video Filming Discount Follow-Up Plan

Date: 2026-06-21

Branch/context: `codex/video-recording-lesson-discount`

This plan captures the code-review findings for the social-video filming discount work and the recommended order for the next implementation session.

## Review Findings

1. Under-18 users can opt into social filming.
   - The published privacy policy says the social-media content consent feature is 18+ only.
   - The booking UI shows the filming option whenever the instructor has `social_video_opt_in = TRUE`.
   - The booking APIs accept `social_video_consent` without an age gate or explicit 18+ confirmation.

2. Repeat booking totals go stale after toggling filming consent.
   - The checkbox handler reruns single-lesson modal pricing, but does not rerun the repeat-aware deduction total.
   - For repeat bookings, the displayed deduction, balance-after copy, and credit/pay path can stay stale until another repeat control changes.

3. GDPR export omits the new consent fields.
   - `lesson_bookings.social_video_consent` and `lesson_bookings.social_video_discount_pct` are new learner-specific consent/payment facts.
   - `api/learner.js?action=export-data` currently omits them from the `bookings` export.

4. Consent copy is hardcoded to CoachCarter.
   - The learner booking modal says footage may be used by CoachCarter.
   - This is a multi-tenant learner surface, so non-CoachCarter schools would collect consent using the wrong brand/controller context.

## Implementation Plan

### 1. Fix Consent Eligibility First

Decide the product/legal eligibility model before polishing UI.

Recommended implementation:

- Add an explicit 18+ confirmation next to the filming consent checkbox.
- Send a separate boolean, for example `social_video_age_confirmed`, with booking requests.
- Reject `social_video_consent = true` on the server unless `social_video_age_confirmed = true`.
- Snapshot the confirmation if needed with a new column such as:
  - `lesson_bookings.social_video_age_confirmed BOOLEAN NOT NULL DEFAULT FALSE`
- Carry the snapshot through:
  - Credit booking path: `api/slots.js?action=book`
  - Authenticated Stripe checkout metadata: `api/slots.js?action=checkout-slot`
  - Guest Stripe checkout metadata: `api/slots.js?action=checkout-slot-guest`
  - Stripe webhook booking insert: `api/webhook.js`
  - Reschedule / reserved move copy paths if the field is added

Tests to add/update:

- Credit booking rejects `social_video_consent=true` without age confirmation.
- Authenticated checkout rejects or refuses the discount without age confirmation.
- Guest checkout rejects or refuses the discount without age confirmation.
- Bookings snapshot consent and age confirmation when both are true.

### 2. Make Consent Copy Tenant-Safe

Replace hardcoded `CoachCarter` copy in `public/learner/book.html`.

Preferred copy direction:

- Use existing school/brand context if already available on the booking page.
- Otherwise use neutral wording like `your driving school`.
- Keep the copy aligned with `public/privacy.html`:
  - Optional consent
  - Social/content/marketing use
  - Discount applies only when selected for that booking
  - No consent means the same slot can still be booked without the discount

Files likely touched:

- `public/learner/book.html`
- `public/learner/book.js` if dynamic brand injection is needed
- Possibly `PROJECT.md` / docs if the contract wording changes

### 3. Fix Repeat-Booking Recalculation

In `public/learner/book.js`, update the filming checkbox handler.

Current behavior:

```js
if (selectedLessonType) applyLessonTypeToModal(selectedLessonType, !auth, !auth && false);
```

Recommended behavior:

```js
if (selectedLessonType) {
  applyLessonTypeToModal(selectedLessonType, !auth, !auth && false);
  updateDeductDisplay();
  updateBookButtonState();
}
```

Then verify:

- Single lesson price updates immediately.
- Repeat lesson total updates immediately.
- Credit eligibility switches correctly when discounted charge minutes make the learner eligible.
- Balance-after line reflects the repeat total, not just one lesson.

Add or update a focused learner UI regression test.

### 4. Update GDPR Export

Update the `bookings` query in `api/learner.js?action=export-data` to include:

- `lb.social_video_consent`
- `lb.social_video_discount_pct`
- `lb.social_video_age_confirmed` if that column is added

The fields can remain under the existing `bookings` export category.

Add a focused export test if there is an existing GDPR/export test pattern; otherwise add a source-level regression test as a minimum.

### 5. Add Better Behavioral Coverage

The current social-video tests are mostly source-string contract tests. Add behavior-level coverage where practical.

Recommended test cases:

- Server rejects filming discount without age confirmation.
- Server rejects or ignores consent when the instructor is not opted in.
- Discounted credit booking deducts discounted charge minutes but keeps the full lesson `end_time`.
- Stripe metadata includes the discounted charge minutes and consent snapshots.
- Webhook creates a booking with discounted `minutes_deducted`, full slot time, and consent snapshot.
- GDPR export includes the consent fields.

### 6. Final Verification

Run the focused suite:

```powershell
npm.cmd test -- tests/social-video-booking-discount.spec.js tests/direct-booking-effective-pricing.spec.js tests/learner-credit-ui.spec.js tests/webhook-slot-booking.spec.js
```

Also run any new GDPR/export tests added for this work.

Finally, inspect all social-video touchpoints:

```powershell
rg -n "social_video|Social video|Filmed lesson|filming" api public db docs tests
```

Confirm each booking creation/copy path either intentionally supports the feature or intentionally leaves the new fields at their safe defaults.
