"use client";
import { useCallback, useEffect, useState } from "react";
import { prettyPhone, clockTime, dayLabel } from "@/lib/format";
import { catLabel, propertyOf } from "@/lib/category";
import Composer from "./Composer";
import ClaimPill from "./ClaimPill";
import CloseButton from "./CloseButton";
import MessageMenu from "./MessageMenu";
import Seen, { type Read } from "./Seen";
import CategoryPicker from "./CategoryPicker";
import OpenJobs, { type Job } from "./OpenJobs";
import { supabaseBrowser } from "@/lib/supabase-client";
import { joinTyping, TYPING_TTL } from "@/lib/typing";

/** A name gives initials; an unsaved number gives its last two digits. */
function initials(n: string) {
  const s = String(n).trim();
  if (/^[\d\s()+\-.]+$/.test(s)) return s.replace(/\D/g, "").slice(-2) || "#";
  return s.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type Thread = {
  convo: Record<string, unknown>;
  messages: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  media: Record<string, string>;
  reads: Read[];
  jobs: Job[];
  me: string;
  meName: string;
};

/**
 * The open conversation, in the right-hand pane.
 *
 * This is a client component and it loads its own data, which is the whole
 * point: selecting a conversation must not be a navigation. Every server-
 * rendered version of this ended up feeling like a different screen -- the URL
 * changed, the page re-rendered, and however carefully the list was kept in the
 * markup, what a person experienced was being taken somewhere. Four attempts at
 * fixing that with layout were four wrong answers to the right complaint.
 *
 * Here the inbox never navigates. Clicking a row changes a variable.
 */
export default function ThreadPane(
  { id, onBack }: { id: string | null; onBack: () => void },
) {
  const [data, setData] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ name: string; at: number } | null>(null);

  const load = useCallback(async (conversationId: string) => {
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/thread`, {
      cache: "no-store",
    });
    if (!res.ok) { setError("Couldn't open that conversation."); return; }
    setData(await res.json());
  }, []);

  useEffect(() => {
    if (!id) { setData(null); return; }
    // Cleared first, so a slow load never shows the previous conversation's
    // messages under the new one's name.
    setData(null);
    setTyping(null);
    load(id);

    // Opening a thread is what "read" means. Recorded on open rather than on
    // scroll: a receipt that requires reaching the bottom would mark the long
    // messages unread precisely when someone has read the important part.
    supabaseBrowser().rpc("mark_conversation_read", { p_conversation: id })
      .then(({ error }) => { if (error) console.error("read receipt failed", error); });
  }, [id, load]);

  // Somebody else on the team is writing a reply. Shown so two people do not
  // answer the same tenant from the same number a minute apart.
  useEffect(() => {
    if (!id) return;
    const ch = joinTyping(id, (name) => setTyping({ name, at: Date.now() }));
    const tick = setInterval(() => {
      setTyping((t) => (t && Date.now() - t.at > TYPING_TTL ? null : t));
    }, 1000);
    return () => { ch.unsubscribe(); clearInterval(tick); };
  }, [id]);

  // Anything that changes the thread -- a reply, a note, a hand-off -- asks for
  // a refresh rather than a page reload.
  useEffect(() => {
    const again = () => { if (id) load(id); };
    window.addEventListener("thread:refresh", again);
    return () => window.removeEventListener("thread:refresh", again);
  }, [id, load]);

  if (!id) {
    return (
      <div className="chatcol idle">
        <div className="empty">
          <div>
            <div className="ic">
              <svg viewBox="0 0 24 24">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z" />
              </svg>
            </div>
            <h3>No conversation selected</h3>
            <p>Pick one from the list, or start a new message.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="chatcol"><p className="none">{error}</p></div>;
  }
  if (!data) {
    return <div className="chatcol"><p className="none">Opening…</p></div>;
  }

  const convo = data.convo as {
    id: string; category: string; source: string; status: string;
    category_confidence: number | null; assigned_to: string | null;
    units: unknown; contacts: { phone: string; full_name: string | null; party: string; units: unknown } | null;
    staff: { full_name: string } | null;
  };
  const contact = convo.contacts;
  const name = contact?.full_name || prettyPhone(contact?.phone ?? "");
  const prop = propertyOf(convo.units as never, contact?.units as never);
  const party = contact?.party && contact.party !== "other"
    ? contact.party.replace("_", " ") : null;

  const timeline = [
    ...data.messages.map((m) => ({ kind: "message" as const, at: m.created_at as string, m })),
    ...data.notes.map((n) => ({ kind: "note" as const, at: n.created_at as string, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const readersOf = (at: string) =>
    data.reads.filter((r) => r.staffId !== data.me && r.at >= at);

  let lastDay = "";

  return (
    <div className="chatcol">
      <div className="chead">
        <button type="button" className="chevron" aria-label="Back to messages"
                onClick={onBack}>&lsaquo;</button>
        <span className="av">{initials(name)}</span>
        <span className="cwho">
          <span className="nm">{name}</span>
          <span className="sub">
            <CategoryPicker conversationId={convo.id} category={convo.category} />
            {party && <span className="dim">{party}</span>}
            {prop && (
              <span className="dim">
                <span className="pdot" style={{ background: prop.color }} />
                {prop.name}{prop.unit ? ` · ${prop.unit}` : ""}
              </span>
            )}
            <span className="dim">via {convo.source}</span>
          </span>
        </span>
        <ClaimPill conversationId={convo.id}
                   holderName={convo.staff?.full_name ?? null}
                   isMine={convo.assigned_to === data.me} />
        <CloseButton conversationId={convo.id} isClosed={convo.status === "closed"} />
      </div>

      <OpenJobs jobs={data.jobs ?? []} />

      {convo.category_confidence !== null && convo.category_confidence < 0.75 && (
        <div className="unsure">
          Filed as <strong>{catLabel(convo.category)}</strong> but we
          weren&rsquo;t confident — change it above if that&rsquo;s wrong.
        </div>
      )}

      <div className="msgs">
        {timeline.map((item) => {
          const day = dayLabel(item.at);
          const sep = day !== lastDay ? ((lastDay = day), day) : null;

          if (item.kind === "note") {
            const n = item.n as { id: string; body: string; staff: { full_name: string } | null };
            return (
              <div key={`n${n.id}`} className="mrow">
                {sep && <div className="daysep">{sep}</div>}
                <div className="note">
                  <span className="lab">{n.staff?.full_name} · only your team sees this</span>
                  <p>{n.body}</p>
                </div>
              </div>
            );
          }

          const m = item.m as {
            id: string; direction: string; body: string; status: string;
            channel: string; media_paths: string[] | null; staff: { full_name: string } | null;
          };
          const isSystem = m.direction === "inbound" && m.channel !== "sms";
          return (
            <div key={`m${m.id}`} className="mrow">
              {sep && <div className="daysep">{sep}</div>}
              {isSystem && (
                <div className="sys"><b>{labelFor(m.channel)}</b> · {clockTime(item.at)}</div>
              )}
              <div className={m.direction === "inbound" ? "in" : "out"}>
                {m.direction === "outbound" && (
                  <span className="attrib">
                    <span className={m.staff?.full_name ? "pip" : "pip auto"} />
                    {m.staff?.full_name ?? "Automated"}
                  </span>
                )}
                <div className="bwrap">
                  <div className="b">{m.body}</div>
                  <MessageMenu messageId={m.id} preview={String(m.body).slice(0, 180)} />
                </div>
                {(m.media_paths ?? []).map((path, i) => {
                  const src = data.media[path];
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={path} src={src} alt={`Attachment ${i + 1}`} className="mms" />
                  ) : (
                    <span key={path} className="mms-gone">Attachment unavailable</span>
                  );
                })}
                <span className={
                  m.status === "failed" || m.status === "undelivered"
                    ? "delivered bad" : "delivered"
                }>
                  {clockTime(item.at)}
                  {m.direction === "outbound" && ` · ${deliveryLabel(m.status)}`}
                </span>
                {/* On what a tenant sent, not on our own replies: the question a
                    shared line needs answered is whether their message has been
                    seen, not whether the office read itself. */}
                {m.direction === "inbound" && <Seen readers={readersOf(item.at)} />}
              </div>
            </div>
          );
        })}
      </div>

      {typing && (
        <p className="typing" aria-live="polite">
          {typing.name} is typing…
        </p>
      )}

      <Composer conversationId={convo.id} myName={data.meName} />
    </div>
  );
}

/** Carrier truth, not app optimism: "sent" only means Twilio accepted it. */
function deliveryLabel(status: string) {
  return { delivered: "Delivered", sent: "Sent", queued: "Sending",
           failed: "Not delivered", undelivered: "Undelivered" }[status] ?? status;
}

function labelFor(channel: string) {
  return { voicemail: "Voicemail", zego: "Work order", zillow: "Zillow enquiry",
           website: "Website form" }[channel] ?? channel;
}
