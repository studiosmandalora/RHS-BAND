# Supabase Edge Functions

## send_signup_reminder

Director-triggered email reminder for an event. Emails every roster member who
hasn't checked in yet, via Twilio SendGrid (the same provider used for the auth
emails — see `docs/email-setup.md`).

### Deploy

```bash
npm i -g supabase        # or npx supabase
supabase functions deploy send_signup_reminder
```

### Secrets

The function needs a SendGrid API key (Mail Send permission) and a verified
sender address:

```bash
supabase secrets set SENDGRID_API_KEY=SG.xxxx SENDGRID_FROM=no-reply@yourdomain.org
```

`SENDGRID_FROM` is optional; it defaults to `no-reply@rhsband.org` but the
domain must be verified in SendGrid or delivery will fail.

### Invoke

The client calls it with the signed-in session (director only):

```ts
supabase.functions.invoke("send_signup_reminder", { body: { event_id } });
```
