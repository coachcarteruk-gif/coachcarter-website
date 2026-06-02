# Marketing Map Guide

Marketing Map is a private founder workspace for turning the `$100M Leads` framework into CoachCarter marketing implementation ideas.

It is not part of the production website. It is a standalone local tool for thinking, mapping, prioritising, and tracking what parts of the lead-generation system have been translated into CoachCarter.

## Quick Start

From the repo root:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory internal/marketing-map
```

Then open:

```text
http://127.0.0.1:4173
```

If another local server is already running on port `4173`, use another port:

```powershell
python -m http.server 4174 --bind 127.0.0.1 --directory internal/marketing-map
```

Then open:

```text
http://127.0.0.1:4174
```

## What It Is For

Use Marketing Map to answer:

- Which parts of the book have I not implemented yet?
- Which marketing ideas map naturally onto CoachCarter?
- What should I work on next?
- What website, product, content, referral, outreach, or measurement ideas are connected?
- Where am I still just thinking, and where have I started executing?

The tool is intentionally manual. It does not generate ideas for you or make decisions for you. It gives you a structured place to think, record, connect, and choose.

## The Core Mental Model

Marketing Map has three layers:

1. **Areas**
   Big implementation areas such as Lead Magnets, Referrals, Paid Ads, Free Content, Measurement, and More Better New.

2. **Concepts**
   Book-derived concepts underneath each area. These explain the marketing principle in practical terms.

3. **Ideas**
   Concrete CoachCarter implementation possibilities. These are the things you might actually build, write, test, automate, or track.

The aim is not to perfectly recreate the book. The aim is to turn the book into a working CoachCarter lead engine map.

## Main Screen

The screen has three main zones:

- **Map canvas** on the left
- **Inspector panel** in the middle/right
- **Work Next queue** on the far right

### Map Canvas

The map shows the marketing system as connected nodes.

Use it to:

- see the whole system at once
- move between implementation areas
- spot related ideas
- understand how channels connect
- avoid thinking about marketing as a flat checklist

Controls:

- **Click a node** to inspect it.
- **Drag the canvas** to pan around.
- **Use the mouse wheel** to zoom in and out.
- **Reset view** returns the map to a readable default position.

### Inspector Panel

The inspector shows details for the selected node.

Depending on what you select, it can show:

- summary
- status
- notes
- book coverage
- guided journal prompts
- related concepts
- implementation ideas
- checklists
- focus controls
- connection controls

This is where most of the thinking and editing happens.

### Work Next Queue

Work Next is your manual priority list.

Use it for the ideas you currently want to rise above the map noise.

It is intentionally simple:

- Add an idea to Work Next.
- Move it up or down.
- Open it quickly.
- Remove it when it is no longer a focus.

This is not an automated scoring system. It is your founder judgement made visible.

## Detail Modes

The **Detail** dropdown changes what appears on the map.

### Areas

Shows only the main implementation areas.

Best for:

- orienting yourself
- deciding which broad part of the lead engine to think about
- avoiding clutter

This is the default view.

### Concepts

Shows areas plus the book-derived concepts under them.

Best for:

- checking framework coverage
- understanding what an area contains
- spotting missing implementation work

### Selected Ideas

Shows ideas around the selected area or concept.

Best for:

- drilling into one area
- seeing concrete CoachCarter implementation options
- choosing what to add to Work Next

## Statuses

Each area, concept, idea, or thought can have a status:

- **Not started**
- **In progress**
- **Implemented**
- **Needs measurement**

Suggested meaning:

### Not Started

You have not done meaningful implementation work yet.

This can still contain notes, prompts, or rough ideas. It just means the thing has not moved into execution.

### In Progress

You are actively exploring, designing, writing, building, or testing it.

This is useful for ideas that are alive but not finished.

### Implemented

The idea exists in some real form.

It could be a shipped website feature, written content, an outreach process, a referral flow, or a working measurement habit.

### Needs Measurement

The thing exists, but you do not yet know whether it worked.

This is especially useful for:

- lead magnets
- CTAs
- ads
- referral asks
- content campaigns
- follow-up flows

## Guided Journal Prompts

Many areas and concepts include prompts.

These are there to help you translate the book into CoachCarter-specific thinking.

Example:

```text
What could CoachCarter give a learner before they book that is genuinely useful?
```

Use prompt answers for rough thinking. They do not need to be polished.

A good workflow:

1. Open an area.
2. Read the prompts.
3. Answer quickly and honestly.
4. Turn promising answers into implementation ideas.
5. Add the strongest idea to Work Next.

## Notes

Every area, concept, idea, and loose thought has a notes field.

Use notes for:

- messy thinking
- assumptions
- open questions
- links to related files
- why something matters
- what you might try next
- what you learned after testing

Notes save automatically in your browser.

## Implementation Ideas

Ideas are the practical layer of the map.

Examples:

- Driving lesson cost calculator
- First lesson prep checklist
- Referral ask after lesson milestone
- Paid ads readiness checklist
- Learner question content library
- Lead source tracking field

Ideas can have:

- status
- tags
- notes
- checklist items
- Work Next position
- map connections

## Adding Ideas

You can add implementation ideas from an area or concept.

Suggested workflow:

1. Click an area, such as **Lead Magnets**.
2. Review its concepts and prompts.
3. Add an implementation idea.
4. Open the new idea.
5. Add notes and checklist items.
6. Add it to Work Next if it becomes a real focus.

Ideas added under a concept are more specific. Ideas added under an area are broader.

## Checklists

Each idea can have a simple checklist.

Use checklists for small execution steps, not full project management.

Good checklist items:

- Define calculator inputs
- Sketch result screen
- Write CTA copy
- Add source tracking
- Review after one week

Avoid turning checklists into giant task plans. If an idea becomes large enough to need project management, it may deserve a separate implementation plan elsewhere.

## Loose Thoughts

Use **Add thought** for ideas that do not fit anywhere yet.

Loose thoughts are useful for:

- half-formed ideas
- interesting connections
- questions to revisit
- things you do not want to lose

Example:

```text
Could learner progress reports become a referral trigger?
```

Later, you can connect that thought to areas such as Referrals, Follow-up, Measurement, or Website CTAs & Capture.

## Connections

Connections show how areas and ideas relate.

Some connections are preloaded, such as:

- Audience & Problem -> Lead Magnets
- Lead Magnets -> Website CTAs & Capture
- Paid Ads -> Lead Magnets
- Referrals -> Partners & Lead Getters
- Measurement -> More Better New

You can also add manual connections from the inspector.

Use manual connections when you notice:

- one idea supports another
- one implementation depends on another
- one node creates a useful feedback loop
- a loose thought belongs near an area

## Search And Filters

### Search

Use search to find:

- areas
- concepts
- ideas
- tags
- keywords in summaries

Search is useful once the map has more custom ideas.

### Status Filter

Use the status filter to show only nodes at a certain stage.

Useful examples:

- Show only **Not started** to see missing coverage.
- Show only **In progress** to see current active work.
- Show only **Needs measurement** to see what should be reviewed.

## Import And Export

Marketing Map stores your edits in browser `localStorage`.

That means your state is private and local to your browser profile.

The app saves:

- statuses
- notes
- guided journal answers
- custom ideas
- loose thoughts
- manual links
- checklist changes
- Work Next order
- last selected item
- map pan and zoom

### Export State

Use **Export state** to download a JSON backup.

Do this when:

- you have made meaningful updates
- you want to preserve a snapshot
- you want to move state to another browser
- you want Codex to inspect or edit the state later

### Import State

Use **Import** to restore a previously exported state file.

Import replaces the current local state with the imported state.

## Recommended Weekly Workflow

Use this if you want a simple rhythm.

### 1. Start With Areas View

Open the map in **Areas** mode.

Ask:

```text
Which part of the lead engine feels weakest or most interesting right now?
```

### 2. Drill Into One Area

Click the area and switch to **Concepts** or **Selected Ideas**.

Do not try to work on the whole map at once.

### 3. Answer The Prompts

Use the guided journal prompts to clarify your thinking.

Write rough answers. The goal is momentum, not polish.

### 4. Turn Thinking Into Ideas

Create or open implementation ideas.

Add notes and checklist items.

### 5. Choose Work Next

Add one to three ideas to Work Next.

Move the most important one to the top.

### 6. Execute Elsewhere If Needed

If an idea becomes real implementation work, build it in the appropriate part of the repo or create a separate plan.

Marketing Map is the thinking and prioritisation layer, not the entire delivery system.

### 7. Come Back To Measure

When something is live, mark it **Needs measurement**.

After reviewing results, mark it:

- **Implemented** if it is good enough
- **In progress** if it needs iteration
- **Not started** only if you decide to reset it

## Suggested First Session

For the first serious use, try this:

1. Open **Lead Magnets**.
2. Answer the guided prompts.
3. Open **Small useful outcome**.
4. Compare the preloaded ideas:
   - Driving lesson cost calculator
   - First lesson prep checklist
   - Driving test readiness quiz
5. Pick the most exciting one.
6. Add it to Work Next.
7. Add checklist items for the first version.
8. Connect it to **Website CTAs & Capture** and **Measurement** if useful.

This gives you a complete loop:

```text
Book concept -> CoachCarter idea -> next action -> measurement
```

## Current Preloaded Areas

The first version includes:

- Audience & Problem
- Lead Magnets
- Website CTAs & Capture
- Warm Outreach
- Free Content
- Cold Outreach
- Paid Ads
- Referrals
- Partners & Lead Getters
- Measurement
- More Better New

Each area includes book-derived concepts, prompts, and CoachCarter implementation ideas where there is an obvious fit.

## Editing The Framework

The preloaded framework lives in:

```text
internal/marketing-map/data/framework.js
```

Edit this file if you want to change:

- top-level areas
- concept summaries
- prompts
- preloaded ideas
- preloaded checklist items
- preloaded system links

Your personal state is not stored in this file. It is stored in browser `localStorage` unless exported.

## Files

```text
internal/marketing-map/
  index.html
  styles.css
  app.js
  data/framework.js
  README.md
```

## Limitations In V1

This is the functional first version.

Current limitations:

- Node positions are auto-laid out, not manually draggable.
- State saves to browser `localStorage`, not directly to a repo file.
- It does not include AI-assisted suggestions.
- It does not sync across browsers unless you export/import state.
- It is not connected to live CoachCarter analytics.

These are deliberate constraints to keep the tool simple and useful while the structure is still evolving.

## Good Ways To Extend It Later

Possible V2 upgrades:

- draggable node positions
- save state directly to a JSON file through a tiny local server
- richer import/export snapshots
- custom node colours or categories
- lightweight experiment log
- links to real CoachCarter files/pages/features
- measurement dashboard fed by actual data

Do not add these until the core map has proved useful.

## Troubleshooting

### The page is blank

Make sure you are serving the folder over HTTP rather than opening `index.html` directly.

Use:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory internal/marketing-map
```

Then open:

```text
http://127.0.0.1:4173
```

### My notes disappeared

Check whether you are using the same browser profile and same local URL.

Browser `localStorage` is tied to the origin, so these are different storage locations:

```text
http://127.0.0.1:4173
http://localhost:4173
http://127.0.0.1:4174
```

Use one URL consistently.

### I want to back up my work

Click **Export state** and keep the downloaded JSON file.

### I imported the wrong state

If you have a previous export, import that file again.

If not, the browser state has been replaced.

## Practical Rule

Use the map to think, but use Work Next to act.

The map can be broad and non-linear. Work Next should stay short.
