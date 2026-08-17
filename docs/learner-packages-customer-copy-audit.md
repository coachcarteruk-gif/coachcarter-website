# Learner Packages customer-copy audit

Reviewed: 16 August 2026

## Customer-facing readiness finding

The production page was not ready for ordinary learners or parents. The product and payment rules were safe, but the presentation exposed rollout and accounting language such as `School 1 gate`, `verified signed webhook`, `immutable purchase source`, version numbers, `fulfilment`, test-mode states and raw programme statuses.

The frontend now leads with the only live customer choice, 15 or 30 Flexible Hours, and describes unavailable products in customer language. It keeps the exact checkout acknowledgement and immediate-access request at the payment decision point inside one combined terms checkbox in the `Review and buy` step. Learners with a positive balance see a direct calendar CTA instead of another purchase action.

## Visible copy ownership

| Source | What it controls | Treatment in this change |
|---|---|---|
| `public/learner/packages.html` | Page introduction, section order, section explanations, payment overview and cross-links | Rewritten in plain British English. Flexible Hours now leads as available; other packages are clearly unavailable. |
| `public/learner/packages.js` | Availability labels, card presentation, purchase review, balance/status wording, payment-return wording and programme-status wording | Legal strings still come from the API unchanged but are presented in one combined acceptance. A positive balance links to `/learner/book.html`. |
| `api/packages.js` and eligibility helpers | School-scoped catalogue, live/test gates, signed-in eligibility and machine-readable reasons | A positive Flexible Hours balance returns `existing_flexible_balance`, preventing a repeat purchase action while preserving catalogue visibility. |
| `api/flexible-packages.js` | Checkout, status and balance responses | Checkout independently rejects a positive spendable balance, so the rule cannot be bypassed through the browser UI. |
| `package_product_versions.content` | Product names, descriptions, highlights, exclusions, checkout disclosure and Flexible Hours acknowledgement wording | Existing rows remain immutable and were not edited. The page uses structured facts to present concise card copy while preserving the exact legal acknowledgements. |

## Database-backed wording still needing a prospective version

The live immutable product versions still contain wording that should not be reused in receipts, emails or future clients without translation:

| Product | Current database-backed wording | Recommended prospective wording |
|---|---|---|
| 15 Flexible Hours | `15-hour Flexible Hours package`; `Fifteen school-wide lesson hours, usable with any eligible active instructor`; `Used in exact 30-minute units`; signed-webhook checkout disclosure | `15 Flexible Hours`; `A smaller upfront block you can use with any available CoachCarter instructor`; `Book in 30-minute steps`; `Your hours are added after your bank confirms the payment.` |
| 30 Flexible Hours | `30-hour Flexible Hours package`; `Thirty school-wide lesson hours, usable with any eligible active instructor`; `Used in exact 30-minute units`; signed-webhook checkout disclosure | `30 Flexible Hours`; `A larger upfront block for learners planning regular lessons`; `Book in 30-minute steps`; `Your hours are added after your bank confirms the payment.` |
| Full Curriculum | Internal Phase 1/2/3 language and `Adults-only controlled pilot` | `A structured weekly route to your booked practical test, with independent progress checks and extra support for one eligible retake.` Keep the exact 24-week, test-date, cancellation and exclusion terms in the purchased terms. |
| Manoeuvres | `Three immutable GBP 50 session units for future accounting`; `not available in Phase 1` | `Three one-hour specialist sessions with no promotional tasks`; `Not currently available to book.` |
| Manoeuvres Challenge | `original-method refund or programme credit`; rollout, safeguard and evidence language | `Three specialist sessions with optional promotional tasks and a possible reward if you meet the published criteria`; `Not currently available to book.` |

The Flexible Hours checkout acknowledgement and immediate-access request retain their approved wording and legal meaning. The frontend combines both exact strings into one checked acceptance and stores immediate access as requested. The wording should change only through a separately reviewed consumer-rights version.

## Safe follow-up mechanism

Do not update or delete an existing `package_product_versions` row and do not edit an applied migration. After commercial and consumer-rights review:

1. Create a new prospective product version through the existing audited admin version-creation path.
2. Keep the live prices, hours, unit values, exclusions, cancellation treatment and `flexible-hours-v1` validation contract unchanged unless a separate approved product decision says otherwise.
3. Give the version a future effective time, review its exact catalogue and checkout snapshot with the purchase gate unchanged, then verify signed-out and eligible signed-in rendering.
4. Let existing attempts and purchases retain their original product snapshot and terms. Never rewrite historical payment or entitlement evidence.
