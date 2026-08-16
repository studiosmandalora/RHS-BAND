import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MessageSquare, Send } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { ChannelRow, MessageRow, Profile } from "../lib/types";
import { fmtTime, relativeDay } from "../lib/date";
import { sectionDot } from "../lib/constants";
import { Alert, Card, cn } from "../components/ui";
import { Avatar } from "../components/Avatar";

const PAGE_SIZE = 60;

function dayGroupKey(iso: string): string {
  return new Date(iso).toDateString();
}

export default function ChatScreen() {
  const { profile } = useOutletContext<{ profile: Profile }>();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [senders, setSenders] = useState<Record<string, Profile>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = channels.find((c) => c.id === activeId) ?? null;

  /* channels (RLS already restricts to what this user may see) */
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("chat_channels")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as ChannelRow[]) ?? [];
        const sorted = [...rows].sort((a, b) => {
          if (a.is_general !== b.is_general) return a.is_general ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setChannels(sorted);
        setActiveId((prev) => prev ?? sorted[0]?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* messages for the active channel + realtime */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    void supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", activeId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data }) => {
        if (cancelled) return;
        setMessages(((data as MessageRow[]) ?? []).reverse());
      });

    const channel = supabase
      .channel(`chat-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${activeId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRow]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  /* sender profiles (fetch all once — roster is small) */
  useEffect(() => {
    let cancelled = false;
    supabase.from("profiles").select("*").then(({ data }) => {
      if (cancelled) return;
      const map: Record<string, Profile> = {};
      for (const p of (data as Profile[]) ?? []) map[p.id] = p;
      setSenders(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* scroll to bottom on new messages */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  const grouped = useMemo(() => {
    const groups: { key: string; items: MessageRow[] }[] = [];
    for (const m of messages) {
      const key = dayGroupKey(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m);
      else groups.push({ key, items: [m] });
    }
    return groups;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active || !profile) return;
    setSending(true);
    setSendError(null);
    const { error } = await supabase.from("chat_messages").insert({
      channel_id: active.id,
      sender_id: profile.id,
      text,
    });
    setSending(false);
    if (error) {
      setSendError(error.message);
      return;
    }
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col px-4 pt-5">
      <div className="mb-3">
        <h1 className="text-xl font-black text-ink dark:text-zinc-100">Chat</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {profile.role === "director"
            ? "You can post in every channel."
            : `Messages in ${profile.instrument || "your section"} are visible only to your section.`}
        </p>
      </div>

      {/* channel pills */}
      {channels.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                activeId === c.id
                  ? "bg-forest text-white dark:bg-mid"
                  : "bg-white text-zinc-500 ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/10"
              )}
            >
              <span className={cn("size-2 rounded-full", sectionDot(c.section))} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* messages */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3"
      >
        {!active ? (
          <Card className="p-6 text-center">
            <MessageSquare className="mx-auto mb-2 size-8 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              No channels for you yet
            </p>
          </Card>
        ) : (
          grouped.map((g) => (
            <div key={g.key}>
              <div className="mb-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-black/5 dark:bg-white/10" />
                <span className="text-[11px] font-semibold text-zinc-400">
                  {relativeDay(g.items[0].created_at)}
                </span>
                <div className="h-px flex-1 bg-black/5 dark:bg-white/10" />
              </div>
              <div className="space-y-2">
                {g.items.map((m) => {
                  const sender = senders[m.sender_id];
                  const mine = m.sender_id === profile.id;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-end gap-2",
                        mine && "flex-row-reverse"
                      )}
                    >
                      {!mine && (
                        <Avatar
                          name={sender?.display_name ?? "?"}
                          url={sender?.avatar_url}
                          size="xs"
                          className="mb-4"
                        />
                      )}
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-3.5 py-2",
                          mine
                            ? "rounded-br-md bg-forest text-white dark:bg-mid"
                            : "rounded-bl-md bg-white ring-1 ring-black/5 dark:bg-zinc-800 dark:ring-white/10"
                        )}
                      >
                        {!mine && (
                          <p
                            className={cn(
                              "mb-0.5 text-[11px] font-bold",
                              "text-forest dark:text-gold"
                            )}
                          >
                            {sender?.display_name ?? "Band member"}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words text-sm leading-snug text-inherit dark:text-zinc-100">
                          {m.text}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-right text-[10px]",
                            mine
                              ? "text-white/60"
                              : "text-zinc-400 dark:text-zinc-500"
                          )}
                        >
                          {fmtTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {sendError && <Alert tone="error" className="mb-2">{sendError}</Alert>}

      {/* composer */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-black/5 py-3 dark:border-white/10"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${active ? active.name : "…"}`}
          maxLength={2000}
          className="min-h-11 flex-1 rounded-full bg-white px-4 text-sm text-ink placeholder:text-zinc-400 ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-mid dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || !active}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-forest text-white transition-colors hover:bg-mid disabled:opacity-40 dark:bg-mid"
          aria-label="Send message"
        >
          <Send className="size-5" />
        </button>
      </form>
    </div>
  );
}