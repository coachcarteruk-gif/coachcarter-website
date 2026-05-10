# Credential Rotation Playbook

Step-by-step instructions for rotating every secret in `.env.local` + Vercel env vars. Use this whenever:
- A secret is suspected leaked (transcript, logs, accidental commit, departing collaborator).
- A scheduled rotation cycle (recommend: every 6–12 months for low-risk, every 90 days for high-risk).
- A new build/deploy environment requires fresh keys.

**First-edition context (2026-05-10):** this file was written after a session in which many production secrets appeared in a chat transcript. The first run of the playbook is that recovery.

---

## Before you start

- Set aside ~45–60 minutes uninterrupted.
- Have `.env.local` open in your text editor (path: project root, gitignored).
- Have Vercel dashboard open in another tab: `https://vercel.com/coachcarteruk-2599s-projects/coachcarter-website/settings/environment-variables`. **Every secret you change in `.env.local` ALSO needs updating in Vercel** — production reads from Vercel, not your local file.
- For each rotation, the pattern is: rotate at provider → copy new value → update `.env.local` → update Vercel env var → save Vercel (you don't need to redeploy until the end; Vercel caches per-deployment).
- **At the end**, trigger a Vercel redeploy so production picks up the new values.

The rotations are grouped by blast radius. Do Tier 1 first.

---

## Tier 1 — Highest blast radius (do first)

### 1. Neon `neondb_owner` password

**Why first:** full read/write access to the database. PII for every learner.

**Rotate:**
1. <https://console.neon.tech> → CoachCarter project → left sidebar "Branches" → click `main`.
2. Click the **"Roles & Databases"** tab on the branch detail page.
3. Find `neondb_owner` row → click "..." menu → **Reset password** (or similar wording).
4. Copy the new password to clipboard immediately — Neon usually only shows it once.

**Update:**
- `.env.local`: `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`. Replace **the password portion only** — between `neondb_owner:` and `@ep-…`. Keep everything else identical.
- Vercel env vars: `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`. Same surgical password swap.

**Verify:**
```
node --env-file=.env.local -e "const {neon}=require('@neondatabase/serverless'); neon(process.env.POSTGRES_URL)\`SELECT 1\`.then(r=>console.log('OK',r)).catch(e=>console.error('FAIL',e.message))"
```

---

### 2. Stripe live secret key + webhook secret

**Why high priority:** can move real money. Webhook secret can let an attacker forge events.

**Rotate the secret key:**
1. <https://dashboard.stripe.com> → make sure you're in **LIVE mode** (top-left dropdown should say "coachcarter.uk" without the orange Sandbox banner).
2. Developers → API keys.
3. Find your live secret key (`sk_live_…`). Click "..." → **Roll key**.
4. Stripe shows the new key once. Copy immediately.
5. **Important:** Stripe gives you a grace period (usually 12 hours) where the OLD key still works. Use this to update everywhere before the old key dies.

**Rotate the webhook secret:**
1. Still in live mode. Developers → Webhooks.
2. Find your production endpoint (the one pointing at `https://coachcarter.uk/api/webhook` or similar).
3. Click into it → "Signing secret" → **Roll secret**. Copy the new `whsec_…`.

**Update:**
- `.env.local`: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Vercel env vars: same two names.

**Verify (after Vercel redeploy at the end):**
- Stripe Dashboard → Webhooks → your endpoint → recent deliveries. If signing fails, events show as failed with "signature verification" error.
- Live site still creates Stripe checkout sessions correctly (try a tiny test purchase).

---

### 3. JWT_SECRET

**Why high priority:** signs every login token. Rotation **logs everyone out** and forces re-login. That's expected — don't be surprised by the support pings.

**Generate new:**
- PowerShell:
  ```powershell
  -join ((1..40) | ForEach-Object { Get-Random -InputObject ([char[]]'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') })
  ```
- Or use any password generator (40+ random chars).

**Update:**
- `.env.local`: `JWT_SECRET`.
- Vercel env var: `JWT_SECRET`.

**Verify:**
- After redeploy, you'll be logged out of all admin/instructor/learner sessions on coachcarter.uk. Log back in to confirm new tokens work.
- **Heads-up:** any active learner sessions die. They get a 401 on next request and are bounced to login. Acceptable but worth doing at a quiet time.

---

### 4. ADMIN_SECRET

**Why high priority:** grants admin access if anyone uses the admin shortcut endpoint.

**Generate new:** as above (40+ random chars).

**Update:** `.env.local` and Vercel env var.

**Verify:** log into admin portal at coachcarter.uk/admin/login. If something else uses ADMIN_SECRET as a query param, that breaks until updated.

---

### 5. MIGRATION_SECRET + CRON_SECRET

**Why high priority:** the keys that gate `/api/migrate` (can wreck schema if abused) and `/api/cron-payouts` (can fire payouts).

**Generate new:** as above for each (can be same length, must be different values).

**Update:**
- `.env.local`: both.
- Vercel env vars: both.
- **Vercel cron config:** the production cron at `vercel.json` automatically uses `CRON_SECRET` from env vars — no separate update needed. Verify by checking next Friday's cron run completes successfully.

---

## Tier 2 — Service credentials (medium priority)

These give access to specific external services. Rotate in any order.

### 6. SMTP password (IONOS email)

**Why:** can send email as `fraser@coachcarter.uk`.

**Rotate:**
1. Log into IONOS: <https://login.ionos.co.uk> → Email & Office → Mail Basic.
2. Find `fraser@coachcarter.uk` mailbox → Reset password.
3. Copy the new one.

**Update:** `.env.local`: `SMTP_PASS` + Vercel env var.

**Verify:** trigger any flow that sends email (e.g. submit a learner enquiry). Check the email arrives.

---

### 7. Resend API key

**Rotate:**
1. <https://resend.com/api-keys>
2. Find the existing key. Click ... → Delete.
3. Create new key → "Full access" → name it (e.g. `production-YYYY-MM-DD`) → copy.

**Update:** `.env.local`: `RESEND_API_KEY` + Vercel env var.

**Verify:** check whichever flow uses Resend (probably a transactional email backup; check `api/_auth-helpers.js` to confirm). Probably not customer-visible if SMTP is the primary.

---

### 8. Anthropic API key

**Rotate:**
1. <https://console.anthropic.com> → Settings → API Keys.
2. Find the existing key (`sk-ant-api03-…`). "Disable" or "Revoke".
3. Create new key → name (e.g. `coachcarter-prod-YYYY-MM-DD`) → copy.

**Update:** `.env.local`: `ANTHROPIC_API_KEY` + Vercel env var.

**Verify:** any Claude-powered feature (lesson advisor, chat) — check it still responds.

---

### 9. Twilio auth token

**Rotate:**
1. <https://console.twilio.com> → top-right account → API keys & tokens.
2. Find the live auth token (the one matching the SID in env vars).
3. Click "Create a new auth token" → confirm.
4. **You get a grace period** — Twilio shows both old and new for 24h. Update everywhere before the old expires.

**Update:** `.env.local`: `TWILIO_AUTH` + Vercel env var. (TWILIO_SID stays the same.)

**Verify:** trigger any SMS flow (e.g. learner signup with phone) — check the SMS arrives.

---

### 10. Cloudflare API token

**Rotate:**
1. <https://dash.cloudflare.com> → top-right profile icon → My Profile → API Tokens.
2. Find the existing token (`cfat_…`). Click ... → Roll.
3. Copy new.

**Update:** `.env.local`: `CLOUDFLARE_API_TOKEN` + Vercel env var. (CLOUDFLARE_ACCOUNT_ID stays the same.)

**Verify:** whatever uses Cloudflare (DNS API? R2?). Probably nothing user-visible breaks immediately if not used hot.

---

### 11. Setmore refresh token

**Why complicated:** OAuth refresh tokens require re-doing the OAuth dance, not just regenerating in a dashboard.

**Rotate:**
1. <https://developer.setmore.com/> → log in → your app.
2. Find the integration → revoke existing refresh token.
3. Re-run the OAuth flow against `https://coachcarter.uk` (or however you originally got it).
4. Save the new refresh token.

**Update:** `.env.local`: `SETMORE_REFRESH_TOKEN` + Vercel env var.

**Verify:** the Setmore sync runs every 15 min via cron — check the next run completes (logs in Vercel) and `lesson_bookings` show recent imports.

---

## Tier 3 — Lower-risk API keys

These are mostly read-only or rate-limited. Still worth rotating, but prioritise the above first.

### 12. Google API keys (multiple)

You have several: `GOOGLE_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SHEETS_ID` (the last is an ID not a key — leave it).

**Rotate:**
1. <https://console.cloud.google.com> → APIs & Services → Credentials.
2. Find each key. Click → "Regenerate" or delete + create new.
3. **Important:** if there are restrictions (HTTP referrer, IP) on the existing keys, copy them onto the new ones.

**Update:** `.env.local`: relevant `GOOGLE_*` lines + Vercel env vars.

**Verify:** address autocomplete on signup forms; map embeds; travel-time lookup. Anything using Google Maps / Places.

### 13. getAddress.io API key

**Rotate:** <https://getaddress.io/Account/Login> → Account → Regenerate API key.

**Update:** `.env.local`: `GETADDRESS_API_KEY` + Vercel env var.

**Verify:** UK postcode lookup on learner signup.

### 14. OpenRouteService API key

**Rotate:** <https://openrouteservice.org/dev/#/home> → Tokens → revoke + create new.

**Update:** `.env.local`: `OPENROUTESERVICE_API_KEY` + Vercel env var.

**Verify:** travel-time warnings on booking page.

---

## Final step — redeploy production

After all secrets are updated in Vercel:

1. <https://vercel.com/coachcarteruk-2599s-projects/coachcarter-website>
2. Deployments tab → top deployment → "..." → **Redeploy**.
3. Confirm "Use existing build cache" → Redeploy.
4. Wait ~2 min for deploy to complete.
5. Hit <https://coachcarter.uk> and verify the site loads.
6. Log into instructor or admin portal — verify auth works (proves new JWT_SECRET).
7. Check Vercel logs for the next 10 minutes — any 500 errors will surface here if a credential update was missed.

---

## Spot-check after rotation

Tomorrow morning's checks (5 min total):

- [ ] Vercel cron at 09:00 UTC — verify Friday cron logs show no auth errors.
- [ ] Setmore sync cron (every 15 min) — verify imports still working.
- [ ] Try logging in as Fraser/admin — confirms JWT works.
- [ ] Check Stripe Dashboard → Webhooks → latest event delivery shows 200 status.

---

## What you DON'T need to rotate

These look like secrets but aren't (or are auto-managed):

| Variable | Why not |
|---|---|
| `VERCEL_*` (all of them) | Auto-managed by Vercel. `VERCEL_OIDC_TOKEN` rotates itself. |
| `ERROR_ALERT_EMAIL`, `STAFF_EMAIL`, `SMTP_USER`, `SMTP_HOST`, `SMTP_PORT` | Email addresses / hostnames — not secrets. |
| `GOOGLE_SHEETS_ID` | Public spreadsheet ID — not a credential. |
| `MAINTENANCE_MODE`, `NX_DAEMON`, `TURBO_*` | Config flags. |
| `N8N_WEBHOOK_URL`, `TWILIO_FROM`, `TWILIO_WHATSAPP_FROM` | URLs / phone numbers — not secrets. |
| `TWILIO_SID` | Public account identifier (paired with auth token, which you DO rotate). |
| `CLOUDFLARE_ACCOUNT_ID` | Public account ID. |

---

## Emergency mode — if you only have 15 minutes

Do **just** these and stop:

1. Neon `neondb_owner` password (item 1)
2. Stripe live secret key (item 2, secret only — skip webhook for now)
3. Redeploy Vercel

That covers the highest-blast-radius items. The rest can wait until tomorrow.

---

## Structural lesson — preventing the next leak

The 2026-05-10 incident happened because `.env.local` contained **production credentials** alongside development values. Pasting any production env var into a chat transcript / log / paste-bin then leaks production access.

For long-term prevention, consider:

1. **Separate `.env.local` from production.** Local dev should use a separate database (Neon branch) and test-mode Stripe by default. The current model — `.env.local` mirrors prod — means every casual `.env.local` exposure is a prod credential exposure.
2. **Pull from Vercel rather than copying values manually.** `vercel env pull .env.local` fetches from Vercel into your local file. Combined with point 1, this means your local file would be populated with development env vars, not production ones.
3. **Use a secret manager.** Vercel env vars are already this for production. Local dev could use 1Password CLI, doppler, or similar. Overkill for a one-person operation today; revisit when team size grows.

These changes are bigger than a "fix it now" task — they restructure how dev environments work. Worth doing as a deliberate, separate session rather than tacked onto a rotation.
