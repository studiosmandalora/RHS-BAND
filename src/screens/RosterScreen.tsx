import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Copy,
  KeyRound,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
  reactivateMember,
  resetMemberPassword,
  setBandJoinCode,
  updateMemberInstrument,
} from "../lib/rpc";
import type { Profile, Role } from "../lib/types";
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
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <UserPlus className="size-4" /> Add member
          </Button>
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
