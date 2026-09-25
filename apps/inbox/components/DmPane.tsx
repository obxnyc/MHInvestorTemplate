"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clockTime, dayLabel } from "@/lib/format";
import Seen, { type Read } from "./Seen";
import { supabaseBrowser } from "@/lib/supabase-client";

type Msg = { id: string; body: string; at: string; who: string };
type Person = { id: string; full_name: string };
type Thread = {
  me: string; members: Person[]; messages: Msg[];
  /** When each person last opened the thread, which is what read receipts are
   *  worked out from. */
  reads: Read[];
  oversight: string[]; viewingOnly: boolean;
};

/**
 * A conversation with a colleague, in the same pane as everything else.
 *
 * Sitting in the same list as the tenants is the point: you do not keep a
 * separate app open to ask Hannah whether she called the plumber. What keeps it
 * safe is that it is plainly marked and structurally incapable of leaving the
 * building -- there is no phone number on this thread and no way to send one.
 */
export default function DmPane(
  { id, onBack }: { id: string; onBack: () => void },
) {
  const [data, setData] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [roster, setRoster] = useState<Person[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  /** Who had opened this thread at or after the moment a message landed, which
   *  is as close to "read it" as a thread view can honestly claim. Never
   *  includes you: your own receipt on your own message is noise. */
  const seenBy = (at: string): Read[] =>
    (data?.reads ?? []).filter((r) => r.staffId !== data?.me && r.at >= at);

  const load = useCallback(async () => {
    const res = await fetch(`/api/team/${id}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => { setData(null); load(); }, [load]);

  useEffect(() => {
    if (!editing || roster.length) return;
    fetch("/api/team").then((r) => r.json())
      .then((d) => setRoster(d.colleagues ?? [])).catch(() => {});
  }, [editing, roster.length]);

  async function changeMembers(patch: { add?: string; remove?: string }) {
    await fetch(`/api/team/${id}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
  }
  useEffect(() => { bottom.current?.scrollIntoView(); }, [data]);

  useEffect(() => {
    const channel = supabaseBrowser()
      .channel(`dm:${id}`)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "dm_messages" }, () => load())
      .subscribe();
    return () => { supabaseBrowser().removeChannel(channel); };
  }, [id, load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const body = text;
    setText("");
    await fetch(`/api/team/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    load();
  }

  if (!data) return <div className="chatcol"><p className="none">Opening…</p></div>;

  const me = data.members.find((m) => m.id === data.me)?.full_name;
  const others = data.members.filter((m) => m.id !== data.me);
  let lastDay = "";

  return (
    <div className="chatcol">
      <div className="chead">
        <button type="button" className="chevron" onClick={onBack}
                aria-label="Back to messages">&lsaquo;</button>
        <span className="cwho">
          <span className="nm">{others.map((o) => o.full_name).join(", ") || "Just you"}</span>
          <span className="sub">
            <span className="badge staffbadge">Staff</span>
            <span className="dim">Internal — never sent outside</span>
          </span>
        </span>
        {!data.viewingOnly && (
          <button type="button" className="mini" onClick={() => setEditing((v) => !v)}>
            {others.length > 1 ? "Who's in" : "Add someone"}
          </button>
        )}
      </div>

      {editing && !data.viewingOnly && (
        <div className="grouped">
          <p className="fieldlab">In this conversation</p>
          <ul className="memberlist">
            {data.members.map((m) => (
              <li key={m.id}>
                <span>{m.full_name}{m.id === data.me ? " (you)" : ""}</span>
                {data.members.length > 2 && (
                  <button className="mini" onClick={() => changeMembers({ remove: m.id })}>
                    {m.id === data.me ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="fieldlab">Add</p>
          <div className="chipset">
            {roster.filter((c) => !data.members.some((m) => m.id === c.id)).map((c) => (
              <button key={c.id} className="chip"
                      onClick={() => changeMembers({ add: c.id })}>{c.full_name}</button>
            ))}
            {!roster.filter((c) => !data.members.some((m) => m.id === c.id)).length && (
              <span className="pinmuted">Everybody is already in.</span>
            )}
          </div>
          <p className="pinmuted" style={{ marginTop: ".5rem", fontSize: ".78rem" }}>
            Adding or removing somebody is written into the conversation, so
            nobody finds out later that someone has been reading along.
          </p>
        </div>
      )}

      {/* Worked out per message from each person's last-read time rather than
          stored per message: for five people and a hundred messages that would
          be five hundred rows saying what five timestamps already say. */}
      <div className="msgs">
        {data.messages.map((m) => {
          const day = dayLabel(m.at);
          const sep = day !== lastDay ? ((lastDay = day), day) : null;
          const mine = m.who === me;
          const system = m.who === "Someone";
          if (system) {
            return (
              <div key={m.id} className="mrow">
                {sep && <div className="daysep">{sep}</div>}
                <div className="sys">{m.body} · {clockTime(m.at)}</div>
              </div>
            );
          }
          return (
            <div key={m.id} className="mrow">
              {sep && <div className="daysep">{sep}</div>}
              <div className={mine ? "out" : "in"}>
                {/* On your own messages too. In a group of four, "who said
                    that" is the question, and answering it for everyone except
                    the person reading is an odd place to stop -- the tenant
                    threads have always named the sender on both sides. */}
                <span className="attrib">{mine ? "You" : m.who}</span>
                <div className="bwrap"><div className="b"><Body text={m.body} /></div></div>
                <span className="delivered">
                  {clockTime(m.at)}
                  {/* Only on our own. Whether THEY have read what we sent is
                      the question; whether we read our own message is not. */}
                  {mine && <Seen readers={seenBy(m.at)} />}
                </span>
              </div>
            </div>
          );
        })}
        {!data.messages.length && <p className="none">Nothing yet. Say something.</p>}
        <div ref={bottom} />
      </div>

      {data.viewingOnly ? (
        <p className="viewonly">
          You can read this because you have oversight. You are not in it, so
          there is nothing to send.
        </p>
      ) : (
      <form className="composer" onSubmit={send}>
        <div className="inputrow">
          <textarea rows={1} value={text} placeholder="Message — stays inside the office"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                    }} />
          <button className="sendbtn" disabled={busy || !text.trim()}>↑</button>
        </div>
      </form>
      )}
    </div>
  );
}


/**
 * A staff message, with its links made usable.
 *
 * A forward arrives carrying a link back to the conversation it came from, and
 * as raw text that is a forty-character UUID somebody has to select and paste.
 * Ours become a button that says where it goes; everything else becomes a
 * plain link, because a colleague pasting a URL means it to be clickable.
 */
function Body({ text }: { text: string }) {
  const parts = String(text).split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;

        const convo = /\/c\/([0-9a-f-]{36})/i.exec(part);
        if (convo) {
          return (
            <a key={i} className="jumpto" href={`/c/${convo[1]}`}>
              Jump to the conversation <span aria-hidden="true">→</span>
            </a>
          );
        }
        const team = /\/team\?t=([0-9a-f-]{36})/i.exec(part);
        if (team) {
          return (
            <a key={i} className="jumpto" href={`/team?t=${team[1]}`}>
              Open that thread <span aria-hidden="true">→</span>
            </a>
          );
        }
        return (
          <a key={i} className="inlink" href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        );
      })}
    </>
  );
}
