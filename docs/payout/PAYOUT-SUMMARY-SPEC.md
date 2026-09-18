# Instructor Payout Summary — Design & Implementation Spec

**For:** CoachCarter / DrivePro
**Purpose:** Generate the weekly instructor payout summary image directly from lesson
data, replacing the current manual process.
**Status:** Design is settled and in production use. One calculation rule is
unresolved — see [Open decision](#open-decision-stripe-fixed-fee).

---

## 1. What this replaces

Every week an instructor payout summary is currently assembled by hand: lessons are
typed out, rates applied manually, totals added up, and a portrait PNG produced for
sending over WhatsApp. Five weeks of doing this by hand surfaced repeated errors that
a generated version removes entirely:

- lesson durations logged wrong (a 1 hr lesson recorded as 1.5 hr, overpaying £24.17)
- the same pupil billed at two different hourly rates in the same week
- the same lesson length producing four different amounts across four weeks
  (£72.86 / £72.95 / £72.96 / £73.02) purely from rounding order
- pennies drifting because the rate was rounded *before* being multiplied by hours

**The single most important rule in this spec:** compute from the pupil's price and
the lesson's duration every time. Never store a derived hourly payout rate and
multiply it up. That is the direct cause of most of the errors above.

---

## 2. Data required

The generator needs the following per instructor, per pay week.

### 2.1 Pay week boundary

Weeks run **midday Friday to midday Friday**. This is not a calendar week — a lesson
at 11:00 on Friday belongs to the closing week, one at 13:00 to the opening week.
Boundaries must be evaluated in **Europe/London** local time so BST/GMT transitions
don't shift lessons between weeks.

### 2.2 Per lesson

| Field | Type | Notes |
|---|---|---|
| `lesson_id` | id | for reconciliation and dedupe |
| `starts_at` | timestamptz | drives day grouping and week assignment |
| `duration_hours` | numeric(3,2) | 1.00, 1.50, 2.00 — the source of truth, not a label |
| `pupil_id` / `pupil_name` | — | display name as the instructor knows them |
| `instructor_id` | — | |
| `status` | enum | only `completed` lessons are payable |
| `is_free_trial` | bool | |
| `payment_method` | enum | `stripe` \| `direct` \| `package` \| `cash` |
| `pupil_hourly_price` | numeric(6,2) | what the pupil pays per hour (see 2.3) |
| `transaction_count` | int | how many Stripe charges this lesson was paid across |

### 2.3 Pupil price

Pupil price is **not** a global constant. Current tiers:

- £55.00/hr pay-as-you-go
- £54.00/hr on a 15-hour package
- £53.00/hr on a 30-hour package

Resolve the price from the pupil's actual purchase record, not from a default. Two
pupils in the same week legitimately sit on different prices, and that is the only
acceptable reason for their payouts to differ.

### 2.4 Per instructor, per week

| Field | Notes |
|---|---|
| `share_rate` | Instructor's cut. Currently 0.90 |
| `franchise_fee` | Currently £90.00/week. Must be a dated, versioned value — it changes during onboarding ramps |
| `free_trial_rate` | Currently £30.00/hr flat |

Franchise fee and share rate must be **effective-dated**, so regenerating an old week
reproduces that week's figures rather than today's.

---

## 3. Payout calculation

### 3.1 Order of operations

```
gross        = pupil_hourly_price × duration_hours
stripe_fee   = (gross × 0.015) + (0.20 × transaction_count)   # stripe only
net          = gross − stripe_fee
payout       = truncate_2dp(net × share_rate)
```

Rules:

1. **Truncate, do not round.** `floor(x × 100) / 100`. Confirmed by the business owner.
2. **Truncate once, at the end.** Never truncate an intermediate hourly rate.
3. **Free trials bypass the formula entirely:** `payout = free_trial_rate × duration_hours`.
   No Stripe deduction, no share applied — the pupil paid nothing.
4. **`direct` payments take no Stripe fee.** Pupil paying straight to the bank at £55/hr
   yields £49.50/hr.
5. **`package` lessons** use the package's per-hour price. If the package was paid in one
   up-front charge, the Stripe fee was taken on that charge, not on each lesson drawn
   from it — so no fee is deducted per lesson.
6. **Keep "was there a Stripe fee at all" separate from "how many charges".** A direct
   bank payment takes *neither* the 1.5% nor the 20p. Modelling it as "zero fixed fees"
   still wrongly deducts the percentage and silently underpays — £48.75 instead of
   £49.50 per hour. Use a boolean for the former and a count for the latter.

### 3.2 Expected values (regression fixtures)

At £55.00/hr, share 0.90, `transaction_count = 1`:

| Duration | Gross | Stripe fee | Payout |
|---|---|---|---|
| 1.0 hr | £55.00 | £1.0250 | **£48.57** |
| 1.5 hr | £82.50 | £1.4375 | **£72.95** |
| 2.0 hr | £110.00 | £1.8500 | **£97.33** |

Direct payment, no fee:

| Duration | Payout |
|---|---|
| 1.0 hr | **£49.50** |
| 1.5 hr | **£74.25** |
| 2.0 hr | **£99.00** |

Free trial: **£30.00** per hour.

Package rates currently in use: Giovanni £46.77/hr, Esha £46.77/hr, Viba £48.35/hr,
Lily £47.00/hr. A 1.5 hr lesson at £46.77/hr is **£70.15** (70.155 truncated).

### 3.3 Week totals

```
subtotal_owed  = Σ payout
deductions     = franchise_fee (+ any other instructor-owed lines)
net_payable    = subtotal_owed − deductions
```

---

## 4. Open decision: Stripe fixed fee

**This must be settled before the generator is trusted.**

Stripe charges 1.5% + 20p **per charge**. The question is how many charges a multi-hour
lesson actually generates in the current platform.

| Interpretation | 1.5 hr payout |
|---|---|
| One charge per lesson (20p once) | £72.95 |
| Fixed fee pro-rated across hours (20p × 1.5) | £72.86 |
| Two charges, 1 hr + 0.5 hr (20p each) | £72.77 |

Historic sheets contain both £72.86 and £72.95, so the two most recent weeks are not on
the same basis. **Resolve empirically**: pull the real Stripe balance transaction for a
known 1.5-hour booking and read the actual fee. If it is £1.4375, one charge; if
£1.6375, two charges. £1.5375 would mean the platform is pro-rating a fixed fee, which
is not how Stripe bills and would be a bug in the fee model rather than a rate choice.

The `transaction_count` field exists so the answer is data, not a hardcoded assumption.
Set it from the actual count of Stripe charges linked to the lesson.

---

## 5. Validation — run before rendering

These checks exist because each one caught a real error in a hand-built sheet.

| Check | Action |
|---|---|
| Same pupil, two different `pupil_hourly_price` values in one week | **Block** — genuine tier changes should be dated, not concurrent |
| Duration not in {0.5, 1.0, 1.5, 2.0, 2.5, 3.0} | **Warn** |
| Same pupil, same day, total > 2.5 hr | **Warn** — possible duplicate entry |
| Lesson `status != completed` | **Exclude** |
| Free trial with a non-zero pupil price | **Warn** |
| Duplicate `lesson_id` | **Block** |
| Recomputed subtotal ≠ Σ of rendered line amounts | **Block** — totals must reconcile exactly |
| Pupil appearing for the first time with no price record | **Block** — never silently default to £55 |

Surface warnings to the operator before the image is generated, not after it has been
sent to the instructor.

---

## 6. Visual design

Portrait PNG for WhatsApp. Keep this exactly — it is the established look.

### 6.1 Canvas

- Width **1080 px** fixed. Height variable, cropped to content.
- Background `#F7F6F4`
- Render at 1× (1080 wide is already retina-adequate for messaging apps)

### 6.2 Colour tokens

| Token | Hex | RGB | Use |
|---|---|---|---|
| `charcoal` | `#272727` | 39, 39, 39 | Header band, net card, row amounts |
| `orange` | `#F58321` | 245, 131, 33 | Brand accent, deductions, net card label |
| `green` | `#1A9E5C` | 26, 158, 92 | Earnings accent, subtotal |
| `bg` | `#F7F6F4` | 247, 246, 244 | Page background |
| `white` | `#FFFFFF` | 255, 255, 255 | Card fill |
| `muted` | `#7A7A7A` | 122, 122, 122 | Secondary text, sub-labels |
| `body` | `#555555` | 85, 85, 85 | Row description text |
| `line` | `#E2E0DC` | 226, 224, 220 | Row dividers |
| `header_sub` | `#B2B2B2` | 178, 178, 178 | Subtitle on dark band |

Semantic rule: **green is money owed to the instructor, orange is money owed to the
business.** Never mix. If an amber/warning state is ever added, it must not reuse the
brand orange.

### 6.3 Typography

Two families, both Google Fonts (SIL OFL, free to embed):

- **Bricolage Grotesque** — display only. Variable font; use `opsz 96, wght 800, wdth 100`
- **Lato** — everything else. Regular / Bold / Black

| Element | Font | Size | Colour | Tracking |
|---|---|---|---|---|
| Eyebrow (`COACHCARTER DRIVING SCHOOL`) | Lato Bold | 26 | orange | +4 px |
| Title lines | Bricolage 800 | 72 | white | 0 |
| Header subtitle | Lato Regular | 30 | header_sub | 0 |
| Section label | Lato Black | 27 | accent | +3 px |
| Row date | Lato Bold | 29 | charcoal | 0 |
| Row description | Lato Regular | 29 | body | 0 |
| Row sub-note (rate) | Lato Regular | 22 | muted | 0 |
| Row amount | Lato Bold | 33 | charcoal | 0 |
| Subtotal label | Lato Bold | 29 | muted | 0 |
| Subtotal amount | Lato Black | 42 | accent | 0 |
| Net label | Lato Black | 28 | orange | +3 px |
| Net amount | Lato Black | 92 | white | 0 |
| Net working | Lato Regular | 28 | `#A0A0A0` | 0 |
| Footer | Lato Regular | 26 | muted | 0 |

Letter-spacing is applied by drawing character by character — most image libraries have
no native tracking. In HTML/CSS use `letter-spacing` directly.

**Never set currency in Bricolage.** Its `£` glyph renders poorly at large sizes. All
money uses Lato Black. This was a real defect found in testing.

### 6.4 Layout

```
┌──────────────────────────────────────┐
│ ████ orange rule, 14 px             │
│                                      │  header band
│  EYEBROW                             │  charcoal, 330 px tall
│  Title line 1                        │
│  Title line 2                        │
│  Instructor · date range             │
├──────────────────────────────────────┤
│  ┃ EARNINGS CARD        green spine  │
│  ┃ date  description        amount   │
│  ┃       rate note                   │
│  ┃ ─────────────────────────────     │
│  ┃ Subtotal                 £X.XX    │
│                                      │
│  ┃ DEDUCTIONS CARD     orange spine  │
│                                      │
│  ███ NET CARD — charcoal ███         │
│  NET PAYABLE     £X.XX    working    │
│                                      │
│  footer: period · lessons · hours    │
└──────────────────────────────────────┘
```

Measurements:

| Property | Value |
|---|---|
| Header band height | 330 px |
| Top orange rule | 14 px |
| Header text left margin | 60 px |
| Card gutter (left/right) | 48 px |
| Card inner padding | 40 px |
| Card corner radius | 26 px |
| Accent spine | 12 px wide, radius 6, full card height |
| Section header height | 92 px |
| Row height | 74 px |
| Description column offset | 200 px from card padding |
| Divider | 2 px, inset by card padding |
| Space below section header to first row | 92 px |
| Space after last row to subtotal | 88 px |
| Gap between cards | 40 px |
| Gap before net card | 48 px |
| Net card height | 210 px |
| Bottom padding after footer | 92 px |

Rows with a sub-note shift the description up 6 px and place the note 36 px below it.
Rows without a note are vertically centred.

### 6.5 Row content

- **Date** — `Fri 11 Sep`, abbreviated day and month, no year
- **Description** — `Pupil Name – 1.5 hr`, en dash with spaces
- **Sub-note** — the rate basis. `£48.57/hr`, `Free trial`,
  `Package rate £46.77/hr`, `Direct payment £49.50/hr`. This column is what lets the
  instructor reproduce the total themselves — it is not decorative, keep it
- **Amount** — right-aligned, always 2 dp, always with `£`

Rows are ordered chronologically, grouped by day, dates repeated on every row rather
than merged — merged cells read poorly at phone size.

### 6.6 Footer

`Midday Fri 11 – midday Fri 18 September 2026 · 17 lessons · 22 hours`

State the midday boundary explicitly. It pre-empts the most common instructor query.

---

## 7. Growth and layout limits

Observed range so far: 6 to 22 lessons per week, producing images 1600–2900 px tall.
Rows are added without any layout reflow, so the design scales linearly.

Above roughly **28 rows** the image becomes awkward to read on a phone. At that point,
either group by day with a day sub-header (saving the repeated date column) or paginate
by week half. Do not shrink the row height — legibility at arm's length on a phone is
the governing constraint.

---

## 8. Implementation notes

Either approach preserves the design:

**HTML + headless render.** Recreate the tokens as CSS custom properties and render to
PNG via Playwright. Best if the summary should also be viewable in-app as a web page.
Watch: font loading must complete before capture, and `letter-spacing` must be set
explicitly.

**Server-side image composition.** Direct port of the reference renderer. Fewer moving
parts, no browser dependency. Fonts must be bundled with the deploy, not
system-resolved.

Recommendation: **HTML render**, because the same markup then serves an in-app
"my earnings" view for instructors, which removes the manual send entirely.

### Output

- Filename `payout-{instructor-slug}-{week-start:YYYY-MM-DD}.png`
- Also emit the underlying JSON (lesson lines + totals) alongside the image, so a
  disputed figure can be traced to lesson IDs without regenerating anything

### Testing

Regression-test against the fixtures in §3.2 plus at least one full historic week.
The week of 11–18 Sep 2026 totals **£1,008.96** gross, **£918.96** net after the £90
franchise fee, across 17 lessons and 22 hours — a good end-to-end fixture.

---

## 9. Summary of business rules

1. Pay week is midday Friday to midday Friday, Europe/London.
2. Only completed lessons are payable.
3. Payout = truncate((pupil_price × hours) − stripe_fee) × share).
4. Truncate to the penny, once, at the end.
5. Free trials pay a flat hourly rate with no deductions.
6. Direct bank payments take no Stripe fee.
7. Pupil price comes from their purchase record, never a default.
8. Franchise fee and share rate are effective-dated.
9. Every rendered total must reconcile exactly to the sum of its lines.
