# Learner Broadcasts

Admin learner broadcasts are simple, manual, school-scoped SMS campaigns sent to global learner categories on `learner_users.learner_category`.

## Scope

- Supported categories: `regular`, `sporadic`, `inactive`, `passed`.
- No scheduling, automation, templates, or personalised merge fields in v1.
- Admins must preview recipients before sending in the portal.
- Learners without a usable phone number are skipped and recorded in history.
- Sends use the existing `sendWhatsApp()` helper, which currently delivers SMS via Twilio and writes `notification_log`.

## Admin API

All actions live on `api/admin.js` and use existing admin auth plus `getAdminSchoolId()`.

| Action | Method | Description |
|---|---|---|
| `learner-broadcast-preview` | POST | Body `{ categories }`. Returns matching recipients with normalised phone numbers plus skipped learners. |
| `send-learner-broadcast` | POST | Body `{ label, message_body, categories }`. Re-resolves the school-scoped audience, creates broadcast history rows, sends to usable phones, records every outcome, and audit-logs `admin.send_learner_broadcast`. |
| `learner-broadcast-history` | GET | Returns recent campaigns plus per-recipient outcomes for the authenticated school. |

## Tables

- `learner_broadcasts`: campaign label, message body, selected categories, creator, status, counts, timestamps, `school_id`.
- `learner_broadcast_recipients`: recipient snapshot, phone used, category, sent/skipped/failed status, skip/error reason, `school_id`.

The recipient table is intentionally a campaign ledger, not a substitute for `notification_log`. `notification_log` remains the low-level delivery-attempt log written by the messaging helper.

## GDPR

Learner export includes `broadcasts_received`. Learner deletion anonymises `learner_broadcast_recipients` by clearing `learner_id`, name, email, and phone while preserving campaign-level history and aggregate counts.
