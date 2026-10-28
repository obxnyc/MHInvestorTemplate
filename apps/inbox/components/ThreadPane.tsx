"use client";
import { useCallback, useEffect, useState } from "react";
import { threadLabel, prettyPhone, clockTime, dayLabel, initials } from "@/lib/format";
import { catLabel, propertyOf } from "@/lib/category";
import Composer from "./Composer";
import AskThese from "./AskThese";
import ClaimPill from "./ClaimPill";
import CloseButton from "./CloseButton";
import MessageMenu from "./MessageMenu";
import Seen, { type Read } from "./Seen";
import CategoryPicker from "./CategoryPicker";
import OpenJobs, { type Job } from "./OpenJobs";
import VendorJobs, { type VendorJob } from "./VendorJobs";
import Bubble from "./Bubble";
import ContactEditor from "./ContactEditor";
import Avatar from "@/components/Avatar";
import { languageName } from "@/lib/translate";
import { supabaseBrowser } from "@/lib/supabase-client";
import { joinTyping, TYPING_TTL } from "@/lib/typing";
import { continues } from "@/lib/runs";
import PlaceNeeded from "@/components/PlaceNeeded";
import NotesPanel, { type Note } from "@/components/NotesPanel";
import Attachment from "@/components/Attachment";
import IntakeCard from "@/components/IntakeCard";
import NewJob from "@/components/NewJob";

type Thread = {
  convo: Record<string, unknown>;
  messages: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  media: Record<string, string>;
  reads: Read[];
  jobs: Job[];
  /** Jobs this person is carrying out for us, where they are a vendor. */
  doing: VendorJob[];
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
  const [naming, setNaming] = useState(false);
  const [raising, setRaising] = useState(false);
  const [trades, setTrades] = useState<{ id: string; label: string }[]>([]);
  // Questions pushed into the box, and what has been ticked off. Held here
  // rather than in the strip so a reload of the thread does not lose them.
  const [insert, setInsert] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const [asked, setAsked] = useState<string[]>([]);

  useEffect(() => {
    // The same list the jobs board uses -- it comes back alongside the jobs,
    // and a second source for it is how the trade on a job raised from a
    // thread ends up not matching the one on a job raised from the board,
    // which splits the price history in two.
    fetch("/api/jobs").then((r) => r.json())
      .then((d) => setTrades(d.trades ?? [])).catch(() => setTrades([]));
  }, []);

  const load = useCallback(async (conversationId: string) => {
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/thread`, {
      cache: "no-store",
    });
    if (!res.ok) { setError("Couldn't open that conversation."); return; }
    const json = await res.json() as Thread;
    setData(json);
    // The ticks live on the conversation, so they come back with it -- and
    // they belong to THIS thread, so they are replaced rather than merged.
    setAsked((json.convo as { asked?: string[] | null }).asked ?? []);
  }, []);

  useEffect(() => {
    // Cleared on every change of thread, including to nothing. Without this an
    // error from one conversation stayed on screen over the next one, and over
    // an empty pane -- so a single failure looked like everything was broken.
    setError(null);
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
    subject: string | null; asked: string[] | null;
    /** What the request called the place, if it came from Tenant Web
     *  Access. Null on a text message, which has no subject line. */
    place_hint: string | null;
    category_confidence: number | null; assigned_to: string | null;
    units: unknown;
    contacts: {
      id: string; phone: string; full_name: string | null; party: string;
      unit_id: string | null; language: string | null; units: unknown;
    } | null;
    staff: { full_name: string } | null;
  };
  const contact = convo.contacts;
  /* Not a synthetic key -- see threadLabel. The open thread had the same
     `email:rm:issue:251` as its heading, which is the id of a row rather
     than the name of anybody. */
  const name = threadLabel(contact?.full_name, contact?.phone,
    convo.subject ?? (data.messages[0]?.body as string | undefined));
  const prop = propertyOf(convo.units as never, contact?.units as never);
  const party = contact?.party && contact.party !== "other"
    ? contact.party.replace("_", " ") : null;

  // The last thing THEY said, which is what a work order is about. The last
  // thing in the thread is as often our own reply, and a job summarised from
  // "I'll get someone out Tuesday" tells the tech nothing.
  const lastFromThem = [...data.messages]
    .reverse()
    .find((m) => m.direction === "inbound")
    ?.body as string | undefined ?? "";

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
        <Avatar name={name} />
        <span className="cwho">
          <button type="button" className="nm nmbtn" onClick={() => setNaming(true)}
                  title="Name this contact">
            {name}
            {!contact?.full_name && <span className="addname">+ add name</span>}
          </button>
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
        {/* Gathered as well as inline. A note lives in the thread where it
            was written -- context is most of what it means -- but a thread is
            a scroll, and the line that matters is four hundred messages up by
            the time it does. */}
        <NotesPanel notes={(data.notes ?? []) as unknown as Note[]} media={data.media} />
        <ClaimPill conversationId={convo.id}
                   holderName={convo.staff?.full_name ?? null}
                   isMine={convo.assigned_to === data.me} />
        <CloseButton conversationId={convo.id} isClosed={convo.status === "closed"} />
      </div>

      {/* NOT FILED AGAINST ANY PROPERTY.
          A request arrives knowing the tenant, their number and what Rent
          Manager calls the place -- and none of that is a property we hold.
          Left quiet, it reads as an ordinary thread and the work order under
          it says "Address not set", which nobody goes looking for.
          Said loudly, it is a job: match it to a property, or add the
          property. Once either is done the next request from that address
          files itself, so this is a thing somebody does ONCE per address. */}
      {convo.place_hint && !prop ? (
        <PlaceNeeded conversationId={convo.id} hint={convo.place_hint} />
      ) : null}

      <OpenJobs jobs={data.jobs ?? []} />

      {/* A text message is how a repair actually gets reported to a landlord
          this size, and until now it became a thread and stopped there --
          `ingest` opens a work order for the FORM sources, where somebody
          filled in a box headed Issue Title, and deliberately not for a text,
          because "the heat's a bit funny" is a conversation. But there was no
          way to promote one either, so the deliberate half had no other half.

          Prefilled from what they wrote, and from the lot their contact
          record carries. Not created automatically: the lot and the urgency
          are what make a job dispatchable, and the person reading the thread
          is the one who knows them. */}
      {raising ? (
        <NewJob trades={trades}
                from={{
                  conversationId: convo.id,
                  summary: lastFromThem.slice(0, 120),
                  detail: lastFromThem,
                  unitId: contact?.unit_id ?? null,
                }}
                onClose={() => setRaising(false)}
                onMade={() => { setRaising(false); void load(convo.id); }} />
      ) : null}
      {/* Two different questions, and a vendor's thread only has an answer to
          the second: what is outstanding at this address, and what is this
          person doing for us. */}
      <VendorJobs jobs={data.doing ?? []} />

      {convo.category_confidence !== null && convo.category_confidence < 0.75 && (
        <div className="unsure">
          Filed as <strong>{catLabel(convo.category)}</strong> but we
          weren&rsquo;t confident — change it above if that&rsquo;s wrong.
        </div>
      )}

      <div className="msgs">
        {timeline.map((item, i) => {
          const day = dayLabel(item.at);
          const sep = day !== lastDay ? ((lastDay = day), day) : null;

          /** Who is speaking, for run detection. A note breaks a run: it is
           *  a different kind of thing said by a different kind of voice. */
          const voice = (t: typeof item | undefined) => {
            if (!t || t.kind !== "message") return null;
            const msg = t.m as { direction: string; staff: { full_name: string } | null };
            return {
              who: msg.direction === "inbound"
                ? "them" : msg.staff?.full_name ?? "Automated",
              at: t.at,
            };
          };
          const here = voice(item);
          const run = Boolean(here && continues(voice(timeline[i - 1]), here, Boolean(sep)));
          const nextOne = voice(timeline[i + 1]);
          const last = !here || !nextOne || !continues(here, nextOne, false);

          if (item.kind === "note") {
            const n = item.n as {
              id: string; body: string; media_paths?: string[] | null;
              staff: { full_name: string } | null;
            };
            return (
              <div key={`n${n.id}`} className="mrow">
                {sep && <div className="daysep">{sep}</div>}
                <div className="note">
                  <span className="lab">{n.staff?.full_name} · only your team sees this</span>
                  {n.body && <p>{n.body}</p>}
                  {(n.media_paths ?? []).map((path) => (
                    <Attachment key={path} path={path} src={data.media[path]} />
                  ))}
                </div>
              </div>
            );
          }

          const m = item.m as {
            id: string; direction: string; body: string; body_en: string | null;
            lang: string | null; status: string; channel: string;
            media_paths: string[] | null; staff: { full_name: string } | null;
          };
          const isSystem = m.direction === "inbound" && m.channel !== "sms";
          return (
            <div key={`m${m.id}`} className="mrow">
              {sep && <div className="daysep">{sep}</div>}
              {isSystem && (
                <div className="sys"><b>{labelFor(m.channel)}</b> · {clockTime(item.at)}</div>
              )}
              <div className={`${m.direction === "inbound" ? "in" : "out"}`
                              + `${run ? " run" : ""}${last ? " last" : ""}`}>
                {m.direction === "outbound" && (
                  <span className="attrib">
                    <span className={m.staff?.full_name ? "pip" : "pip auto"} />
                    {m.staff?.full_name ?? "Automated"}
                  </span>
                )}
                <div className="bwrap">
                  {/* A portal submission is a form, not a text message, and a
                      bubble is the wrong shape for it. The original is one
                      click away and nothing is discarded -- what changes is
                      what you read first. */}
                  {isSystem
                    ? <IntakeCard body={String(m.body)} label={labelFor(m.channel)} />
                    : <Bubble body={m.body} english={m.body_en} lang={m.lang}
                              outbound={m.direction === "outbound"} />}
                  <MessageMenu messageId={m.id} preview={String(m.body).slice(0, 180)} />
                </div>
                {(m.media_paths ?? []).map((path) => (
                  <Attachment key={path} path={path} src={data.media[path]} />
                ))}
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

      {naming && contact && (
        <ContactEditor
          contactId={contact.id} name={contact.full_name} phone={contact.phone}
          party={contact.party} unitId={contact.unit_id} language={contact.language}
          onClose={() => setNaming(false)} />
      )}

      {typing && (
        <p className="typing" aria-live="polite">
          {typing.name} is typing…
        </p>
      )}

      <AskThese conversationId={String(convo.id)}
                category={String(convo.category ?? "other")}
                context={[convo.subject, data.messages.at(-1)?.body]
                  .filter(Boolean).join(" ")}
                lastInbound={data.messages.at(-1)?.direction === "inbound"}
                asked={asked} onAsked={setAsked}
                onInsert={(text) => setInsert((i) => ({ text, n: i.n + 1 }))} />

      <Composer conversationId={convo.id} myName={data.meName} insert={insert}
                onSent={() => load(String(convo.id))}
                sendsIn={contact?.language && contact.language !== "en"
                  ? languageName(contact.language) : null} />
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
