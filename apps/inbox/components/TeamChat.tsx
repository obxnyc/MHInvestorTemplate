"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clockTime, dayLabel } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-client";

type Thread = { id: string; title: string; lastAt: string; preview: string | null; unread: boolean };
type Colleague = { id: string; full_name: string; role: string };
type Msg = { id: string; body: string; at: string; who: string };

const initials = (n: string) =>
  n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/**
 * The team, talking to each other.
 *
 * Kept away from the shared line on purpose. "Can you cover Tuesday" is not a
 * conversation with a tenant: it has no contact, no category, nobody to claim
 * it, and nothing to send over SMS. Put it in the same list as repair requests
 * and the list stops being a list of work.
 */
export default function TeamChat() {
  const [data, setData] = useState<{ me: string; threads: Thread[]; colleagues: Colleague[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<{ me: string; messages: Msg[]; members: { id: string; full_name: string }[] } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(
    () => fetch("/api/team").then((r) => r.json()).then(setData), []);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/team/${id}`, { cache: "no-store" });
    if (res.ok) setThread(await res.json());
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    // Deep link from a push notification: /team?t=<id>
    const t = new URLSearchParams(window.location.search).get("t");
    if (t) setOpen(t);
  }, []);

  useEffect(() => {
    if (!open) { setThread(null); return; }
    setThread(null);
    loadThread(open);
  }, [open, loadThread]);

  // Live, so a reply appears while you are looking at it rather than when you
  // next reload.
  useEffect(() => {
    const channel = supabaseBrowser()
      .channel("team")
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "dm_messages" },
          () => { loadList(); if (open) loadThread(open); })
      .subscribe();
    return () => { supabaseBrowser().removeChannel(channel); };
  }, [open, loadList, loadThread]);

  useEffect(() => { bottom.current?.scrollIntoView(); }, [thread]);

  async function start(staffId: string) {
    const res = await fetch("/api/team", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId }),
    });
    const out = await res.json().catch(() => ({}));
    if (out.id) { await loadList(); setOpen(out.id); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !open) return;
    setBusy(true);
    const body = text;
    setText("");
    await fetch(`/api/team/${open}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    loadThread(open);
    loadList();
  }

  if (!data) return <main className="people"><p className="pinmuted pad">Loading…</p></main>;

  let lastDay = "";

  return (
    <div className="split">
      <div className="listcol">
        <div className="search"><strong style={{ fontSize: ".95rem" }}>Team</strong></div>

        <ul className="rows">
          {data.threads.map((t) => (
            <li key={t.id}>
              <button className={`row${open === t.id ? " sel" : ""}`}
                      onClick={() => setOpen(t.id)}>
                <span className="avwrap"><span className="av">{initials(t.title)}</span></span>
                <span className="rbody">
                  <span className="rtop">
                    <span className="rname">{t.title}</span>
                    {t.unread && <span className="pill warn">new</span>}
                  </span>
                  <span className="rprev">{t.preview ?? "No messages yet"}</span>
                </span>
              </button>
            </li>
          ))}

          <li className="teamlab">Start a conversation</li>
          {data.colleagues.map((c) => (
            <li key={c.id}>
              <button className="row" onClick={() => start(c.id)}>
                <span className="avwrap"><span className="av">{initials(c.full_name)}</span></span>
                <span className="rbody">
                  <span className="rtop"><span className="rname">{c.full_name}</span></span>
                  <span className="rprev">{c.role}</span>
                </span>
              </button>
            </li>
          ))}
          {!data.colleagues.length && !data.threads.length && (
            <li className="none">Nobody else is set up yet.</li>
          )}
        </ul>
      </div>

      {!open || !thread ? (
        <div className="chatcol idle">
          <div className="empty"><div>
            <h3>{open ? "Opening…" : "Nobody selected"}</h3>
            <p>Pick someone to talk to. Nothing here is sent outside the office.</p>
          </div></div>
        </div>
      ) : (
        <div className="chatcol">
          <div className="chead">
            <button type="button" className="chevron" onClick={() => setOpen(null)}>&lsaquo;</button>
            <span className="cwho">
              <span className="nm">
                {thread.members.filter((m) => m.id !== thread.me)
                  .map((m) => m.full_name).join(", ") || "Just you"}
              </span>
              <span className="sub"><span className="dim">Internal — never sent outside</span></span>
            </span>
          </div>

          <div className="msgs">
            {thread.messages.map((m) => {
              const day = dayLabel(m.at);
              const sep = day !== lastDay ? ((lastDay = day), day) : null;
              const mine = m.who && thread.members.find((x) => x.id === thread.me)?.full_name === m.who;
              return (
                <div key={m.id} className="mrow">
                  {sep && <div className="daysep">{sep}</div>}
                  <div className={mine ? "out" : "in"}>
                    {!mine && <span className="attrib">{m.who}</span>}
                    <div className="bwrap"><div className="b">{m.body}</div></div>
                    <span className="delivered">{clockTime(m.at)}</span>
                  </div>
                </div>
              );
            })}
            {!thread.messages.length && (
              <p className="none">Nothing yet. Say something.</p>
            )}
            <div ref={bottom} />
          </div>

          <form className="composer" onSubmit={send}>
            <div className="inputrow">
              <textarea rows={1} value={text} placeholder="Message your team"
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                        }} />
              <button className="sendbtn" disabled={busy || !text.trim()}>↑</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
