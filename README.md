# CoachCarter

Multi-tenant driving school SaaS platform. Vanilla HTML/JS frontend on Vercel with serverless API routes and Neon Postgres. Built for CoachCarter (coachcarter.uk), now supports multiple driving schools with independent branding, instructors, learners, and payments.

## Quick start

```bash
git clone https://github.com/coachcarteruk-gif/coachcarter-website.git
cd coachcarter-website
npm install
# Set environment variables in Vercel dashboard (see PROJECT.md for full list)
# Push to main to deploy
```

## Documentation

| File | What it covers |
|------|----------------|
| [CLAUDE.md](CLAUDE.md) | Development conventions, multi-tenancy rules, GDPR rules, security rules, Setmore sync docs |
| [PROJECT.md](PROJECT.md) | Complete project reference: file structure, APIs, database schema, hosting, design system |
| [DEVELOPMENT-ROADMAP.md](DEVELOPMENT-ROADMAP.md) | Chronological feature history and future roadmap |
| [DESIGN-REVIEW.md](DESIGN-REVIEW.md) | UI/UX design principles, style guide, component standards |
| [MIGRATION-PLAN.md](MIGRATION-PLAN.md) | React Native app migration strategy |

## Key tech

- **Frontend:** Vanilla HTML/JS, PWA-enabled
- **Backend:** Vercel serverless functions (Node.js)
- **Database:** Neon Postgres (serverless, pooled, SSL)
- **Payments:** Stripe + Stripe Connect (instructor payouts)
- **Email:** Nodemailer (SMTP) + Resend (API fallback)
- **SMS:** Twilio
- **Analytics:** PostHog (EU-hosted, consent-gated)
- **AI:** Claude API (Examiner AI, Lesson Advisor)
