// ============================================================================
// send_signup_reminder — director-triggered email reminder
// ----------------------------------------------------------------------------
// Emails every roster member who hasn't checked in yet for a given event,
// using Twilio SendGrid (the same email provider configured for the auth
// emails — see docs/email-setup.md).
//
// Deploy & configure:
//   supabase functions deploy send_signup_reminder
//   supabase secrets set SENDGRID_API_KEY=SG.xxxx SENDGRID_FROM=no-reply@yourdomain.org
//
// Invoked from the client (director only):
//   supabase.functions.invoke("send_signup_reminder", { body: { event_id } })
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sendgridApiKey = Deno.env.get("SENDGRID_API_KEY") ?? "";
const sendgridFrom = Deno.env.get("SENDGRID_FROM") ?? "no-reply@rhsband.org";

const supabase = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetch every auth user (emails live on auth.users, not profiles). */
async function listAllUsers(): Promise<{ id: string; email: string | null }[]> {
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const rows = data?.users ?? [];
    for (const u of rows) users.push({ id: u.id, email: u.email ?? null });
    if (rows.length === 0 || users.length >= (data?.total ?? users.length)) break;
    page += 1;
  }
  return users;
}

/** Send one email through the SendGrid v3 API. */
async function sendEmail(to: { email: string; name: string }, subject: string, text: string) {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to.email, name: to.name }] }],
      from: { email: sendgridFrom, name: "RHS Band" },
      subject,
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status}: ${detail.slice(0, 300)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Director-only.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, message: "Missing auth token." }, 401);
    }
    const { data: authData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !authData.user) {
      return json({ ok: false, message: "Not signed in." }, 401);
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("roles")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (!profile?.roles?.includes("director")) {
      return json({ ok: false, message: "Only directors can send reminders." }, 403);
    }

    // 2. Payload.
    const body = await req.json().catch(() => ({}));
    const eventId = body?.event_id as string | undefined;
    if (!eventId) {
      return json({ ok: false, message: "Missing event_id." }, 400);
    }

    // 3. Event.
    const { data: event } = await supabase
      .from("events")
      .select("id, name, date")
      .eq("id", eventId)
      .maybeSingle<{ id: string; name: string; date: string }>();
    if (!event) {
      return json({ ok: false, message: "That event doesn't exist." }, 404);
    }

    // 4. Reminder emails must be configured before we can send them.
    if (!sendgridApiKey) {
      return json({
        ok: false,
        message:
          "Email reminders aren't configured yet. Set the SENDGRID_API_KEY secret (and optionally SENDGRID_FROM) with: supabase secrets set SENDGRID_API_KEY=... SENDGRID_FROM=...",
      }, 500);
    }

    // 5. Everyone who hasn't checked in yet: roster members (not directors,
    //    not deactivated) with no attended record for this event.
    const [rosterRes, attRes, users] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, display_name, deactivated, roles")
        .eq("deactivated", false),
      supabase
        .from("attendance_records")
        .select("student_id")
        .eq("event_id", eventId)
        .eq("attended", true),
      listAllUsers(),
    ]);

    const checkedIn = new Set((attRes.data ?? []).map((r) => r.student_id));
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const recipients = (rosterRes.data ?? []).filter(
      (p) =>
        !p.roles?.includes("director") &&
        !checkedIn.has(p.id) &&
        Boolean(emailById.get(p.id))
    );

    // 6. Send the reminder to each.
    const dateLabel = new Date(event.date).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    let sent = 0;
    const errors: string[] = [];
    await Promise.all(
      recipients.map(async (p) => {
        const name = p.display_name || p.full_name || "Band member";
        try {
          await sendEmail(
            { email: emailById.get(p.id)!, name },
            `RHS Band: you haven't checked in for ${event.name}`,
            `Hi ${name},\n\n` +
              `This is a reminder that you haven't checked in yet for:\n` +
              `  ${event.name} — ${dateLabel}\n\n` +
              `Open the RHS Band app and check in so we can get an accurate headcount.\n\n` +
              `— RHS Band`
          );
          sent += 1;
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );

    return json({
      ok: true,
      sent,
      skipped: recipients.length - sent,
      errors,
      message: `Reminder sent to ${sent} member${sent === 1 ? "" : "s"}.`,
    });
  } catch (e) {
    return json(
      { ok: false, message: e instanceof Error ? e.message : "Something went wrong." },
      500
    );
  }
});
