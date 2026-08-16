import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import { inviteMember } from "../lib/rpc";
import type { Profile } from "../lib/types";
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

export default function RosterScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const isDirector = profile.role === "director";
  const [members, setMembers] = useState<Profile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add-member modal
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addInstrument, setAddInstrument] = useState<string>(INSTRUMENTS[0]);
  const [adding, setAdding] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    const rows = (data as Profile[]) ?? [];
    // section leaders: their own section only
    setMembers(
      profile.role === "section_leader"
        ? rows.filter((m) => m.instrument === profile.instrument)
        : rows
    );
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.role]);

  async function changeRole(member: Profile, role: "student" | "section_leader") {
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", member.id);
    if (error) setError(error.message);
    else void load();
  }

  async function changeInstrument(member: Profile, instrument: string) {
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ instrument })
      .eq("id", member.id);
    if (error) setError(error.message);
    else void load();
  }

  async function removeMember(member: Profile) {
    if (
      !window.confirm(
        `Remove ${member.display_name || member.full_name} from the roster? They won't be able to use the app anymore.`
      )
    )
      return;
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", member.id);
    if (error) setError(error.message);
    else void load();
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setAdding(true);
    const { result, error } = await inviteMember(
      addEmail.trim(),
      addName.trim(),
      addInstrument
    );
    setAdding(false);
    if (error || !result?.ok) {
      setError(error?.message ?? result?.message ?? "Could not add member.");
      return;
    }
    setNotice(
      `${result.message} (temporary password: ${result.temp_password}) — tell them to change it in Profile.`
    );
    setShowAdd(false);
    setAddName("");
    setAddEmail("");
    void load();
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-ink dark:text-zinc-100">Roster</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isDirector
              ? "Manage members and section leaders."
              : "Your section (read-only)."}
          </p>
        </div>
        {isDirector && (
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
          subtitle={
            isDirector
              ? "Add members so they can check in at events."
              : "Ask your director to add section members."
          }
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const editable = isDirector && m.role !== "director";
            return (
              <Card key={m.id} className="p-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={m.display_name || m.full_name} url={m.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink dark:text-zinc-100">
                        {m.display_name || m.full_name}
                        {m.id === profile.id && (
                          <span className="ml-1 text-xs font-semibold text-zinc-400">
                            (you)
                          </span>
                        )}
                      </p>
                      <Badge className={ROLE_CHIP[m.role]}>
                        {ROLE_LABEL[m.role]}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-zinc-400">
                      {m.full_name}
                    </p>
                  </div>
                  {isDirector && m.role === "director" && (
                    <ShieldCheck className="size-5 text-gold" />
                  )}
                  {editable && (
                    <button
                      onClick={() => void removeMember(m)}
                      className="rounded-full p-2 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      aria-label={`Remove ${m.display_name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
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
                    <Field label="Role">
                      <Select
                        value={m.role}
                        onChange={(e) =>
                          void changeRole(
                            m,
                            e.target.value as "student" | "section_leader"
                          )
                        }
                        className="!min-h-9 text-xs"
                      >
                        <option value="student">Student</option>
                        <option value="section_leader">Section leader</option>
                      </Select>
                    </Field>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* add member modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add member">
        <form onSubmit={submitAdd} className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Creates a sign-in for them with a temporary password — they can
            change it in Profile.
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
          <Button type="submit" size="lg" loading={adding} className="w-full">
            Add to roster
          </Button>
        </form>
      </Modal>
    </div>
  );
}