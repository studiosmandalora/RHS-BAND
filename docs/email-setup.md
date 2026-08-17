# Email setup — Twilio SendGrid + Supabase Auth

This app's email verification (signup confirmation) and password resets are
handled by **Supabase Auth**. By default Supabase sends those emails from its
own SMTP server, which is rate-limited to 2 messages/hour and only delivers to
pre-authorized addresses — fine for dev, useless for production.

This guide wires **Twilio SendGrid** (Twilio's email product) in as Supabase's
custom SMTP provider. After this is done, every confirmation / reset / invite
email goes out through SendGrid from your own verified sender.

> **Why SendGrid?** "Twilio" itself is SMS/voice. Email is Twilio's **SendGrid**
> arm. You already have a Twilio account, but SendGrid is a **separate account**
> — you can sign in to SendGrid with your Twilio credentials, but billing and
> the dashboard are their own thing.

## What this changes

- Self-signup now **requires email confirmation** — a new account gets a
  "Confirm your email" link before they can sign in. The app already handles
  this flow (the sign-in screen shows "Check your email to confirm" and the
  confirmation link returns the user to the app and logs them in).
- Password reset emails go out via SendGrid.
- **No code changes were needed** — the React app already calls
  `supabase.auth.signUp` / `resetPasswordForEmail` and handles the redirects.
  Everything below happens in the SendGrid and Supabase dashboards.

---

## Step 1 — Create a SendGrid account

1. Open the SendGrid signup: <https://signup.sendgrid.com/>
   (you can use your Twilio credentials via "Sign in with Twilio").
2. Complete the account wizard (company, email, etc.).
3. In the dashboard, go to **Settings → Sender Authentication**.

## Step 2 — Verify a sender

SendGrid won't deliver mail from an unverified address. Two options:

- **Single Sender Verification** (fastest for testing): **Settings → Sender
  Authentication → Single Sender Verification → Create New Sender**. Enter the
  "from" address you want to send from (e.g. `no-reply@yourdomain.org`) and
  click the link in the verification email.
- **Domain Authentication** (recommended for production): authenticates your
  whole domain and adds SPF/DKIM DNS records, which dramatically improves
  deliverability and stops confirmation emails landing in spam. **Settings →
  Sender Authentication → Authenticate Your Domain** and add the DNS records at
  your DNS provider. Use a subdomain like `email.yourdomain.org` if you like.

For a school band app, Single Sender Verification is fine to start; add Domain
Authentication before going live.

## Step 3 — Create an API key

1. SendGrid dashboard → **Settings → API Keys → Create API Key**.
2. Name it something like `supabase-auth-smtp`.
3. Under **API Key Permissions**, choose **Restricted Access** and grant only
   **Mail Send → Mail Send**.
4. Copy the key now — it's shown once. Save it somewhere safe (this is your
   SMTP "password").

## Step 4 — Point Supabase Auth at SendGrid

1. Open your project: <https://supabase.com/dashboard> → your project →
   **Authentication → Emails → SMTP Settings**.
2. Toggle **Enable Custom SMTP** on and fill in:

   | Field        | Value                                  |
   | ------------ | -------------------------------------- |
   | Host         | `smtp.sendgrid.net`                    |
   | Port         | `587`                                  |
   | Username     | `apikey` (the literal word, not yours) |
   | Password     | your SendGrid API key from Step 3      |
   | Sender email | your verified sender (Step 2)          |
   | Sender name  | e.g. `RHS Band`                        |

3. Click **Save**. Supabase applies a default rate limit of 30 emails/hour —
   raise it on **Authentication → Rate Limits** if you expect more signups.

## Step 5 — Turn on email confirmation

The app was built with confirmation disabled (see the comment in
`src/screens/WelcomeScreen.tsx`). To actually verify emails:

1. **Authentication → Providers → Email**.
2. Toggle **Confirm email** **on**.
3. Save.

> Note: members the director adds via **invite_member** (Roster screen) are
> created with their email already confirmed (`email_confirmed_at = now()` in
> `supabase/schema.sql`) — the director vouches for them, so they skip the
> confirmation email on purpose. Only self-signups are affected.

## Step 6 — (Optional) Customize the email templates

**Authentication → Emails → Templates** — you can edit the subject/body for:

- **Confirm signup** (the verification email)
- **Reset password**
- **Invite user**, **Magic link**, **Change email address**

Templates support variables like `{{ .ConfirmationURL }}` (the click-to-confirm
link), `{{ .SiteURL }}`, and `{{ .Email }}`. The confirmation link points at
your app origin (set via `emailRedirectTo` in the signup call) and the app
auto-completes sign-in when the user lands on it.

## Step 7 — Test it

1. **Signup test**: sign out → Create account with a real email → you should get
   a confirmation email from your sender → click the link → you land in the app
   signed in.
2. **Reset test**: sign out → Forgot password → enter the email → reset link
   arrives → it routes to the `/update-password` screen.
3. Check spam if either email doesn't arrive — that's the #1 sign you skipped
   Domain Authentication (Step 2).

---

## Troubleshooting

- **"Email address not authorized"** — SMTP isn't saved / still using Supabase's
  default server. Re-check Step 4.
- **535 Authentication failed** — username must be literally `apikey` and the
  password must be the full API key (no extra spaces/newlines).
- **Emails land in spam** — do Domain Authentication (Step 2) and keep the
  sender address on the same domain.
- **Confirmation link says invalid/expired** — make sure `Confirm email` is on
  and the redirect URL in **Authentication → URL Configuration** is set to your
  app origin.
