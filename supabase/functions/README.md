# Supabase Edge Functions

## send_signup_reminder

Director-triggered email reminder for an event. Emails every roster member who
hasn't checked in yet, via Twilio SendGrid (the same provider used for the auth
emails — see `docs/email-setup.md`).

### Deploy

Requires the `get_roster_emails()` Postgres function from `supabase/schema.sql`
(run it in the SQL editor first), then:

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
## sync_google_calendar

Imports the public RHS Band Google Calendar ICS feed into `public.events`.
Google Calendar is the source of truth for band events: the first sync removes
old in-app events, then future syncs update by Google event UID.

### Deploy

```bash
supabase functions deploy sync_google_calendar
```

The function must be deployed with `verify_jwt = false` (already set in
`supabase/config.toml`) — otherwise the platform rejects calls that use the
sync secret before the function's own auth check runs. The function still
accepts signed-in users' JWTs; the secret is an extra path for cron jobs.

The function has the RHS Band calendar's public `basic.ics` URL baked in. To
change it without editing code:

```bash
supabase secrets set GOOGLE_CALENDAR_ICS_URL=https://calendar.google.com/calendar/ical/9f3763f58e6882a95ca8064b93de88d329622698cfcaa9e2450b58c594b2c48e%40group.calendar.google.com/public/basic.ics
```

Note: if a `GOOGLE_CALENDAR_ICS_URL` secret is set, it wins over the baked-in
URL — update or unset it when switching calendars.

### Keep It Fresh

The app invokes the sync before loading band events, throttled in the browser to
about once every 5 minutes. For background refreshes, set a secret and schedule a
cron request to the function:

```bash
supabase secrets set CALENDAR_SYNC_SECRET=make-this-long-and-random
```

Send scheduled POST requests with `x-calendar-sync-secret: <that secret>`.