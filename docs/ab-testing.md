# CoachCarter first-party A/B testing

## What this system does

`public/experiment-assignment.js` assigns a page-level experiment before the page body is parsed. It does not call PostHog, set a marketing cookie, navigate, or alter the query string.

- Assignment is stored in `sessionStorage` under `cc_experiment_assignments`, so a visitor stays on the same variant for that browser visit.
- A cryptographically generated random fraction is used when available.
- The chosen key and variant are written to `data-experiment-key` and `data-experiment-variant` on `<html>` before experiment content exists in the DOM.
- Variant CSS hides non-matching `[data-variant-only]` content before first paint. If the script is unavailable, the fallback control remains usable.
- `cc_variant=A` or `cc_variant=B` is a QA-only override. Override traffic is marked `experiment_eligible: false` so it can be excluded from analysis.
- UTMs remain on the original URL and are copied into every funnel event and the enquiry payload.
- Assignment and form submission do not depend on PostHog. PostHog events are sent only when the existing analytics consent is `true`.
- On `/free-consultation`, `posthog-loader.js` explicitly disables autocapture, automatic page views/page leave, dead-clicks, heatmaps, performance capture, surveys, and session recording, and sets `person_profiles: 'never'`. The form is also marked `ph-no-capture`. Only the custom allowlisted funnel events below should be used for this PII form.

The current page configuration is:

```html
<script src="/experiment-assignment.js"
  data-experiment-key="free-consultation-v1"
  data-variants="A:50,B:50"
  data-status="active"
  data-fallback="A"></script>
```

## Free-consultation event contract

All five events contain `experiment_key`, `experiment_variant`, `experiment_status`, `experiment_eligible`, `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content`. They also contain `$feature/free-consultation-v1`, mapped as `control` for page Variant A and `B` for page Variant B so PostHog can analyse a custom-assigned experiment.

| Stage | Event | Notes |
| --- | --- | --- |
| Exposure | `free_consultation_page_viewed` | Sent once after analytics consent is available. |
| CTA | `free_consultation_cta_clicked` | Includes only CTA label and placement, never form values. |
| Form start | `free_consultation_form_started` | Sent once on the first real form interaction. |
| Confirmed conversion | `free_consultation_requested` | Sent only after the API returns `dbSaved: true`. |
| Diagnostic | `free_consultation_submission_error` | Includes a coarse error category and HTTP status, not raw errors or personal data. |

Do not use the generic `form_submitted` event as the conversion. It represents an attempt and can fire when no enquiry was saved.

The database remains the source of truth for leads. `enquiries` stores `experiment_key`, `experiment_variant`, and the four UTM fields in dedicated columns, scoped by the existing `school_id`. The migration is `db/migrations/056_enquiry_experiment_attribution.sql`; it must be reviewed and applied through the normal database rollout process before code using the new columns is deployed.

## Create a future page experiment

1. Write one hypothesis and choose one confirmed business outcome. Give the experiment a new immutable key, such as `campaign-name-v1`; never reuse a key for a different hypothesis.
2. Add the synchronous assignment tag in `<head>` before the page body and before experiment CSS. Start with `data-status="draft"` and set the control in `data-fallback`.
3. Add page content with `data-variant-only="A"` and `data-variant-only="B"`. Keep shared content unmarked. Do not swap content after `DOMContentLoaded`.
4. In the page JavaScript, read `window.ccExperiments['campaign-name-v1']`, attach the key, variant and UTMs to the lead payload, and add the same common properties to consent-gated events.
5. Add the `$feature/campaign-name-v1` property to the custom exposure and metric events. Map page Variant A to PostHog's required `control` value.
6. Add dedicated database fields or structured JSON metadata for any new lead attribution that the admin needs. Keep all queries scoped by `school_id`.
7. Test both QA URLs, consent accepted and declined, successful and failed saves, 375–390px mobile widths, and the clean production route.

Only run one page-level visual experiment on a campaign page at a time. This keeps the `<html>` variant selector and interpretation of conversions unambiguous.

## Start, pause, resume, and end

### Start

1. Confirm the migration is applied in the target environment and the clean route works.
2. Confirm PostHog receives both variants from internal QA, then exclude override traffic with `experiment_eligible = true` in analysis.
3. Change `data-status="draft"` to `data-status="active"` and deploy through the normal reviewed process.
4. Record the start timestamp, hypothesis, split, primary metric, baseline, minimum detectable effect, and planned sample size before reading results.

### Pause

Set `data-status="paused"`. The page immediately serves `data-fallback` to new and returning visits; stored assignments are retained so a later resume is stable. Pause the matching PostHog experiment at the same release boundary and record why it was paused.

### Resume

Restore `data-status="active"` without changing the key, variants, split, or markup. Resume the matching PostHog experiment. If the implementation or hypothesis changed materially, end the old experiment and create a new key instead.

### End and ship

1. End the PostHog experiment and record the decision, confidence, sample size, conversion rates, error rate, and lead-quality review.
2. Set `data-status="ended"` and set `data-fallback` to the shipped variant (`A` or `B`).
3. After the decision has been documented and the result has been stable in production, remove losing markup and the assignment tag in a separate cleanup change. Keep the stored experiment columns on historical enquiries.

Changing weights, variant definitions, or the hypothesis after launch invalidates clean interpretation. End and version the experiment instead.

## Configure the matching PostHog experiment

PostHog supports experiments driven by another assignment system through a custom exposure event. Create an experiment named `Free consultation v1` with feature-flag key `free-consultation-v1`, variants `control` and `B`, and a 50/50 split. CoachCarter remains responsible for assignment; PostHog is analysis-only.

Because analytics is consent-gated, PostHog's experiment denominator contains analytics-consenting visitors only. The database still contains every confirmed saved lead. Do not divide the all-leads database count by the consented PostHog exposure count; use like-for-like PostHog events for the experiment rate and the database separately for lead truth and quality.

1. In PostHog, create the experiment and choose the custom exposure event `free_consultation_page_viewed`.
2. Filter the exposure to `experiment_key = free-consultation-v1`, `experiment_eligible = true`, and `experiment_status = active`.
3. Set the primary metric to the unique-user conversion event `free_consultation_requested`. This produces confirmed requests divided by exposed assigned visitors.
4. Add secondary metrics for `free_consultation_form_started` and `free_consultation_cta_clicked`.
5. Add `free_consultation_submission_error` as a guardrail metric to minimise, not as a funnel success.
6. Use the default behavior that excludes visitors exposed to more than one variant. Check the exposure chart for a 50/50 split and investigate any sample-ratio-mismatch warning before reading the result.

Create a dashboard with:

- A three-step funnel: `free_consultation_page_viewed` → `free_consultation_form_started` → `free_consultation_requested`, broken down by `experiment_variant`.
- A CTA engagement ratio or trend: unique `free_consultation_cta_clicked` users divided by unique exposed users.
- A submission-error trend and rate, broken down by variant.
- Campaign views broken down by `utm_source`, `utm_campaign`, then `utm_content`.
- A database/admin review of lead status by experiment variant. PostHog measures volume and page behavior; the CoachCarter enquiry record is authoritative for saved leads and later lead quality.

PostHog's current documentation for this setup is [Experiments without feature flags](https://posthog.com/docs/experiments/running-experiments-without-feature-flags), [custom exposures](https://posthog.com/docs/experiments/exposures), and [experiment metrics](https://posthog.com/docs/experiments/metrics).

## Stopping rule

Do not choose a fixed visitor count or stop when one line happens to look better.

1. Calculate the baseline confirmed-request rate from comparable traffic: confirmed `free_consultation_requested` users divided by eligible exposed users. If there is no reliable baseline, collect an A-only baseline period first.
2. Decide the smallest relative improvement that would justify permanently keeping Variant B. This is the minimum detectable effect (MDE), and it is a business decision rather than a statistical default.
3. Enter the baseline rate, chosen MDE, and observed eligible exposures per day into PostHog's running-time calculator. Use its resulting sample target and time estimate; once the test has at least one day and 100 exposures, its automatic estimate uses the live baseline and traffic.
4. Continue until the planned sample target is reached and the traffic window covers the normal weekly traffic mix. Do not repeatedly stop early after checking the result.
5. Before shipping a winner, require no sample-ratio mismatch, no material deterioration in submission errors, and no obvious drop in lead quality by admin status. If the target sample is unrealistic at actual traffic, report the test as underpowered rather than declaring a winner.

PostHog documents the calculator inputs and power calculation in [Running time and sample size](https://posthog.com/docs/experiments/sample-size-running-time).

## Local QA URLs

- Variant A: `/free-consultation?cc_variant=A&utm_source=local-preview&utm_medium=qa&utm_campaign=free-consultation-v1&utm_content=variant-a`
- Variant B: `/free-consultation?cc_variant=B&utm_source=local-preview&utm_medium=qa&utm_campaign=free-consultation-v1&utm_content=variant-b`

Never put `cc_variant` in an advert or public campaign link. The public advertising URL remains `/free-consultation`.
