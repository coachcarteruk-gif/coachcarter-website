# Driving curriculum progress prototype

## Purpose

This turns the four-page **Driving Curriculum** PDF into a manageable first version of a shared learner/instructor tracker.

The curriculum is split into:

1. **Setup and safety checks** — completed once and not scored.
2. **Practical competencies** — scored separately by the learner and instructor.
3. **Test preparation** — tracked like a skill for the prototype, with richer mock-test records added later.

The accompanying [`driving-curriculum-progress-template.csv`](driving-curriculum-progress-template.csv) is a flat, editable version of the same curriculum.

## Prototype scoring

| Score | Display label | Simple guide |
|---|---|---|
| 1 | Needs support | Requires regular instruction, prompting or intervention. |
| 2 | Developing | Can sometimes do it independently but is inconsistent or still needs occasional prompts. |
| 3 | Independent | Performs it safely and consistently without prompting. |
| Not assessed | Blank / `null` | No judgement has been recorded yet. This must not be treated as a score of 1. |

The scale is deliberately lightweight. The learner records confidence and the instructor records observed performance. Keep those two judgements side by side; do **not** average them into one score. A difference between them is useful discussion material.

For compatibility with the current CoachCarter competency model, the stored score can continue to map to the existing rating keys:

| Numeric score | Existing key |
|---|---|
| 1 | `struggled` |
| 2 | `ok` |
| 3 | `nailed` |

## 0. Getting ready

These are onboarding/compliance confirmations, not learner competencies. A mastery score would be misleading.

| ID | Completion check |
|---|---|
| SET-01 | Driving licence checked and photograph confirmed as matching the learner. |
| SET-02 | Learner meets the minimum eyesight requirement. |
| SET-03 | Lesson rules agreed, including expectations such as cancellation notice. |

## 1. Vehicle setup and safety checks

These are completion checks. Mark them done once the subject has been properly covered with the learner; do not assign learner or instructor scores.

| ID | Completion check | Existing skill key |
|---|---|---|
| VEH-01 | Identify the location and explain the function of the vehicle controls. | `control` |
| VEH-02 | Check that the doors are secure. | `control` |
| VEH-03 | Adjust the seat for safe, comfortable control. | `control` |
| VEH-04 | Set an appropriate steering-wheel position. | `control` |
| VEH-05 | Adjust the mirrors correctly. | `control` |
| VEH-06 | Carry out POWDERS vehicle checks. | `control` |
| VEH-07 | Answer and demonstrate the “show me, tell me” vehicle-safety questions. | Supplementary |

## 2. Moving off and stopping

| ID | Competency detail | Existing skill key |
|---|---|---|
| MOVE-01 | Choose a safe, legal and appropriate place to pull up. | `positioning` |
| MOVE-02 | Stop an appropriate distance from the kerb. | `positioning` |
| MOVE-03 | Prepare the vehicle before moving off. | `move_off` |
| MOVE-04 | Make effective observations before moving off. | `move_off` |
| MOVE-05 | Move away safely using the Prepare–Observe–Move routine. | `move_off` |
| MOVE-06 | Move off safely uphill. | `move_off` |
| MOVE-07 | Move off safely downhill. | `move_off` |
| MOVE-08 | Carry out a controlled emergency stop. | `manoeuvres` |

## 3. Core driving process — Mirrors, Signal, Position, Speed, Look

| ID | Competency detail | Existing skill key |
|---|---|---|
| CORE-01 | Select the correct mirrors, check them at the right time and understand why the check is needed. | `mirrors` |
| CORE-02 | Decide when a signal is necessary and when it would be unnecessary or misleading. | `signals` |
| CORE-03 | Maintain a normal driving position and choose an appropriate position at junctions or when circumstances change. | `positioning` |
| CORE-04 | Choose an appropriate speed and be able to stop within the distance that can be seen to be clear. | `positioning` |
| CORE-05 | Decide when it is safe to proceed from other road users’ signals, position and speed. | `judgement` |

## 4. T-junctions

| ID | Competency detail | Existing skill key |
|---|---|---|
| TJUN-01 | Turn left from a minor road into a major road. | `junctions` |
| TJUN-02 | Turn right from a minor road into a major road. | `junctions` |
| TJUN-03 | Turn left from a major road into a minor road. | `junctions` |
| TJUN-04 | Turn right from a major road into a minor road. | `junctions` |

## 5. Roundabouts

| ID | Competency detail | Existing skill key |
|---|---|---|
| RNDB-01 | Approach and turn left at a roundabout. | `junctions` |
| RNDB-02 | Approach and follow the road ahead at a roundabout. | `junctions` |
| RNDB-03 | Approach and turn right at a roundabout. | `junctions` |
| RNDB-04 | Use mini-roundabouts safely. | `junctions` |
| RNDB-05 | Select and maintain the correct lane on multi-lane roundabouts. | `junctions` |

## 6. Crossroads

| ID | Competency detail | Existing skill key |
|---|---|---|
| CROSS-01 | Turn left from a minor road into a major road at a crossroads. | `junctions` |
| CROSS-02 | Turn right from a minor road into a major road at a crossroads. | `junctions` |
| CROSS-03 | Turn left from a major road into a minor road at a crossroads. | `junctions` |
| CROSS-04 | Turn right from a major road into a minor road at a crossroads. | `junctions` |
| CROSS-05 | Follow the road ahead through a crossroads. | `junctions` |

## 7. Higher-speed and rural roads

| ID | Competency detail | Existing skill key |
|---|---|---|
| ROAD-01 | Merge onto a dual carriageway from a slip road. | `judgement` |
| ROAD-02 | Leave a dual carriageway using a slip road. | `positioning` |
| ROAD-03 | Overtake slower-moving vehicles safely. | `judgement` |
| ROAD-04 | Understand when and how to use an emergency area. | `signs_signals` |
| ROAD-05 | Use location markers and emergency telephones when needed. | `signs_signals` |
| ROAD-06 | Adapt to country lanes with changing speeds and widths. | `positioning` |
| ROAD-07 | Leave enough space when stopping behind another vehicle to see its tyres and the road surface. | `positioning` |
| ROAD-08 | Use limit points to choose an appropriate speed and position. | `judgement` |

## 8. Manoeuvres

| ID | Competency detail | Existing skill key | Current GB test relevance |
|---|---|---|---|
| MAN-01 | Reverse into a parking bay and drive out. | `manoeuvres` | Current test exercise |
| MAN-02 | Drive forwards into a parking bay and reverse out. | `manoeuvres` | Current test exercise |
| MAN-03 | Parallel park at the side of the road. | `manoeuvres` | Current test exercise |
| MAN-04 | Pull up on the right, reverse and rejoin traffic safely. | `manoeuvres` | Current test exercise |
| MAN-05 | Reverse around a corner. | `manoeuvres` | General driving skill; not a current GB test exercise |
| MAN-06 | Turn the vehicle around in the road. | `manoeuvres` | General driving skill; not a current GB test exercise |

## 9. Broader safety and driving experience

| ID | Competency detail | Existing skill key |
|---|---|---|
| SAFE-01 | Deal safely with automated traffic-control systems. | `signs_signals` |
| SAFE-02 | Approach and use pedestrian crossings safely. | `positioning` |
| SAFE-03 | Adapt driving to different weather conditions. | `positioning` |
| SAFE-04 | Demonstrate a safe, patient and considerate driving attitude. | `judgement` |
| SAFE-05 | Explain what to do after being involved in a collision. | Supplementary |
| SAFE-06 | Respond safely when stopped by the emergency services. | `signs_signals` |

## 10. Independent driving and test preparation

| ID | Competency detail | Existing skill key |
|---|---|---|
| TEST-01 | Drive independently by following a sat nav. | `signs_signals` |
| TEST-02 | Drive independently by following road signs. | `signs_signals` |
| TEST-03 | Apply skills safely on test-style routes without relying on route memorisation. | `progress` |
| TEST-04 | Complete a mock driving test at an appropriate standard. | Supplementary |

## Recommended first screen

Show one collapsed card per numbered section. Each card shows:

- section title and number of completed or assessed items;
- the latest learner score and latest instructor score for each detail;
- a colour chip for 1, 2 or 3, with an explicit **Not assessed** state;
- the most recent note and assessment date;
- a small history view rather than overwriting old ratings.

Avoid an overall percentage in the first prototype. The clearest summary is the count of skills at each level, plus the items most recently scored 1.

## How it gets used

### MVP boundary

For the first version, a curriculum assessment can only be created from a lesson booked in CoachCarter. There is no manual off-system lesson or private-practice entry. The booking supplies the learner, instructor, school and lesson date, so the instructor never selects or re-enters that context.

A past eligible booking has one lesson review with one of these states:

- **Review due** — the lesson has passed and no instructor review has been submitted.
- **Complete** — the instructor review has been submitted.
- **Learner reflection pending/complete** — tracked separately after the instructor chooses which skills were practised.

The instructor can complete a review immediately after the lesson or retrospectively from their past-lessons list. There is no requirement to finish it before leaving the lesson.

### 1. Initial setup

The instructor opens the learner's progress page and works through **Getting ready** and **Vehicle setup and safety checks**. Each item is marked **Done** once it has been checked, explained or demonstrated. These normally remain complete and do not need attention after every lesson.

### 2. Before a lesson

The instructor sees a short list of suggested focus items based on:

- the most recent skills scored 1;
- skills where learner and instructor scores differ;
- skills that have not been assessed yet;
- any item the instructor deliberately selects for the lesson.

The instructor chooses only the few skills that are likely to be covered. The whole curriculum is never presented as a form that must be completed after every lesson.

### 3. End-of-lesson instructor update

After the booked lesson, the instructor opens **Review lesson**, rates only the skills that were actually practised, adds an optional note, and saves. A typical lesson might update three to six items. If they do not have time immediately, the booking remains in their **Reviews due** list so they can complete it retrospectively.

### 4. Learner reflection

Once the instructor submits the lesson review, the learner receives a lightweight prompt containing the same practised items. They record their own 1–3 confidence score and can add a note. The learner never edits the instructor's score, and the instructor never overwrites the learner's score.

### 5. Shared progress view

Both users see the latest ratings side by side:

- **Learner** — “How confident do I feel?”
- **Instructor** — “How independently and consistently was it performed?”

Tapping an item shows its previous ratings, dates and notes. A score difference is shown as a conversation prompt rather than treated as a failure.

### 6. Next lesson

The next lesson starts with the previous focus areas and latest notes. Nothing is automatically marked mastered from a single score of 3; the history lets the instructor judge whether performance is consistent.

## Suggested assessment record

When this moves from the CSV prototype into the product, save ratings as events rather than columns on the curriculum item:

```json
{
  "school_id": 1,
  "learner_id": 42,
  "instructor_id": 7,
  "booking_id": 123,
  "curriculum_item_key": "RNDB-03",
  "skill_key": "junctions",
  "assessor_role": "learner",
  "score": 2,
  "note": "Comfortable on quiet roundabouts; lane choice still inconsistent.",
  "assessed_at": "2026-08-22T12:00:00Z"
}
```

The instructor submits a separate event with `assessor_role: "instructor"`. For the MVP, `booking_id` is required and its authenticated school, learner and instructor context must be resolved server-side rather than trusted from the client. Every query and record must retain `school_id` for tenant isolation.

## Integration notes

- `public/competency-config.js` remains the application’s single source of truth for the ten existing DL25 skill keys and the 1–3 rating mapping.
- The PDF adds lesson-level detail beneath those broad keys. If implemented, add stable curriculum item definitions to that shared configuration first rather than creating an unrelated runtime list.
- The existing product plan already recommends separating learner reflection from instructor assessment. This prototype follows that direction.
- A lesson review is created only for an eligible CoachCarter booking. Retrospective entry means selecting an existing past booking, not creating an unlinked session.
- The PDF’s duplicated “Seat” in the cockpit drill has been consolidated, and obvious wording issues such as “eye site” and “width’s” have been corrected without changing meaning.
- `MAN-05` and `MAN-06` are retained because they appear in the supplied curriculum, but they are not current GB practical-test reversing exercises. They may still be useful general driving skills. Current test relevance was checked against the [DVSA “What happens during the driving test” guidance](https://readytopass.campaign.gov.uk/driving-test/what-happens-during-driving-test/) on 22 August 2026.

## Live-beta implementation decisions (27 August 2026)

- `public/competency-config.js` now contains and CommonJS-exports all 61 stable definitions; the CSV/workbook remain design inputs only.
- The existing `driving_sessions` booking row is reused as the lesson header. Immutable `curriculum_review_submissions` revisions and `curriculum_rating_events` preserve edits/history; `curriculum_completion_events` holds the ten learner-level once-complete checks.
- A scheduled or chargeable booking is reviewable after its end time only when it is owned by the authenticated instructor, belongs to the same school, and is not `credit_forfeited`. Refunded/not-delivered rows are excluded. There is no retrospective expiry.
- Learner reflection requires a submitted instructor revision and exactly the practical items selected in that latest revision. A later instructor edit makes reflection due again.
- The exact-Boolean school gate is `config.features.curriculum_progress_beta === true`. Disabled reads return no surfaced work; disabled mutations fail closed.
- No mastery, average, global readiness percentage, reminders, mock-test integration, off-system lesson entry or money-state mutation was added.
