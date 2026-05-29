# Agent Workflow Prompts

This folder contains copy-paste ready prompts for running CoachCarter roadmap work with low context bloat.

The intended hierarchy is:

```text
Director -> Prompt Maker -> Code Worker -> optional Reviewer -> Director -> Merge Operator -> Director
```

Use `docs/planned-work-register.md` as the central roadmap source of truth. These prompts keep strategy, prompt creation, implementation, review, and merge mechanics separate so each session has a narrow job.

## When To Use Each Role

| Role | Use When | Main Output | Must Not Do |
|---|---|---|---|
| Director | Choosing what to build next or updating roadmap status | Slice brief, roadmap update, merge readiness decision | Generate code-worker prompts or implement code |
| Prompt Maker | Turning one approved slice brief into an implementation prompt | One scoped Code Worker prompt | Choose strategy, edit code, or merge |
| Code Worker | Implementing one scoped slice | Code changes, tests, completion report | Expand scope, merge, or update roadmap status as fact |
| Reviewer | Checking a completed implementation | Review findings and merge recommendation | Rewrite the feature wholesale or merge |
| Merge Operator | Performing an approved merge | Merge result and post-merge status | Approve their own merge decision |

## Recommended Flow

1. Run the Director prompt with `docs/planned-work-register.md`.
2. Director chooses one next slice and produces a slice brief.
3. Run the Prompt Maker prompt with that slice brief.
4. Prompt Maker creates a scoped Code Worker prompt.
5. Run the Code Worker prompt in a fresh implementation session.
6. For P0/P1 work, run Reviewer before merging.
7. Director decides whether the work is ready to merge.
8. Merge Operator performs the mechanical merge checklist.
9. Director updates `docs/planned-work-register.md` after the work is genuinely shipped.

## Handoff Rule

Every role must end with a labelled handoff block:

```text
## Handoff To [Next Role]
```

The handoff must be copy-paste ready for the next role in the chain. It should contain only the context the next role needs to act safely. The role may also include notes for the current user, but the handoff block should be clean, self-contained, and ready to paste into the next session.

For P0/P1 money, credit, refund, payout, auth, tenancy, GDPR, or database work, handoffs must preserve the risk class and reviewer requirement. Do not let those safety requirements disappear as work moves between roles.

## P0/P1 Safety Rule

For money, credit, refund, payout, auth, tenancy, GDPR, or database changes:

- Code Worker must not merge.
- Reviewer is required.
- Director must explicitly approve merge readiness.
- Merge Operator must run the merge checklist.

## Context Discipline

Each role should load only what it needs:

- Director: `AGENTS.md`, `docs/planned-work-register.md`, and one or two relevant planning docs.
- Prompt Maker: Director slice brief, `AGENTS.md`, and relevant file/doc references named in the brief.
- Code Worker: generated prompt, `AGENTS.md`, and files needed for the implementation.
- Reviewer: PR/diff, test output, `AGENTS.md`, and relevant docs.
- Merge Operator: PR status, CI status, branch state, and Director approval.

Do not make every role re-read the whole repository.

