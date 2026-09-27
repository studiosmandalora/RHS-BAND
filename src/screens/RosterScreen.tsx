import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Copy,
  Download,
  KeyRound,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  deactivateMember,
  getBandJoinCode,
  getBandJoinCodeStatus,
  inviteMember,
  inviteMembersBulk,
  reactivateMember,
  resetMemberPassword,
  setBandJoinCode,
  updateMemberInstrument,
} from "../lib/rpc";
import type { BulkInviteRow, Profile, Role } from "../lib/types";
import { INSTRUMENTS, ROLE_CHIP, ROLE_LABEL } from "../lib/constants";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
} from "../components/ui";
import { Avatar } from "../components/Avatar";

/** Short un-ambiguous code (no 0/O, 1/I/L) for the "Rotate code" button. */
function randomCode(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Max rows per bulk import — mirrors the cap enforced by invite_members_bulk. */
const MAX_BULK_ROWS = 200;

/** One parsed CSV row plus its preview validation state. */
type BulkRow = {
  email: string;
  full_name: string;
  instrument: string;
  /** Blocking problem — the row is skipped when importing. */
  issue: string | null;
  /** Non-blocking note (e.g. an unknown section name). */
  warn?: string;
};

/**
 * Minimal CSV parser — quoted fields, "" escapes, CRLF, Excel BOM. Kept
 * dependency-free on purpose (nothing in package.json parses CSV).
 */
function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop rows where every cell is blank (Excel often adds trailing empties).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Parse an uploaded CSV into validated preview rows. The header row must
 * contain email and full_name; instrument (or section) is optional.
 */
function buildBulkRows(
  text: string
): { rows: BulkRow[]; error: string | null } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], error: "That file is empty." };

  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const header = grid[0].map(norm);
  const idxEmail = header.findIndex((h) =>
    ["email", "e_mail", "email_address"].includes(h)
  );
  const idxName = header.findIndex((h) =>
    ["full_name", "name", "student_name"].includes(h)
  );
  const idxInstrument = header.findIndex((h) =>
    ["instrument", "section"].includes(h)
  );

  const missing: string[] = [];
  if (idxEmail < 0) missing.push("email");
  if (idxName < 0) missing.push("full_name");
  if (missing.length > 0) {
    return {
      rows: [],
      error: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected a header row with email, full_name and (optionally) instrument.`,
    };
  }

  const data = grid.slice(1);
  if (data.length === 0) {
    return { rows: [], error: "No data rows found below the header row." };
  }
  if (data.length > MAX_BULK_ROWS) {
    return {
      rows: [],
      error: `That file has ${data.length} rows — imports are capped at ${MAX_BULK_ROWS} at a time.`,
    };
  }

  const seen = new Map<string, number>();
  const rows: BulkRow[] = data.map((cells, i) => {
    const email = (cells[idxEmail] ?? "").trim().toLowerCase();
    const full_name = (cells[idxName] ?? "").trim();
    const raw = (idxInstrument >= 0 ? (cells[idxInstrument] ?? "") : "").trim();
    // Match the canonical casing so section comparisons (a section leader's
    // scope, roster grouping) keep working with files like "flute".
    const canonical = INSTRUMENTS.find(
      (s) => s.toLowerCase() === raw.toLowerCase()
    );
    const instrument = canonical ?? raw;

    let issue: string | null = null;
    if (!email) issue = "Missing email";
    else if (!/^[^\s@]+@[^\s@]+$/.test(email)) issue = "Invalid email";
    else if (!full_name) issue = "Missing full name";
    else {
      const first = seen.get(email);
      if (first !== undefined) issue = `Duplicate of row ${first}`;
      else seen.set(email, i + 1);
    }

    return {
      email,
      full_name,
      instrument,
      issue,
      warn:
        !issue && raw && !canonical
          ? `"${raw}" isn't a known section`
          : undefined,
    };
  });

  return { rows, error: null };
}

/** Download the CSV template — same Blob flow as AttendanceScreen's exportCsv(). */
function downloadTemplate() {
  const template = [
    ["email", "full_name", "instrument"],
    ["jamie.rivera@rhsband.org", "Jamie Rivera", "Flute"],
    ["noah.williams@rhsband.org", "Noah Williams", "Saxophone"],
    ["mia.chen@rhsband.org", "Mia Chen", ""],
  ];
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = template.map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roster-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function RosterScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isDirector = profile.roles.includes("director");
  const isSectionLeader = profile.roles.includes("section_leader");
  const canManage = isDirector || isSectionLeader;
  const [members, setMembers] = useState<Profile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add-member modal
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addInstrument, setAddInstrument] = useState<string>(INSTRUMENTS[0]);
  const [adding, setAdding] = useState(false);

  // bulk import modal
  const [showBulk, setShowBulk] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[] | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    total: number;
    succeeded: number;
    failed: number;
    rows: BulkInviteRow[];
  } | null>(null);
  const [bulkCopied, setBulkCopied] = useState(false);
  const bulkFileRef = useRef<HTMLInputElement | null>(null);

  // member actions (deactivate / reactivate / reset password)
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState<{
    member: Profile;
    tempPassword: string;
  } | null>(null);

  // band join code (director only)
  const [joinCodeEnabled, setJoinCodeEnabled] = useState<boolean | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [savingJoinCode, setSavingJoinCode] = useState(false);
  const [joinMsg, setJoinMsg] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  async function load() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    let rows = (data as Profile[]) ?? [];
    // Section leaders only see their own section.
    if (isSectionLeader && !isDirector && profile.instrument) {
      rows = rows.filter(
        (r) => r.instrument === profile.instrument || r.id === profile.id
      );
    }
    setMembers(rows);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.roles.join(",")]);

  async function toggleRole(member: Profile, role: Role) {
    setError(null);
    const next = member.roles.includes(role)
      ? member.roles.filter((r) => r !== role)
      : [...member.roles, role];
    // Always keep at least one role — nobody can be role-less.
    if (next.length === 0) {
      setError("A member needs at least one role.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ roles: next })
      .eq("id", member.id);
    if (error) setError(error.message);
    else void load();
  }

  /* --------------------- remove member from roster ----------------------- */
  async function removeMember(member: Profile) {
    if (
      !window.confirm(
        `Remove ${member.display_name || member.full_name} from the roster? This deletes their account and attendance history.`
      )
    )
      return;
    setError(null);
    setBusyId(member.id);
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", member.id);
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice(`${member.display_name || member.full_name} removed from the roster.`);
    void load();
  }

  async function changeInstrument(member: Profile, instrument: string) {
    setError(null);
    const { result, error } = await updateMemberInstrument(
      member.id,
      instrument
    );
    if (error || !result?.ok) {
      setError(
        error?.message ?? result?.message ?? "Could not update instrument."
      );
      return;
    }
    void load();
  }

  /* ----------------------- deactivate / reactivate ----------------------- */
  async function deactivate(member: Profile) {
    if (
      !window.confirm(
        `Deactivate ${member.display_name || member.full_name}? They won't be able to sign in, but their attendance history stays intact.`
      )
    )
      return;
    setError(null);
    setBusyId(member.id);
    const { result, error } = await deactivateMember(member.id);
    setBusyId(null);
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Could not deactivate.");
      return;
    }
    setNotice(result.message ?? "Member deactivated.");
    void load();
  }

  async function reactivate(member: Profile) {
    setError(null);
    setBusyId(member.id);
    const { result, error } = await reactivateMember(member.id);
    setBusyId(null);
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Could not reactivate.");
      return;
    }
    setNotice(result.message ?? "Member reactivated.");
    void load();
  }

  /* ------------------------- reset member password ----------------------- */
  async function resetPassword(member: Profile) {
    setError(null);
    setBusyId(member.id);
    const { result, error } = await resetMemberPassword(member.id);
    setBusyId(null);
    if (error || !result?.ok) {
      setError(
        error?.message ?? result?.message ?? "Could not reset the password."
      );
      return;
    }
    setResetPw({ member, tempPassword: result.temp_password ?? "" });
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setAdding(true);
    // Section leaders can only add members to their own section.
    const instrument =
      isSectionLeader && profile.instrument ? profile.instrument : addInstrument;
    const { result, error } = await inviteMember(
      addEmail.trim(),
      addName.trim(),
      instrument
    );
    setAdding(false);
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Could not add member.");
      return;
    }
    setNotice(
      result.temp_password
        ? `Member added. Give them their temporary password: ${result.temp_password} — they'll be asked to set their own on first sign-in.`
        : "Added to the roster. That email already has an account, so they'll sign in with their existing password."
    );
    setShowAdd(false);
    setAddName("");
    setAddEmail("");
    void load();
  }

  /* --------------------------- bulk CSV import --------------------------- */
  function openBulk() {
    setBulkRows(null);
    setBulkError(null);
    setBulkResults(null);
    setBulkCopied(false);
    setShowBulk(true);
  }

  async function onBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after fixing it
    if (!file) return;
    setBulkError(null);
    setBulkResults(null);
    try {
      const { rows, error } = buildBulkRows(await file.text());
      if (error) {
        setBulkRows(null);
        setBulkError(error);
        return;
      }
      setBulkRows(rows);
    } catch {
      setBulkRows(null);
      setBulkError("Could not read that file — is it a CSV?");
    }
  }

  async function submitBulk() {
    if (!bulkRows) return;
    // Rows with problems stay behind (they're called out in the preview).
    const ready = bulkRows.filter((r) => !r.issue);
    if (ready.length === 0) return;
    setError(null);
    setNotice(null);
    setBulkSending(true);
    const { result, error: rpcError } = await inviteMembersBulk(
      ready.map((r) => ({
        email: r.email,
        full_name: r.full_name,
        instrument: r.instrument,
      }))
    );
    setBulkSending(false);
    if (rpcError || !result?.ok) {
      setBulkError(
        rpcError?.message ?? result?.message ?? "Could not import members."
      );
      return;
    }
    setBulkResults({
      total: result.total ?? ready.length,
      succeeded: result.succeeded ?? 0,
      failed: result.failed ?? 0,
      rows: result.results ?? [],
    });
    void load();
  }

  async function copyBulkPasswords() {
    const lines = (bulkResults?.rows ?? [])
      .filter((r) => r.ok && r.temp_password)
      .map((r) => `${r.email}: ${r.temp_password}`);
    if (lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setBulkCopied(true);
    } catch {
      /* ignore — the passwords are on screen to copy manually */
    }
  }

  /* ------------------------- band join code ------------------------------ */
  useEffect(() => {
    if (!isDirector) return;
    let cancelled = false;
    void getBandJoinCodeStatus().then(({ result }) => {
      if (cancelled || !result?.ok) return;
      setJoinCodeEnabled(result.enabled ?? false);
    });
    void getBandJoinCode().then(({ result }) => {
      if (cancelled || !result?.ok) return;
      setCurrentCode(result.code ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [isDirector]);

  async function saveJoinCode(code: string) {
    setJoinMsg(null);
    setSavingJoinCode(true);
    const { result, error } = await setBandJoinCode(code);
    setSavingJoinCode(false);
    if (error || !result?.ok) {
      setJoinMsg({
        tone: "error",
        text: error?.message ?? result?.message ?? "Could not update the join code.",
      });
      return;
    }
    setCurrentCode(code);
    setJoinCodeEnabled(code !== "");
    setJoinMsg({
      tone: "success",
      text: code
        ? "Join code saved. Students must enter it to create an account."
        : "Join code removed — anyone can now self-register.",
    });
  }

  async function rotateJoinCode() {
    await saveJoinCode(randomCode());
  }

  async function copyJoinCode() {
    if (!currentCode) {
      setJoinMsg({
        tone: "error",
        text: "No join code is set yet — rotate one first.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(currentCode);
      setJoinMsg({ tone: "success", text: "Join code copied to clipboard." });
    } catch {
      setJoinMsg({
        tone: "error",
        text: "Couldn't copy automatically — select the code and copy manually.",
      });
    }
  }

  const readyCount = bulkRows?.filter((r) => !r.issue).length ?? 0;
  const blockedCount = (bulkRows?.length ?? 0) - readyCount;

  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-ink dark:text-zinc-100">Roster</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isDirector
              ? "Manage the whole band roster."
              : "Manage your section's roster."}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <UserPlus className="size-4" /> Add member
            </Button>
            <Button size="sm" variant="outline" onClick={openBulk}>
              <Upload className="size-4" /> Bulk import
            </Button>
          </div>
        )}
      </div>

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      {notice && <Alert tone="success" className="mb-3">{notice}</Alert>}

      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={isDirector ? "No members yet" : "Your section is empty"}
          subtitle="Add members so they can check in at events."
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            // Directors can manage everyone except other directors.
            // Section leaders have read-only access to their section.
            const editable = isDirector && !m.roles.includes("director");
            return (
              <Card
                key={m.id}
                className={
                  "p-3.5 " +
                  (m.deactivated
                    ? "opacity-60"
                    : "")
                }
              >
                <div className="flex items-center gap-3">
                  <Avatar name={m.display_name || m.full_name} url={m.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
                        {m.display_name || m.full_name}
                        {m.id === profile.id && (
                          <span className="ml-1 text-xs font-semibold text-zinc-400">
                            (you)
                          </span>
                        )}
                      </p>
                      {m.roles.map((r) => (
                        <Badge key={r} className={ROLE_CHIP[r]}>
                          {ROLE_LABEL[r]}
                        </Badge>
                      ))}
                      {m.deactivated && (
                        <Badge className="bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-900">
                          Deactivated
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-400">
                      {m.roles.includes("director") ? "Conductor" : m.full_name}
                    </p>
                  </div>
                  {m.roles.includes("director") && (
                    <ShieldCheck className="size-5 text-gold" />
                  )}
                  {editable && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => void resetPassword(m)}
                        disabled={busyId === m.id}
                        className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-gold/15 hover:text-gold-deep disabled:opacity-40 dark:text-zinc-500 dark:hover:text-gold"
                        aria-label={`Reset password for ${m.display_name}`}
                        title="Reset password"
                      >
                        <KeyRound className="size-4" />
                      </button>
                      <button
                        onClick={() =>
                          void (m.deactivated ? reactivate(m) : deactivate(m))
                        }
                        disabled={busyId === m.id}
                        className={
                          "rounded-full p-2 transition-colors disabled:opacity-40 " +
                          (m.deactivated
                            ? "text-forest hover:bg-moss dark:text-moss dark:hover:bg-forest/40"
                            : "text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/40 dark:hover:text-red-400")
                        }
                        aria-label={
                          m.deactivated
                            ? `Reactivate ${m.display_name}`
                            : `Deactivate ${m.display_name}`
                        }
                        title={m.deactivated ? "Reactivate" : "Deactivate"}
                      >
                        {m.deactivated ? (
                          <UserCheck className="size-4" />
                        ) : (
                          <Power className="size-4" />
                        )}
                      </button>
                      <button
                        onClick={() => void removeMember(m)}
                        disabled={busyId === m.id}
                        className="rounded-full p-2 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:text-zinc-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        aria-label={`Remove ${m.display_name} from the roster`}
                        title="Remove from roster (deletes account)"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>

                {editable && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Field label="Instrument">
                      <Select
                        value={m.instrument}
                        onChange={(e) => void changeInstrument(m, e.target.value)}
                        className="!min-h-9 text-xs"
                      >
                        <option value="">—</option>
                        {INSTRUMENTS.map((i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Roles — tap to toggle (a person can hold several)">
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            "student",
                            "section_leader",
                            "secretary",
                          ] as Role[]
                        ).map((role) => {
                          const active = m.roles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={() => void toggleRole(m, role)}
                              className={
                                "rounded-full px-3 py-1.5 text-xs font-bold transition-colors " +
                                (active
                                  ? ROLE_CHIP[role]
                                  : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:bg-zinc-800 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300")
                              }
                              aria-pressed={active}
                            >
                              {ROLE_LABEL[role]}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Everyone keeps at least one role. Directors manage
                        roles and instruments. Students change their own
                        instrument in their profile.
                      </p>
                    </Field>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* band join code — director only */}
      {isDirector && (
        <Card className="mt-4 space-y-3 p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-gold" />
            <p className="text-sm font-bold text-ink dark:text-zinc-100">
              Band join code
            </p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Students must enter this code when creating their own account. Keep
            it secret — share it only with band members. Leave blank to remove
            it and let anyone self-register.
          </p>
          {joinCodeEnabled !== null && (
            <Badge
              className={
                joinCodeEnabled
                  ? "bg-moss text-forest dark:bg-forest/40 dark:text-moss"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }
            >
              {joinCodeEnabled
                ? "Enabled — self-signup requires the code"
                : "Not set — anyone can self-register"}
            </Badge>
          )}

          {/* current code + copy + rotate */}
          {joinCodeEnabled && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-xl bg-cream px-4 py-2.5 font-mono text-sm font-bold tracking-widest text-forest ring-1 ring-black/10 dark:bg-zinc-800 dark:text-gold dark:ring-white/10">
                {currentCode || "••••••••"}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyJoinCode()}>
                <Copy className="size-4" /> Copy
              </Button>
              <Button
                size="sm"
                onClick={() => void rotateJoinCode()}
                loading={savingJoinCode}
                title="Generate a new random code"
              >
                <RefreshCw className="size-4" /> Rotate
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Set a custom code (e.g. BAND2026)"
              autoCapitalize="characters"
              className="flex-1"
            />
            <Button
              onClick={() => void saveJoinCode(joinCode.trim())}
              loading={savingJoinCode}
            >
              Save
            </Button>
          </div>
          {joinCodeEnabled && (
            <button
              type="button"
              onClick={() => void saveJoinCode("")}
              className="text-xs font-semibold text-zinc-400 hover:text-red-500"
            >
              Remove join code (anyone can self-register)
            </button>
          )}
          {joinMsg && <Alert tone={joinMsg.tone}>{joinMsg.text}</Alert>}
        </Card>
      )}

      {/* add member modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add member">
        <form onSubmit={submitAdd} className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Creates a sign-in for them with a one-time random password. They'll
            be forced to set their own password the first time they sign in.
          </p>
          <Field label="Full name">
            <Input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="e.g. Jamie Rivera"
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="jamie@rhsband.org"
              required
            />
          </Field>
          {isDirector ? (
            <Field label="Instrument / section">
              <Select
                value={addInstrument}
                onChange={(e) => setAddInstrument(e.target.value)}
              >
                {INSTRUMENTS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="rounded-xl bg-moss/30 px-3 py-2 text-xs font-semibold text-forest dark:bg-forest/30 dark:text-moss">
              Will be added to the {profile.instrument || "your"} section.
            </p>
          )}
          <Button type="submit" size="lg" loading={adding} className="w-full">
            Add to roster
          </Button>
        </form>
      </Modal>

      {/* bulk import modal */}
      <Modal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title={bulkResults ? "Import results" : "Bulk import"}
      >
        {bulkResults ? (
          <div className="space-y-4">
            <Alert tone={bulkResults.failed > 0 ? "info" : "success"}>
              {bulkResults.succeeded} of {bulkResults.total} row
              {bulkResults.total === 1 ? "" : "s"} imported
              {bulkResults.failed > 0
                ? ` — ${bulkResults.failed} failed.`
                : "."}
            </Alert>

            {bulkResults.failed > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold text-ink dark:text-zinc-100">
                  Rows that failed
                </p>
                <ul className="space-y-1">
                  {bulkResults.rows
                    .map((r, i) => ({ r, i }))
                    .filter(({ r }) => !r.ok)
                    .map(({ r, i }) => (
                      <li key={i} className="text-xs text-red-500">
                        <span className="font-semibold">
                          {r.email || "(no email)"}
                        </span>{" "}
                        — {r.message}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {bulkResults.rows.some((r) => r.ok && r.temp_password) && (
              <div>
                <p className="mb-1.5 text-xs font-bold text-ink dark:text-zinc-100">
                  Temporary passwords
                </p>
                <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Share each one directly — they'll be forced to set their own
                  password the first time they sign in.
                </p>
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-cream p-3 dark:bg-zinc-800">
                  {bulkResults.rows
                    .filter((r) => r.ok && r.temp_password)
                    .map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate text-zinc-500 dark:text-zinc-400">
                          {r.email}
                        </span>
                        <code className="shrink-0 font-mono font-bold text-forest dark:text-gold">
                          {r.temp_password}
                        </code>
                      </div>
                    ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void copyBulkPasswords()}
                >
                  <Copy className="size-4" /> {bulkCopied ? "Copied" : "Copy all"}
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setBulkResults(null);
                  setBulkRows(null);
                  setBulkError(null);
                  setBulkCopied(false);
                }}
              >
                Import another file
              </Button>
              <Button className="flex-1" onClick={() => setShowBulk(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Upload a CSV with the columns{" "}
              <span className="font-semibold text-ink dark:text-zinc-200">
                email, full_name, instrument
              </span>{" "}
              (instrument optional) to add everyone at once. New accounts get a
              one-time temporary password, same as adding one member.
            </p>

            <div className="flex gap-2">
              <input
                ref={bulkFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void onBulkFile(e)}
              />
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => bulkFileRef.current?.click()}
              >
                <Upload className="size-4" /> Choose CSV
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                title="Download a CSV template with the expected columns"
                onClick={downloadTemplate}
              >
                <Download className="size-4" /> Template
              </Button>
            </div>

            {!isDirector && (
              <p className="rounded-xl bg-moss/30 px-3 py-2 text-xs font-semibold text-forest dark:bg-forest/30 dark:text-moss">
                Every row will be added to the {profile.instrument || "your"}{" "}
                section.
              </p>
            )}

            {bulkError && <Alert tone="error">{bulkError}</Alert>}

            {bulkRows && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-ink dark:text-zinc-100">
                    Preview — {readyCount} of {bulkRows.length} ready
                  </p>
                  {blockedCount > 0 && (
                    <p className="text-[11px] font-semibold text-red-500">
                      {blockedCount} skipped
                    </p>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl ring-1 ring-black/5 dark:ring-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-cream text-[10px] uppercase tracking-wide text-zinc-400 dark:bg-zinc-800">
                      <tr>
                        <th className="px-3 py-2 font-semibold">#</th>
                        <th className="px-3 py-2 font-semibold">Email</th>
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">Section</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((r, i) => (
                        <tr
                          key={i}
                          className="border-t border-zinc-100 dark:border-zinc-800"
                        >
                          <td className="px-3 py-1.5 text-zinc-400">{i + 1}</td>
                          <td className="max-w-36 truncate px-3 py-1.5 font-semibold text-ink dark:text-zinc-200">
                            {r.email || "—"}
                          </td>
                          <td className="max-w-28 truncate px-3 py-1.5 text-ink dark:text-zinc-200">
                            {r.full_name || "—"}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400">
                            {r.instrument || "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.issue ? (
                              <span className="font-semibold text-red-500">
                                {r.issue}
                              </span>
                            ) : r.warn ? (
                              <span className="font-semibold text-amber-600 dark:text-amber-400">
                                {r.warn}
                              </span>
                            ) : (
                              <span className="font-semibold text-forest dark:text-moss">
                                Ready
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Fix problem rows in the file and re-upload — ready rows import
                  now.
                </p>
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              loading={bulkSending}
              disabled={readyCount === 0}
              onClick={() => void submitBulk()}
            >
              Import {readyCount} member{readyCount === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </Modal>

      {/* reset password result */}
      <Modal
        open={resetPw !== null}
        onClose={() => setResetPw(null)}
        title="Temporary password"
      >
        {resetPw && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Share this temporary password with{" "}
              <span className="font-semibold text-ink dark:text-zinc-200">
                {resetPw.member.display_name || resetPw.member.full_name}
              </span>{" "}
              directly. They'll be forced to set their own password the first
              time they sign in.
            </p>
            <div className="rounded-xl bg-cream px-4 py-3 text-center font-mono text-xl font-black tracking-widest text-forest ring-1 ring-black/10 dark:bg-zinc-800 dark:text-gold dark:ring-white/10">
              {resetPw.tempPassword}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(resetPw.tempPassword);
                  } catch {
                    /* ignore — the code is on screen */
                  }
                }}
              >
                <Copy className="size-4" /> Copy
              </Button>
              <Button className="flex-1" onClick={() => setResetPw(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
