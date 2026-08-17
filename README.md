# RHS Band Attendance Manager 🎺

A mobile-first web app for a high school marching band: QR check-in at events,
per-section realtime chat, attendance tracking, and a director roster — all
gated by Postgres Row Level Security.

- **Stack:** React 19 + Vite + Tailwind CSS v4, Supabase (Postgres, Auth,
  Realtime, Storage). No Convex.
- **Design:** forest green `#2d5a1b` / mid green `#3d7a28` / gold `#f5a623`
  on a light base, with a dark mode. The whole app renders inside a
  phone-width shell, even on desktop.

---

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. **Auth → Providers → Email**: keep it enabled. For a demo, turn **off**
   "Confirm email" so seeded/signup accounts can sign in immediately
   (if you leave it on, new signups will need to click their confirmation link).
3. Copy the **Project URL** and **anon public key** from
   *Project Settings → API*.

## 2. Run the database scripts

Open the **SQL Editor** and run these two files, in order:

1. `supabase/schema.sql` — tables, RLS policies, security-definer RPCs,
   triggers, avatar storage bucket, realtime publication.
2. `supabase/seed.sql` — demo users, events, attendance history, chat channels
   (local dev/demoing only).

For the **real production database**, run `supabase/seed-production.sql`
instead of `seed.sql` — it creates only a single director account (no fake
students or events). Change the placeholder email/password first; the account
is flagged to force a real password on first sign-in.

> If the realtime `alter publication` lines error, it's harmless — just enable
> Realtime per table from **Table editor → (table) → Realtime** for
> `chat_messages` and `attendance_records`.

## 3. Point the app at it

```bash
cp .env.example .env
# edit .env with your Project URL + anon key
npm install
npm run dev
```

Open http://localhost:5173 — you should land on the sign-in screen.

## Demo accounts

The demo quick-fill list on the sign-in screen is **dev-only**: it renders only
when `VITE_SHOW_DEMO_ACCOUNTS=true` in `.env`. Leave it unset (or `false`) in
production so demo credentials never ship.

All use the password **`band1234`** (there's a quick-fill list on the sign-in screen):

| Email | Role |
| --- | --- |
| `director@rhsband.org` | Director — full admin (roster, events, all chat) |
| `tyler.nguyen@rhsband.org` | Trumpet section leader |
| `ava.rodriguez@rhsband.org` · `mia.chen@rhsband.org` · `noah.williams@rhsband.org` · `ethan.patel@rhsband.org` · `lily.johnson@rhsband.org` · `diego.silva@rhsband.org` · `chloe.brooks@rhsband.org` | Students across sections |

### Try the check-in flow

1. Sign in as **director** → **Check-In** → **Generate Code**.
2. A QR code appears with a 60-second countdown and a live list of who's checked in.
3. On a second device/phone (or another browser window), sign in as a **student**
   → **Check-In** → **Scan QR Code** → point at the director's screen.
4. Watch the director's live check-in list update in real time.

---

## How the security model works

Everything is enforced in Postgres, not just hidden in the UI:

- **Roles** live on `profiles.role` (`student` / `section_leader` / `director`).
  Signup always creates a `student`; promotion happens only from the Roster
  screen, and a trigger (`guard_role_change`) blocks any non-director from
  changing a role even if they bypass the UI.
- **Attendance is never a client-writable field.** `attendance_records` has
  **no INSERT/UPDATE/DELETE policies at all**. The only writers are two
  `security definer` RPCs:
  - `record_attendance(token)` — validates the token exists, is unexpired, and
    belongs to a current event, then upserts for `auth.uid()`. It's the only
    way a student can mark themselves present.
  - `override_attendance(event, student, attended)` — directors (any student)
    and section leaders (their section only).
- **Check-in codes** are issued only by `start_checkin_session` (staff only),
  generate a 48-hex random token with a 60-second `expires_at`, and
  regenerating deletes the previous code for that event — so old codes die
  instantly. Students have zero read access to `checkin_sessions`.
- **Chat** is scoped by `can_use_channel()`: directors see/post everywhere
  (including General); students and section leaders only their own
  instrument's channel. Realtime streams respect RLS, so a student's
  subscription can't leak other sections' messages.
- **Avatars** upload to a public `avatars` bucket, but only to your own
  `{user_id}/...` folder.
- **Self-signup is gated by a band join code.** The director sets/rotates the
  code from Roster → Band join code. It's stored in `app_settings` with RLS on
  and no client policies, so the code is never exposed to the browser; the
  client only gets a boolean status and a match check. `handle_new_user` only
  creates a profile when the signup's code matches (or when the user was
  director-invited via `invite_member`, which sets a non-forgeable
  `raw_app_meta_data` flag). Wrong/missing code → account exists but shows
  "not on the roster".
- **Director-added members get a unique random temporary password** (12+
  alphanumeric chars), flagged `must_change_password = true` so they're forced
  to set their own on first sign-in. The temp password is returned to the
  director only, never stored or logged.
- **Check-in has a manual fallback.** Each session also gets a short 8-char
  `entry_code` displayed on the staff screen; students whose camera fails can
  type it in (validated against the same token/expiry rules via
  `record_attendance_by_code`).

### Data model

`profiles` · `events` · `checkin_sessions` · `attendance_records`
(unique `event_id, student_id`) · `chat_channels` · `chat_messages`

### Screens

Calendar (month grid + dots, staff add events) · Check-In (QR gen + live
countdown for staff; camera scanner for students) · Attendance (progress ring,
history, director/leader roster overview with manual toggles) · Chat (realtime
per section) · Roster (director management, leader read-only) · Profile
(avatar upload, password, dark mode).

---

## Project layout

```
supabase/
  schema.sql     # tables, RLS, RPCs, triggers, storage, realtime
  seed.sql       # demo users + data
src/
  lib/           # supabase client, types, constants, date helpers, RPC wrappers
  hooks/         # useAuth (session + profile), useDark
  components/    # AppShell (phone frame + tab nav), ui primitives, Avatar, ProgressRing
  screens/       # Welcome, Calendar, CheckIn, Attendance, Chat, Roster, Profile
```

Scripts: `npm run dev` · `npm run build` · `npm run typecheck` · `npm run preview`
