# GDPR Compliance (April 2026)

> Hard rules live in `CLAUDE.md`. This file is reference material — load it when adding PII, admin actions, consent flows, or retention logic.

The platform is GDPR-compliant.

## What's in place

- **Cookie consent banner** (`public/cookie-consent.js`) — appears on all pages before any analytics load. PostHog only initialises after explicit consent via `public/posthog-loader.js`.
- **Data export** (`POST /api/learner?action=export-data`) — learners can download all personal data as JSON from their profile page (Article 20 — Right to Portability).
- **User-initiated deletion** (`POST /api/learner?action=request-deletion`, `confirm-deletion`) — email-verified cascading delete with both `credit_transactions` and `lesson_bookings` anonymised for 7-year tax retention (Article 17 — Right to Erasure).
- **Unified cascade helper** (`api/_gdpr.js::deleteLearnerCascade`) — single source of truth for the learner deletion cascade. Wraps the full set of FK-clean-up DELETEs in a Neon HTTP transaction (atomic: all-or-nothing). Used by learner self-delete, admin delete, and the retention cron. Before May 2026, each of those three paths maintained its own divergent list (PR-K — audit #16).
- **Data retention cron** (`api/cron-retention.js`) — runs weekly (Sunday 3am UTC). Soft-archives learners inactive >3 years, hard-deletes after 90-day grace period via `deleteLearnerCascade`. Archives enquiries >2 years.
- **Audit logging** (`api/_audit.js`) — logs admin actions (delete-learner, adjust-credits, create/update/toggle-instructor, mark-complete) to `audit_log` table.
- **Consent recording** (`POST /api/config?action=record-consent`) — stores cookie consent decisions with hashed IP and timestamp for audit proof.
- **`last_activity_at`** — updated on login (`magic-link.js`) and booking creation (`slots.js`) to support retention policy.

## GDPR tables

- `cookie_consents` — visitor_id, learner_id, analytics boolean, ip_hash, user_agent, school_id
- `audit_log` — admin_id, action, target_type, target_id, details JSONB, school_id
- `deletion_requests` — learner_id, token, status (pending/confirmed/completed/cancelled), school_id

## Key files

- `public/cookie-consent.js` — consent banner UI + localStorage state + server recording
- `public/posthog-loader.js` — consent-gated PostHog initialisation
- `api/_audit.js` — shared `logAudit(sql, {...})` utility
- `api/_gdpr.js` — shared `deleteLearnerCascade(sql, learnerId, opts)` — atomic learner-deletion cascade used by all three paths
- `api/cron-retention.js` — weekly data retention enforcement (Vercel cron, Sunday 3am UTC)
- `api/learner.js` — `export-data`, `request-deletion`, `confirm-deletion` actions
- `public/learner/confirm-deletion.html` — token-based deletion confirmation page
- `public/learner/profile.html` — "Privacy & Data" section (export, cookie settings, delete account)
