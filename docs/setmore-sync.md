# Setmore → CoachCarter booking transition (live since April 2026)

> **Hard "do NOT" rules live in `CLAUDE.md`.** This file is reference material — load it when touching the sync, booking imports, or the transition off Setmore.

Fraser is migrating from Setmore (third-party booking) to CoachCarter's built-in booking system. **Both systems run in parallel** during the transition.

## How it works

- `api/setmore-sync.js` — cron every 15 min, imports Setmore appointments as real `lesson_bookings`
- Syncs via Setmore REST API (OAuth2, refresh token in `SETMORE_REFRESH_TOKEN` env var)
- Each appointment's `staff_key` maps to the correct CoachCarter instructor via `instructors.setmore_staff_key`
- Learners auto-created or matched by phone/email, linked via `learner_users.setmore_customer_key`
- Idempotent — `lesson_bookings.setmore_key` unique index prevents duplicates
- Imported bookings have `created_by = 'setmore_sync'` and `minutes_deducted = 0` (no balance deduction)
- Service durations subtract Setmore's built-in 30-min buffer (e.g. 120min Setmore = 90min real lesson)
- **Pickup addresses** pulled from Setmore customer profile (`address`, `city`, `postal_code` fields) and stored in `lesson_bookings.pickup_address`. Backfills existing bookings that previously had no address. Customer data cached per `customer_key` to avoid duplicate API calls.

## Instructor DB emails differ from Setmore emails

- Fraser: DB has `fraser@coachcarter.uk` (Setmore has `coachcarteruk@gmail.com`)
- Simon: DB has `simon.edw@outlook.com` (Setmore has `simon@coachcarter.uk`)
- Always use instructor `id` (Fraser=4, Simon=6) when updating, not email

## Timezone handling

Setmore returns appointment times in the account's configured timezone (Europe/London). The sync's `parseSetmoreTime()` function always extracts the date and time directly from the ISO string via regex, ignoring any `Z` suffix or timezone offset Setmore may include. This prevents double-conversion during BST (UTC+1). Never parse Setmore timestamps through `new Date()` or `Intl` — the times are already local.

## Cancellation sync

The sync also detects cancelled/removed Setmore appointments and marks the corresponding `lesson_bookings` entry as cancelled. Checks both the appointment `status` field and missing appointments (removed from Setmore entirely). **Guard**: cancellation detection is skipped when the API returns zero active appointments — this prevents transient API failures from mass-cancelling all existing bookings.

## Welcome emails

`api/setmore-welcome.js` runs daily at 10am, sending a one-time welcome email with a 7-day magic link to Setmore-created learners who haven't logged in. Tracked via `learner_users.welcome_email_sent_at`.

## Notification toggles

Both `edit-booking` and `cancel-booking` accept a `notify` param (default true). Instructors can untick "Notify learner" when doing bulk data cleanup.

## Edit-booking protection

Editing a booking sets `edited_at` on the booking. The Setmore sync checks `edited_at` and skips manually edited bookings. Do NOT clear `setmore_key` when editing — the sync needs it to find and skip the booking.

## Transition plan

New bookings go through CoachCarter. Existing Setmore clients migrate as lessons complete. Once all clients are on CoachCarter, remove the sync cron and `SETMORE_REFRESH_TOKEN` env var.
