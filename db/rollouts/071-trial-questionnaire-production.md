# Qualifying questionnaire production activation — 21 September 2026

Authorisation: Fraser explicitly requested “I want the questionnaire live” after implementation, CI fixes, and the cache fix were reviewed. This superseded the earlier implementation-only restriction for schema, code and feature activation. Messages, campaign traffic, VSL footage and new automation remained outside this rollout.

## Target and recovery

- Neon project: `falling-firefly-48751671` (`neon-green-elephant`).
- Production: protected/default `main`, `br-summer-silence-abcpp6vw`, `neondb`.
- Governed target fingerprint: `32c8e09a13fff240b0e1af6bb4c063bce1ca02ec09b801242e9232c824123008`.
- Pre-migration snapshot: `snap-frosty-pond-abw4fetv`, created 21:43:11 UTC.
- Rehearsal branch: `br-lucky-brook-abx9cvpl`, created from production, expires 22 September 2026 at 22:00 UTC; compute suspends after five minutes idle.
- Code: `78cd0631a006bf152a12594cca0974efef13663b`, Vercel production `dpl_4kWHhDBAYsukRp23pgGc1PpvLx7C`, READY on both canonical domains. PR #475's merged cache fix was deployed through the existing Git integration; this rollout did not issue a separate deployment.

## Migration evidence

Repository syntax and all 72 manifest entries passed validation. Before apply, the governed runner found 69 applied and exactly 070/071 pending. Both migrations were first applied on the production-derived rehearsal branch. Production then received the same canonical files through `scripts/migration-runner.js --apply-approved`, with the reviewed fingerprint and approval variables scoped to that process and removed afterwards.

| Migration | Executed at (UTC) | Canonical LF SHA-256 |
|---|---|---|
| 070 | 2026-09-21 21:44:41.633 | `4f220073eff55ae3d6087b776912a24f3016508382a5e45981fb8eef822b7185` |
| 071 | 2026-09-21 21:44:41.823 | `3d11006e3b7758aec8d3a016c8d3534d1958fd2bfc222bc7b235d2c6f7f5d0db` |

Postflight returned 71 applied and no pending entries. All three evidence tables and immutable guards are present, all constraints are validated, and the four learner/intake columns are present. Production runtime role `cc_prod_runtime_20260830` has SELECT/INSERT/DELETE on the new tables and request-sequence usage. A broad role probe also found PostgreSQL's built-in write-only group lacks read/sequence access; this is not the application runtime and no permissions were broadened for it.

## Activation evidence

School identity was verified as id 1, slug `coachcarter`, host `www.coachcarter.uk`. Both feature keys were absent before activation. At **21:45:41.522 UTC**, a guarded operator transaction merged only these two keys into existing school config and inserted audit row **739**, action `trial_questionnaire.configure`, school 1:

```json
{
  "test_date_trial_funnel_enabled": true,
  "trial_questionnaire": {
    "enabled": true,
    "version": "qualification_v1",
    "supported_centres": ["Reading", "Greenham", "Farnborough", "Basingstoke"],
    "maximum_hourly_pence": 5500,
    "lower_budget_pence": 5000,
    "lowest_budget_pence": 4500
  }
}
```

The transaction required the exact school identity and unchanged prior flag values. It retained unrelated configuration and changed no actual lesson prices or other schools. The operator used the authorised database connection with `admin_id=NULL`, recording the user's authorisation, prior flags, snapshot and deployed commit in the audit details; no administrator identity or session was fabricated.

## Live verification

- Public-config returns the exact enabled configuration; `/test-booked` opens normally and its CTA reaches `/free` Question 1.
- Ten non-submitting browser journeys passed: 375px and 1365px for supported-centre £50 → live booking, supported-centre £45 → request, Other centre → request, no tests → request, and theory booked without practical → request. The practical fixture date was December 2027, also checking that a distant test does not impose a four-month eligibility cutoff.
- The live slot picker and no-suitable-time fallback render; no horizontal overflow or JavaScript page errors were observed. The mobile first question was visually inspected.
- Unauthenticated staff request-list access returns 401. VSL remains disabled.
- No production request, booking, learner, payment, notification or consent record was created by verification. Submission and persistence remain covered by the earlier isolated real-API tests, not claimed as production write tests.

## Rollback

Disable the questionnaire through the authenticated school settings control and, if withdrawing the campaign entry, disable the separate campaign flag. This restores the prior direct-booking entry without cancelling lessons. Record the change and activation gap. Preserve additive schema, request evidence and booking records; do not restore the full recovery snapshot over subsequent legitimate activity as a routine feature rollback. For code/privacy faults, follow the deployment rollback and retention checks in [the full handover](../../docs/qualifying-trial-funnel.md).
