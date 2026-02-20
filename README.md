# CoachCarter Website

Stripe-integrated driving school booking system.

## Setup Instructions

### 1. Deploy to Vercel
- Push this repo to GitHub
- Import to Vercel
- Add environment variables (see below)
- Deploy

### 2. Environment Variables

In Vercel dashboard, add these:

| Variable | Value | Where to get |
|----------|-------|--------------|
| `STRIPE_SECRET_KEY` | sk_test_... | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | whsec_... | Stripe Dashboard → Developers → Webhooks → your endpoint |
| `SMTP_HOST` | smtp.gmail.com | Your email provider |
| `SMTP_PORT` | 587 | Usually 587 or 465 |
| `SMTP_USER` | your-email@gmail.com | Your email address |
| `SMTP_PASS` | your-app-password | Gmail App Password (not your regular password) |
| `STAFF_EMAIL` | admin@coachcarter.uk | Where notifications go |
| `SLACK_WEBHOOK_URL` | https://hooks... | Optional - Slack incoming webhook |

### 3. Stripe Webhook Setup

1. Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://coachcarter.uk/api/webhook`
3. Select event: `checkout.session.completed`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### 4. Gmail SMTP Setup (if using Gmail)

1. Google Account → Security → 2-Step Verification → Enable
2. App passwords → Select app: Mail → Select device: Other
3. Copy the 16-character password to `SMTP_PASS`

## File Structure

```
/public              # Static HTML files
  index.html         # Pricing page
  availability.html  # Availability form
  success.html       # Payment success
  admin.html         # Staff dashboard
/api                 # Serverless functions
  webhook.js         # Stripe webhook handler
  create-checkout-session.js  # Create Stripe checkout
  availability.js    # Handle availability form
  verify-session.js  # Verify payment for success page
```

## Testing

1. Use Stripe test mode keys
2. Test card: `4242 4242 4242 4242`, any future date, any CVC
3. Check emails arrive
4. Check Slack notifications (if configured)
