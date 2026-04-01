# CoachCarter: PWA to Native App Migration Plan (Revised)

## For use with Claude Code sessions — work through phases sequentially

---

## Current Architecture (Verified March 2026)

**Frontend:** 43 HTML pages (vanilla HTML/CSS/JS), no framework, no bundler, no build step
**Backend:** 29 Vercel serverless API route files, 100+ actions via `?action=X` routing
**Database:** Neon PostgreSQL, 26 tables, single idempotent migration file
**Auth:** JWT in localStorage, magic link login via SMS (Twilio) and email (SMTP/nodemailer)
**Payments:** Stripe Checkout sessions + webhook handler
**AI:** Direct Anthropic API calls (ask-examiner + advisor endpoints)
**Analytics:** PostHog (bypassed in service worker)
**Hosting:** Vercel (frontend + serverless), domain coachcarter.co.uk (also coachcarter.uk)
**PWA:** Service worker (cache-first shell, network-first API), manifest with maskable icons

### Verified Page Inventory

**Learner portal (15 pages):**
- index (dashboard), book, buy-credits, lessons, log-session, progress, mock-test, examiner-quiz, ask-examiner, advisor, videos, qa, profile, onboarding, login

**Instructor portal (6 pages):**
- index (calendar/dashboard), availability, learners, qa, profile, login

**Admin portal (4 pages):**
- dashboard, editor, portal, login

**Public pages (12 pages):**
- index (role selector), coachcarter-landing, classroom, availability, lessons, admin-availability, privacy, terms, success, maintenance, offline, demo/book

### Verified API Surface (30 route files, 100+ actions)

| File | Actions | Key notes |
|------|---------|-----------|
| learner.js | 20 | Core learner data — sessions, progress, profile, mock-tests, quiz, competency, onboarding, weekly availability |
| waitlist.js | 3 | Waiting list — join, my-waitlist, leave + internal checkWaitlistOnCancel (called from slots.js) |
| instructor.js | 27+ | Auth, schedule, availability, blackouts, learner history, notes, stats, photo upload, cancel-booking, reschedule-booking, create-booking |
| admin.js | 14+ | Dashboard stats, bookings, instructor CRUD, learner management, credit adjustment |
| slots.js | 7 | available (with lead-time filter), book (+ repeat_weeks), checkout-slot, cancel (+ cancel_series), reschedule, my-bookings, series-info |
| videos.js | 12 | CRUD, upload-url, categories, bulk operations |
| credits.js | 2-3 | balance, checkout |
| calendar.js | 5 | ICS feed download + URLs for learner and instructor |
| enquiries.js | 4 | submit, list, get, update-status |
| magic-link.js | 2 | send + verify (handles both email and phone) |
| ask-examiner.js | 1 | Anthropic API streaming chat |
| advisor.js | 1 | Anthropic API lesson advisor |
| create-checkout-session.js | 1 | Stripe session creation |
| webhook.js | 1 | Stripe webhook handler |
| reminders.js | 4 | send-due (hourly cron), daily-schedule (7pm cron), settings, update-settings |
| Others (15) | 1 each | address-lookup, config, status, reviews, qa-digest (cron), migrate, verify-session, etc. |

**Shared server modules (prefixed with `_`):**
- `_auth-helpers.js` — SMTP transporter, token generation
- `_shared.js` — JWT verification (`verifyAuth`), AI context builder (`buildLearnerContext`), skill labels
- `_error-alert.js` — Email alerts on 500 errors

### Shared Client Modules

| File | Size | Purpose |
|------|------|---------|
| sidebar.js | 30KB | Context-aware nav — desktop sidebar with collapsible groups + mobile floating pill bottom bar (Home/Lessons/Practice/Learn/Profile). Also injects card styling overrides (borderless shadows) site-wide. |
| competency-config.js | 19KB | 10 DL25 categories, 39 sub-skills, fault types, ratings, readiness scoring |
| auth-gate.js | 7KB | Modal login prompt, `window.ccAuth` (token, user, requireAuth) |
| pwa.js | 5KB | Service worker registration + install banner |
| posthog-tracking.js | 3KB | Event tracking |
| test-routes.js | 2KB | Mock test GPS route definitions for test centres |
| shared/learner-auth.js | 1.3KB | Learner auth helpers |
| shared/instructor-auth.js | 1.2KB | Instructor auth helpers |

### Database (27 tables)

**Users:** learner_users, instructors, admin_users
**Auth:** magic_link_tokens, instructor_login_tokens
**Scheduling:** instructor_availability, instructor_blackout_dates, lesson_bookings, slot_reservations, learner_availability, waitlist
**Notifications:** sent_reminders
**Payments:** credit_transactions
**Learning:** driving_sessions, skill_ratings, learner_onboarding, quiz_results, mock_tests, mock_test_faults
**Community:** qa_questions, qa_answers, enquiries, availability_submissions
**Config:** site_config, google_reviews, google_reviews_meta
**Notes:** instructor_learner_notes

**Notable columns added (March 2026):**
- `lesson_bookings.rescheduled_from` — FK to previous booking in reschedule chain
- `lesson_bookings.reschedule_count` — tracks reschedules per chain (max 2 for learners)
- `lesson_bookings.status` now includes `'rescheduled'` value
- `instructors.min_booking_notice_hours` — minimum hours before a slot can be booked (default 24)
- `lesson_bookings.created_by` — who initiated the booking: 'learner', 'instructor', 'admin'
- `lesson_bookings.payment_method` — how it was paid: 'credit', 'stripe', 'cash', 'free'
- `lesson_bookings.pickup_address` — per-booking pickup (overrides learner profile default)
- `lesson_bookings.dropoff_address` — per-booking dropoff address
- `instructors.calendar_start_hour` — calendar display start hour (default 7)
- `instructors.reminder_hours` — how many hours before lesson to send learner reminders (default 24)
- `instructors.daily_schedule_email` — whether to send next-day schedule email at 7pm (default true)

**Notable columns added (April 2026) — Instructor profile enhancement:**
- `instructors.adi_grade` — DVSA ADI grade (text, e.g. "A", "B", "6")
- `instructors.pass_rate` — learner pass rate percentage (numeric 0-100)
- `instructors.years_experience` — years as a driving instructor (integer)
- `instructors.specialisms` — JSONB array of specialisms (e.g. ["Nervous drivers", "Motorway lessons"])
- `instructors.vehicle_make` — teaching vehicle make (text)
- `instructors.vehicle_model` — teaching vehicle model (text)
- `instructors.transmission_type` — manual/automatic/both (text, default 'manual')
- `instructors.dual_controls` — whether vehicle has dual controls (boolean, default true)
- `instructors.service_areas` — JSONB array of postcodes/area names covered
- `instructors.languages` — JSONB array of languages spoken (default ["English"])

**Notable tables added (April 2026):**
- `learner_availability` — recurring weekly free-time windows (mirrors instructor_availability). Used for waitlist matching.
- `waitlist` — learners waiting for specific slot types. Supports explicit day/time prefs or fallback to learner_availability. 14-day auto-expiry, notify-all on cancellation.
- `sent_reminders` table — tracks sent reminders to prevent duplicates (unique on booking_id + reminder_type)
- `lesson_bookings.series_id` — UUID grouping recurring weekly bookings (same time slot, N weeks)

### Critical Design Decisions Already Made

**Navigation (app-mode design — do NOT deviate):**
- Start page (`/`): Role selection only — "I'm a Learner" or "I'm an Instructor"
- Mobile: Top header with hamburger. **Floating pill bottom bar** (border-radius 26px, frosted glass, layered shadow, 10px side margins): Home | Lessons | Practice | Learn | Profile. Active tab reflects current section via `activeOn` mapping. Subsections accessed via sidebar collapsible groups.
- Desktop: Fixed 240px sidebar with collapsible groups (Lessons → Book/Buy/Upcoming, Practice → Log Session/Mock Test/Progress, Learn → Videos/Examiner AI/Quiz). Accordion — one group open at a time.

**Intentionally removed features (do NOT re-add):**
- Pricing page/tab
- Lesson Advisor (hidden)
- Privacy/Terms as nav tabs (pages exist, just not in nav)
- Q&A (hidden for now)
- Dashboard as permanent bottom tab

**Competency framework (just restructured March 2026):**
- 10 DL25 categories: Control, Move Off, Mirrors, Signals, Junctions, Judgement, Positioning, Progress, Signs/Signals, Manoeuvres
- 39 sub-skills matching the real DVSA DL25 marking sheet
- Session logs rate at the area level (10 skills, traffic-light)
- Mock tests record faults at the sub-skill level
- Legacy key mapping handles all old data

---

## Migration Strategy: React Native (Expo)

**Why Expo/React Native:**
- API is already REST/JSON — RN consumes it identically to current `fetch()` calls
- Fraser knows JavaScript — no new language
- Expo gives managed builds, OTA updates, push notifications
- Marketing pages stay on Vercel — only portals migrate
- The bottom-bar navigation design translates naturally to React Navigation tab bars

**What migrates to the app:** Learner portal, Instructor portal, Admin portal
**What stays on the website:** Landing page, public pages, SEO content

---

## Phase 0: API Preparation (Before any React Native)

> **Goal:** Make the existing API app-ready without breaking the website. Every change here benefits both web and app.

### 0.1 — Generate API specification

Create `api/API_SPEC.md` from the actual code. This is critical because the app team (you + Claude) needs an exact contract.

**Claude Code prompt:**
> "Read every file in /api/*.js. Generate API_SPEC.md documenting each endpoint: HTTP method, `?action=` value, auth required (learner/instructor/admin/none), request body TypeScript types, response TypeScript types, error codes. Use the actual code — don't guess."

**What already exists to work from:** `_shared.js` has `verifyAuth()` which all routes use. Most routes follow a consistent pattern of `if (action === 'X') return handleX(req, res)`.

### 0.2 — Standardise error responses

Currently inconsistent — some return `{ error: 'message' }`, some return `{ error: true, message: '...' }`, some just `{ message: '...' }`.

Standardise to:
```javascript
// Success: { ok: true, ...data }
// Error: { error: true, code: 'MACHINE_READABLE', message: 'Human readable' }
```

**Important:** The `reportError()` pattern from `_error-alert.js` must be preserved — every 500 should still email `ERROR_ALERT_EMAIL`.

### 0.3 — Add API versioning header

In `_shared.js`, add a `getClientVersion(req)` helper:
```javascript
function getClientVersion(req) {
  return req.headers['x-cc-client'] || 'web';
}
```
This lets you handle web vs app differences without forking routes.

### 0.4 — Consolidate auth middleware

Auth is already partially centralised in `_shared.js` (`verifyAuth`) and `_auth-helpers.js` (SMTP + tokens). But each route file still has its own inline checks. Consolidate into:

```javascript
// _shared.js additions:
function requireLearner(req, res) { /* returns user or sends 401 */ }
function requireInstructor(req, res) { /* returns user or sends 401 */ }
function requireAdmin(req, res) { /* returns user or sends 401 */ }
```

**Important nuance:** The instructor auth flow is different from learner — instructors use `instructor_login_tokens` table and a separate `verifyInstructorToken()` function in `instructor.js`. These need to be unified under one pattern.

### 0.5 — Add push notification infrastructure

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('learner', 'instructor')),
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',  -- 'web', 'ios', 'android'
  push_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_type, user_id, push_token)
);
```

Create `api/push.js` with actions: `subscribe`, `unsubscribe`. Supports both Web Push (PWA) and Expo Push (app).

### 0.6 — Add PaymentIntent endpoint for in-app Stripe

The web uses Stripe Checkout (redirect). The app needs a PaymentSheet flow:

```javascript
// api/create-checkout-session.js — add new action:
// POST ?action=create-payment-intent
// Body: { credits, learner_id }
// Returns: { clientSecret, ephemeralKey, customerId }
```

Keep the existing `create-checkout-session` action working for web.

---

## Phase 1: React Native Project Scaffolding

> **Goal:** Bootable Expo app with navigation, theming, and auth — matching the existing app-mode UX.

### 1.1 — Create Expo project

```bash
npx create-expo-app CoachCarterApp --template blank-typescript
cd CoachCarterApp
npx expo install expo-router expo-secure-store expo-constants
npx expo install @react-navigation/native @react-navigation/bottom-tabs
```

### 1.2 — Project structure (mirrors the web architecture)

```
/app
  /(auth)
    login.tsx               # Magic link (phone + email)
    verify.tsx              # Code verification
  /(learner)
    _layout.tsx             # Bottom tab navigator (5 fixed tabs matching sidebar.js: Home/Lessons/Practice/Learn/Profile)
    (learn)/                # "Learn" tab group
      videos.tsx
      ask-examiner.tsx
      examiner-quiz.tsx
    (practice)/             # "Practice" tab group
      log-session.tsx
      mock-test.tsx
      progress.tsx
    (lessons)/              # "Lessons" tab group
      book.tsx
      buy-credits.tsx
      lessons.tsx           # Upcoming lessons list
    (profile)/              # "Profile" tab group
      index.tsx             # Test readiness, mock results, progress
      onboarding.tsx
      profile.tsx
  /(instructor)
    _layout.tsx             # Bottom tab navigator
    index.tsx               # Calendar/dashboard
    availability.tsx
    learners.tsx
    profile.tsx
  /(admin)
    _layout.tsx
    dashboard.tsx
    editor.tsx
/lib
  api.ts                    # API client (base URL, auth headers, error handling)
  auth.ts                   # Token storage via expo-secure-store
  theme.ts                  # Design tokens (matches CSS custom properties)
  competency.ts             # Port of competency-config.js as TypeScript module
  types.ts                  # TypeScript types from API_SPEC.md
/components
  BottomTabBar.tsx          # Custom tab bar matching sidebar.js mobile design
  FaultCounter.tsx          # Reusable D/S/X counter (mock test + session log)
  SkillCard.tsx             # Area card with traffic-light rating
  LoadingSpinner.tsx
  ErrorBoundary.tsx
  Card.tsx
  Button.tsx
```

**Key architectural decision:** The tab structure must match the existing `sidebar.js` bottom bar sections exactly. The web now has 5 fixed tabs (Home, Lessons, Practice, Learn, Profile) that never change. In RN, use a bottom tab navigator with these same 5 tabs. Subsection navigation (e.g. Book vs Buy Credits vs Upcoming within Lessons) is handled by nested stack navigators within each tab group, mirroring the sidebar collapsible groups on web.

### 1.3 — Design tokens (match existing CSS variables)

```typescript
// lib/theme.ts — extracted from public/shared/learner.css + sidebar.js
export const theme = {
  colors: {
    primary: '#262626',     // --primary (charcoal)
    accent: '#f58321',      // --accent (orange)
    accentDark: '#e07518',  // --accent-dk
    accentLight: '#fff4ec', // --accent-lt
    muted: '#797879',       // --muted
    border: '#e0e0e0',      // --border
    background: '#ffffff',  // --white
    surface: '#f9f9f9',     // --surface
    green: '#22c55e',       // --green
    amber: '#f59e0b',
    red: '#ef4444',         // --red
  },
  fonts: {
    heading: 'BricolageGrotesque',
    body: 'Lato',
  },
  radius: 14, // --radius
};
```

### 1.4 — API client

```typescript
// lib/api.ts
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://coachcarter.co.uk/api';

export async function apiCall(
  method: string,
  action: string,
  body?: any,
  route: string = 'learner'
) {
  const token = await SecureStore.getItemAsync('cc_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CC-Client': 'app-1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${BASE_URL}/${route}?action=${action}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error) throw new ApiError(data.code, data.message, res.status);
  return data;
}
```

**Important:** This matches the existing `?action=` routing pattern used by all API files. The web frontend already uses this exact pattern.

### 1.5 — Auth flow

Port the magic link login from `public/learner/login.html` + `api/magic-link.js`:

1. User enters phone number OR email (the web supports both — `magic-link.js` handles `method: 'phone'` or `method: 'email'`)
2. App calls `POST /api/magic-link` with `{ method, phone/email }`
3. User receives SMS code or email link
4. App calls `POST /api/magic-link?action=verify` with the code
5. Response includes `{ token, user, is_new_user, needs_name }`
6. Store JWT in SecureStore (NOT AsyncStorage)
7. If `is_new_user` or `needs_name`, route to onboarding
8. Otherwise route to learner/instructor portal based on user type

**Nuance the plan missed:** The web has a `FREE_TRIAL_CREDITS` system — new users get free credits on signup. The API handles this server-side in `magic-link.js`, so the app doesn't need to do anything special, but the onboarding flow should mention it.

### 1.6 — Port competency-config.js to TypeScript

The competency framework is the backbone of 6 features. Port it as a proper TypeScript module:

```typescript
// lib/competency.ts — typed version of public/competency-config.js
export interface Area {
  id: string;
  label: string;
  icon: string;
  colour: string;
}

export interface SubSkill {
  key: string;
  label: string;
}

export interface Skill {
  key: string;
  label: string;
  area: string;
  subs: SubSkill[];
  description: string;
}

export const AREAS: Area[] = [
  { id: 'control', label: 'Control', icon: '🚗', colour: '#6366f1' },
  // ... all 10 areas
];

export const SKILLS: Skill[] = [
  // ... all 10 skills with 39 sub-skills
];

// ... all helper functions with proper types
```

This must stay in sync with the web version. Consider making the web version auto-generated from this TypeScript source.

---

## Phase 2: Screen-by-Screen Migration (Learner Portal)

> **Goal:** Migrate the 15 learner screens. Each is self-contained — fetch from API, render. Start with highest-value screens.

### Migration order (by user value + complexity):

| Priority | Screen | Complexity | Key challenge |
|----------|--------|-----------|---------------|
| 1 | Dashboard (index) | Medium | Credit balance, upcoming lessons, progress summary |
| 2 | Lessons | Low | List view, cancel flow |
| 3 | Book | Medium | Date picker, slot grid, instructor selection |
| 4 | Buy Credits | Medium | Stripe PaymentSheet (not Checkout redirect) |
| 5 | Progress | High | Radar chart (Canvas → react-native-svg), readiness bars, mock history |
| 6 | Profile | Low | Form fields, phone/email display |
| 7 | Log Session | Medium | 10 skill cards with traffic-light rating + fault counters |
| 8 | Mock Test | **Very High** | Multi-part flow, GPS tracking, Leaflet map → react-native-maps, fault counters, timer, manoeuvre types |
| 9 | Examiner Quiz | Medium | Scenario cards, answer buttons, score tracking, 50 scenarios |
| 10 | Ask Examiner | Medium | Streaming AI chat (Anthropic), message history |
| 11 | Videos | Low | Video list, category tabs, player |
| 12 | Onboarding | Low | Multi-step form (prior hours, transmission, test date, concerns) |

**Screens intentionally skipped for v1 (hidden on web too):**
- Advisor (hidden)
- Q&A (hidden)

### Per-screen migration template:

**Claude Code prompt:**
> "Migrate [SCREEN] from public/learner/[file].html to app/(learner)/[name].tsx.
> 1. Read the HTML file — identify all API calls, state, and interactions
> 2. Create a React Native component using our api.ts, theme.ts, and competency.ts
> 3. Use the same API endpoints — no backend changes
> 4. Match the visual design: charcoal nav, orange accent, card layout
> 5. Handle loading, error, and empty states
> 6. Add pull-to-refresh for data screens"

### 2.1 — Mock Test (the hardest screen)

This is by far the most complex migration. The web version has:
- **Multi-part flow** with dynamic parts (user can continue indefinitely or end anytime)
- **GPS tracking** via `navigator.geolocation.watchPosition` → port to `expo-location`
- **Leaflet map** for placing faults at GPS coordinates → port to `react-native-maps`
- **Fault counters** with long-press-to-reset (custom pointer events) → port to `Pressable` with `onLongPress`
- **Timer** per part
- **Manoeuvre type selection** (Reverse/Right, Reverse park road/car park, Forward park)
- **10 collapsible area groups** with sub-skill fault counters
- **Results screen** with pass/fail, per-part breakdown, fault map
- **Wake Lock API** to prevent screen dimming

**Claude Code prompt:**
> "This is the most complex screen. Read public/learner/mock-test.html completely (it's ~1500 lines). The mock test has: dynamic parts (not fixed at 3), GPS tracking, a Leaflet fault map, fault counters with long-press reset, a timer, manoeuvre type selection, and results with pass/fail calculation. Port all of this to React Native."

### 2.2 — Stripe in-app payments

```bash
npx expo install @stripe/stripe-react-native
```

Use PaymentSheet flow instead of Checkout redirect:
1. App calls `POST /api/create-checkout-session?action=create-payment-intent`
2. API returns `{ clientSecret, ephemeralKey, customerId }`
3. App presents PaymentSheet
4. On success, credits are added via webhook (same as current flow)

### 2.3 — Ask Examiner AI chat

The web version streams responses from Anthropic. In React Native:
- Use the same `POST /api/ask-examiner` endpoint
- The API already returns streaming text — use `ReadableStream` or chunk the response
- The `buildLearnerContext()` function in `_shared.js` automatically builds a context string from the learner's onboarding data, session history, quiz results, and mock test faults — this feeds into the AI prompt server-side, so the app just sends the question

---

## Phase 3: Instructor Portal (6 screens)

| Screen | Complexity | Notes |
|--------|-----------|-------|
| Dashboard/Calendar | Medium | Schedule view, upcoming lessons, completion marking |
| Availability | Medium | Weekly time slot grid editor |
| Learners | Medium | Learner list with notes, phone/WhatsApp links |
| Profile | Low | Bio, photo upload (uses presigned URL), contact details |
| Q&A | Low | Learner questions, reply interface |
| Login | Low | Separate magic link flow via `instructor_login_tokens` table |

**Important nuance:** Instructor auth is completely separate from learner auth. Uses `instructor_login_tokens` table and different JWT payload. The API client needs to handle both token types.

---

## Phase 4: Admin Portal (3 screens)

| Screen | Notes |
|--------|-------|
| Dashboard | Stats, booking management, instructor CRUD, learner management |
| Editor | Video content management (CRUD, upload URLs, categories) |
| Login | Password-based (not magic link) — uses `admin_users.password_hash` |

Admin is lowest priority — Fraser is the only admin user. Could stay web-only initially.

---

## Phase 5: Native-Only Features

> **Goal:** Features that justify the native app over the PWA.

### 5.1 — Push notifications (Expo Push)

```bash
npx expo install expo-notifications expo-device
```

Replace SMS notifications for app users:
- Lesson reminders (24hr + 1hr before)
- Booking confirmations
- Credit purchase receipts
- Mock test results summary

**Saves Twilio costs** for users who have the app installed.

### 5.2 — Background GPS for mock tests

```bash
npx expo install expo-location expo-task-manager
```

The web version uses `navigator.geolocation.watchPosition` which only works in the foreground. The app can:
- Track GPS in the background during the entire mock test
- Higher accuracy and more frequent updates
- Better fault-to-location mapping

### 5.3 — Bluetooth clicker for fault marking

This is the killer native feature:
- Pair with a Bluetooth HID clicker (presenter remote)
- Single click = driving fault, double click = serious, long press = dangerous
- Faults automatically tagged with current GPS coordinates
- Instructor can mark faults while supervising without looking at the phone

### 5.4 — Camera for lesson footage

```bash
npx expo install expo-camera expo-media-library
```

- Record lessons for social media clips
- Feeds into the existing Remotion video pipeline

### 5.5 — Offline mode

Use `@tanstack/react-query` with persistence:
- Cache competency data, lesson history, progress locally
- Queue actions (log session, mark fault) when offline
- Sync when connection returns
- Mock test works fully offline (GPS + fault recording), syncs results later

---

## Phase 6: Build, Test & Ship

### 6.1 — App Store assets

- App icons from existing Logo.png / maskable icons
- Screenshots: iPhone 6.5", iPad 12.9", various Android sizes
- App name: "CoachCarter" (already trademarked?)
- Privacy policy: link to existing coachcarter.co.uk/privacy.html

### 6.2 — EAS Build

```bash
npm install -g eas-cli
eas build --platform all
```

### 6.3 — Beta testing

- iOS: TestFlight with 10-20 current learners
- Android: Internal testing track
- Keep PWA running in parallel — app is optional, not required

### 6.4 — OTA Updates

```bash
eas update --branch production
```

Bug fixes and new screens ship instantly without app review. Only native module changes need a store build.

---

## Realistic Timeline

| Phase | Scope | Sessions | Calendar |
|-------|-------|----------|----------|
| 0 | API prep (benefits web too) | 3-4 | 1-2 weeks |
| 1 | Scaffolding + auth + nav | 2-3 | 1 week |
| 2 | Learner screens (12) | 10-15 | 4-5 weeks |
| 3 | Instructor screens (6) | 4-5 | 1-2 weeks |
| 4 | Admin (optional, low priority) | 2-3 | 1 week |
| 5 | Native features | 5-7 | 2-3 weeks |
| 6 | Build + test + ship | 2-3 | 1-2 weeks |

**Total: ~28-40 Claude Code sessions over 10-16 weeks**

Note: Phase 0 is pure value — it improves the web experience too. Start there regardless of app timeline.

---

## Key Decisions Before Starting

1. **Expo managed vs bare?** Start managed. Only eject if you hit a native module wall (unlikely for your feature set).

2. **Same app binary or separate apps?** Same app with role-based routing. One store listing, simpler to maintain. JWT payload determines if user is learner/instructor.

3. **Admin in the app?** Recommend keeping admin web-only initially. Fraser is the only admin — no need to build native screens for one user.

4. **MVP scope for v1.0?** Dashboard, lessons, booking, buy credits, progress, profile, log session. Ship that, then add mock test, quiz, ask examiner via OTA updates.

5. **Web PWA during transition?** Keep it running. The app is additive, not a replacement. Users who don't install the app still use the web version. Eventually the web portals could redirect to app store links, but not initially.

---

## How to Use This Plan with Claude Code

Start each session with:

> "I'm working on Phase [X], Step [X.X] of the CoachCarter app migration. Here's the context: [paste the relevant section]. My web repo is at [path]. Let's go."

Each phase produces working, testable output. The web version keeps running throughout. The app builds up incrementally.

**Critical files to reference in every session:**
- `public/competency-config.js` — the competency framework (10 categories, 39 sub-skills)
- `api/_shared.js` — auth verification + AI context builder
- `public/sidebar.js` — the navigation design to replicate
- `CLAUDE.md` — project conventions and intentionally removed features
