# Progress, Mock Test, and Assessment System Plan

## Purpose

This plan turns the progress-system audit into a practical improvement path.

The current system has useful foundations, but it is trying to serve three audiences at once:

- Learners who need motivation and simple next steps.
- Supervisors or parents who need an easy way to support private practice.
- Instructors who need reliable teaching signals and assessment history.

The goal is to reshape the system from a technical assessment dossier into a clear coaching loop:

1. Learners practise and reflect without feeling judged.
2. Supervisors capture simple, useful observations.
3. Instructors receive structured signals they can act on.

## Current Diagnosis

### What Works

- A shared competency framework exists in `public/competency-config.js`.
- DL25 mapping gives the system real teaching structure.
- Supervisor categories are much clearer than raw DL25 categories.
- Focused Practice is a strong learner-facing concept.
- Mock-test data is already connected to learner progress and instructor learner records.
- The learner API already aggregates lessons, quiz results, mock tests, and practice history.

### Main Problems

- Learner-facing copy is too technical: "DL25 profile", "competency record", "faults", "serious", "dangerous", "readiness", "dossier".
- The progress page feels like an assessment report rather than a motivating plan.
- Mock Test tries to serve learner, supervisor, and instructor use cases in one flow.
- Supervisor mode is simpler than instructor mode, but still too much like formal marking.
- Supervisor notes and selected hints appear useful on the result screen but are not persisted.
- Some progress writes appear to miss `school_id`, which risks bad data in multi-school contexts.
- Instructor view shows history, but not enough actionable teaching summary.
- Some advanced features, especially fault-map pinning, appear complex without enough long-term value.

## Product Direction

Split the system into three clear modes.

### 1. Learner Mode: My Driving Plan

Audience: learner drivers.

Purpose: motivation, reflection, and next-step clarity.

This should answer:

- Am I getting better?
- What should I practise next?
- What should I ask my instructor?
- What have I done recently?

Avoid:

- DL25 language by default.
- D/S/X fault terminology.
- Formal pass/fail framing unless the learner explicitly enters mock-test mode.
- Over-confident readiness percentages without explanation.

Recommended labels:

- "My Driving Plan" instead of "My Progress" or "Competency Profile".
- "Practise next" instead of "Areas for Improvement".
- "Needs instructor help" instead of "Dangerous fault" in learner/supervisor contexts.
- "Current practice score" only if percentages remain.

### 2. Supervisor Mode: Practice Drive

Audience: parents, relatives, supervising drivers.

Purpose: capture useful observations without making the supervisor feel like an examiner.

This should answer:

- What should we focus on during this drive?
- What went well?
- What needs more practice?
- Did anything feel unsafe or worth telling the instructor?

Avoid:

- Calling it a mock test by default.
- Asking supervisors to mark like an instructor.
- Requiring route choice, rounds, and test-style mechanics for ordinary private practice.

Recommended structure:

1. Pick 1-3 focus areas.
2. Drive.
3. Pull over and answer simple reflection questions.
4. Save a short summary.
5. Offer to share the summary with the instructor.

### 3. Instructor Mode: Assessment

Audience: instructors.

Purpose: proper DL25-style assessment, mock-test records, and teaching plans.

This can keep:

- DL25 terminology.
- Driving, serious, dangerous faults.
- Mock-test pass/fail criteria.
- Per-area and per-sub-skill fault breakdown.
- Route-based context if it becomes useful and persistent.

Instructor mode should produce:

- Last mock result.
- Top fault areas.
- Trend since previous assessment.
- Learner/supervisor private-practice notes.
- Suggested next lesson focus.

## Phase 1: Data Safety and Trust

Priority: high.

These are the first fixes because user trust depends on saved progress actually appearing correctly.

### 1. Add `school_id` to Progress Writes

Files to inspect:

- `api/learner.js`

Known risk areas:

- Session skill ratings insert around the `handleSessions` POST flow.
- Onboarding driving session insert.
- Onboarding skill ratings insert.

Current concern:

- Some inserts create `driving_sessions` or `skill_ratings` without explicitly setting `school_id`.
- Later reads filter by `school_id`.
- In a multi-school setup, saved data may not appear correctly or may rely on unsafe defaults.

Acceptance criteria:

- Every insert into tenant-scoped progress tables includes `school_id`.
- Every update/read that joins progress data scopes by `school_id`.
- Add focused tests for non-default `school_id` where practical.

### 2. Tighten Instructor Learner History Scope

Files to inspect:

- `api/instructor.js`

Known concern:

- `handleLearnerHistory` checks that the learner belongs to the instructor school, but the bookings query should also explicitly scope `lesson_bookings` and joined session data by `school_id`.

Acceptance criteria:

- Instructor learner history cannot read cross-school booking/session data.
- Query uses `lb.school_id = schoolId`.
- Joined progress rows are also scoped where applicable.

### 3. Stop Offline Mock Tests Pretending to Save

Files to inspect:

- `public/learner/mock-test.js`
- `api/learner.js`

Current concern:

- If mock-test creation fails, the UI continues with a local id.
- Later screens can still imply progress was saved.

Acceptance criteria:

- If the API cannot create a mock test, the user sees a clear "not saved" state.
- The results screen does not say weak areas were added unless they actually were.
- Retry/save-later behaviour is added or the flow is blocked until online.

### 4. Persist Supervisor Notes and Hints

Files to inspect:

- `public/learner/mock-test.js`
- `api/learner.js`
- DB schema/migrations

Current concern:

- Supervisor checkboxes and free-text notes are useful in the immediate results screen.
- They do not appear to be persisted with the mock-test record.

Acceptance criteria:

- Supervisor selected hints are saved.
- Supervisor notes are saved.
- Instructor view can display them.
- Learner progress can use them for "what to practise next".

Possible implementation options:

- Add JSONB columns to `mock_test_faults` or `mock_tests`.
- Add a new `mock_test_supervisor_notes` table.
- Reuse `notes` only for whole-test notes if a simple first pass is preferred.

## Phase 2: Simplify Learner Experience

Priority: high.

### 5. Reframe the Practice Hub

File:

- `public/learner/practice.html`

Current issue:

- The hub feels like software tooling, with labels such as `LOG`, `MOCK`, `FCS`, `TRK`.

Recommended cards:

- "Log a drive"
- "Practice with a supervisor"
- "Take a mock test"
- "View my driving plan"

Acceptance criteria:

- Copy feels learner-friendly.
- The supervisor option is not buried inside mock test.
- The primary route for non-instructor private practice is simple reflection, not formal marking.

### 6. Rework Log Session

Files:

- `public/learner/log-session.html`
- `public/learner/log-session.js`

Current issue:

- D/S/X fault counters are exposed in a learner self-log.

Recommended change:

- Default learner logging should use traffic-light ratings only:
  - Needs work
  - Getting there
  - Confident
- Move fault counters into an "Advanced / instructor notes" section or remove from learner default.

Acceptance criteria:

- A learner can log a drive in under one minute.
- No formal fault terminology appears by default.
- The final screen clearly says what changed in the learner plan.

### 7. Turn Progress Into a Driving Plan

Files:

- `public/learner/progress.html`
- `public/learner/progress.js`

Current issue:

- The page feels like a report: radar chart, mock breakdown, pass rate, most-faulted skills, practice level.

Recommended top-level sections:

1. "Practise next"
2. "Going well"
3. "Recent activity"
4. "Mock test results"
5. "Full skill breakdown" as an optional advanced section

Acceptance criteria:

- The first screen gives the learner 1-3 next actions.
- The page avoids unexplained percentages.
- Full DL25 breakdown is available but not dominant.
- Empty state gives a clear first action.

### 8. Rename Technical Copy

Current terms to soften:

- "Competency profile" -> "Driving plan"
- "DL25 profile" -> "Skill overview" or hide entirely
- "Practice level" -> "Practice score" or remove
- "Areas for Improvement" -> "Practise next"
- "Most-faulted skills" -> "Most useful areas to revisit"
- "Serious/Dangerous" -> instructor-only unless in formal mock-test mode
- "Dossier" -> remove from comments and user-facing UI where possible

Acceptance criteria:

- Learner-facing pages do not read like assessment paperwork.
- Instructor-only pages can keep technical language.

## Phase 3: Rebuild Supervisor Flow

Priority: medium-high.

### 9. Split Practice Drive From Mock Test

Current issue:

- Supervisor mode lives inside the mock-test flow.
- This makes private practice feel like a test.

Recommended structure:

- `focused-practice.html` becomes the main supervisor/private practice flow.
- `mock-test.html` becomes a formal assessment flow.

Possible routes:

- `/learner/practice-drive.html`
- `/learner/focused-practice.html` retained but renamed in UI
- `/learner/mock-test.html` reserved for instructor/full mock

Acceptance criteria:

- Supervisors are not asked to choose "who is marking?" for ordinary practice.
- The private-practice path starts with focus, not fault marking.
- The mock-test path remains available for formal assessment.

### 10. Make Supervisor Reflection Simpler

Files:

- `public/learner/focused-practice.html`
- `public/learner/focused-practice.js`
- `public/competency-config.js`

Recommended rating choices:

- Went well
- Needs practice
- Tell instructor

Recommended note prompts:

- "What happened?"
- "Where did it happen?"
- "Anything the instructor should know?"

Acceptance criteria:

- A supervisor can complete reflection without understanding DL25.
- Reflection is saved and visible later.
- "Tell instructor" becomes a high-signal flag.

### 11. Persist and Surface Supervisor Summaries

Files:

- `api/learner.js`
- `api/instructor.js`
- `public/instructor/learners.js`

Acceptance criteria:

- Instructor can see recent private-practice summaries.
- Learner can see them as part of recent activity.
- The system can highlight recurring supervisor concerns.

## Phase 4: Improve Instructor Value

Priority: medium.

### 12. Use Shared Labels in Instructor Learner View

File:

- `public/instructor/learners.js`

Current issue:

- Skill labels are generated with `skill_key.replace(/_/g, ' ')`.
- This risks internal keys leaking into the UI.

Acceptance criteria:

- Instructor view uses `CC_COMPETENCY.getSkill()` labels where available.
- Legacy keys are mapped through the shared competency map.
- Raw keys are only a last-resort fallback.

### 13. Add Instructor Teaching Summary

Files:

- `api/instructor.js`
- `public/instructor/learners.js`

Recommended summary:

- Latest mock result.
- Top 3 current focus areas.
- Last private-practice note.
- Upcoming test date.
- Recent trend: improving / steady / needs attention.

Acceptance criteria:

- Instructor does not have to inspect every session manually.
- The view answers "what should I do next lesson?"

### 14. Separate Instructor Assessment From Learner Reflection

Current issue:

- Learner self-assessment, supervisor practice, and instructor mock tests all write into overlapping progress concepts.

Recommended model:

- Learner reflection: confidence and notes.
- Supervisor practice: observed support needs.
- Instructor assessment: formal DL25 evidence.

Acceptance criteria:

- Progress page can explain where signals came from.
- Instructor view can filter by source.
- Learner is not over-penalised by informal self-ratings.

## Phase 5: Mock Test Cleanup

Priority: medium.

### 15. Keep Formal Mock Tests Instructor-Centric

Files:

- `public/learner/mock-test.html`
- `public/learner/mock-test.js`

Recommended change:

- Default copy should say this is a formal mock assessment.
- Supervisor path should be secondary or removed once Practice Drive exists.

Acceptance criteria:

- Mock test is clearly different from private practice.
- Formal pass/fail criteria remain accurate.
- Learners are not encouraged to self-administer a complex test casually.

### 16. Reassess Fault Map Feature

Current issue:

- Fault-map placement is complex.
- It appears not to persist.
- It may distract from the core learning loop.

Options:

- Remove it.
- Hide it behind instructor mode only.
- Persist pins properly and show them in instructor view.

Acceptance criteria if kept:

- Pins are saved.
- Pins are visible later.
- Pins help the instructor or learner take action.

## Phase 6: Reporting and Automation

Priority: later.

### 17. Weekly Progress Summary

Potential output:

- "This week you practised 2 times."
- "Your strongest area was Moving Off."
- "Next week, focus on Junctions and Mirrors."
- "Ask your instructor about: roundabouts / hesitation / lane position."

Audience:

- Learner.
- Optional parent/supervisor.
- Instructor summary.

### 18. Instructor Alerts

Potential alerts:

- Learner repeatedly flags same private-practice concern.
- Learner has test date soon but no recent mock.
- Learner has not practised/logged in for X weeks.
- Supervisor marked "Tell instructor".

## Suggested Build Order

1. Fix `school_id` writes and instructor query scoping.
2. Fix offline mock-test save trust.
3. Persist supervisor notes/hints.
4. Rename/reframe learner-facing copy.
5. Simplify Log Session and hide fault counters by default.
6. Rework Progress into "My Driving Plan".
7. Split Practice Drive from formal Mock Test.
8. Improve instructor learner view with shared labels and teaching summary.
9. Decide whether fault-map pins are removed or made persistent.
10. Add weekly summaries once the core data is trustworthy.

## Definition of Done

The system is in a good state when:

- A learner can open the progress area and immediately know what to practise next.
- A supervisor can complete a useful practice reflection without knowing DL25.
- An instructor can open a learner profile and understand what needs attention next lesson.
- Formal mock-test terminology only appears in formal assessment contexts.
- All saved progress is reliably tenant-scoped by `school_id`.
- No UI claims progress was saved unless the backend confirms it.
- Notes and observations that users enter are visible later in the places they matter.

## Key Files

- `public/competency-config.js`
- `public/learner/practice.html`
- `public/learner/log-session.html`
- `public/learner/log-session.js`
- `public/learner/focused-practice.html`
- `public/learner/focused-practice.js`
- `public/learner/mock-test.html`
- `public/learner/mock-test.js`
- `public/learner/progress.html`
- `public/learner/progress.js`
- `public/instructor/learners.js`
- `api/learner.js`
- `api/instructor.js`
- `db/migration.sql`
- `db/migrations/017_competency_system.sql`
- `db/migrations/019_subcategory_faults.sql`
