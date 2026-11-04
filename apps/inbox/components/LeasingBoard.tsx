"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import { money } from "@/lib/prices";
import { spell, howLong, worrying, longestFirst } from "@/lib/empty";
import { matches, saidNothing, type Lot } from "@/lib/match";
import type { Wanted } from "@/lib/wanted";
import { STAGES } from "@/lib/followups";
import type { Hours, Rules } from "@/lib/slots";
import { ZONE } from "@/lib/zone";
import ShowingsList, { type ShowingRow } from "@/components/ShowingsList";
import ShowingHours from "@/components/ShowingHours";
import ListingEditor, { type ListingDraft } from "@/components/ListingEditor";

export type Looking = {
  id: string;
  inquiredAt: string;
  source: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  conversationId: string | null;
  wanted: Wanted;
  /** The words each field was read out of. Empty for a field somebody typed
   *  themselves, which is how a correction stops looking like a guess. */
  read: Partial<Record<keyof Wanted, { from: string; at: number }>>;
  stage: string;
  stageAt: string;
  unitId: string | null;
  followups: { kind: string; dueAt: string; state: string; reason: string | null; channel: string | null }[];
};

/** What each planned follow-up is, said the way the office would say it. */
const FOLLOWUP: Record<string, string> = {
  invite_nudge_1: "Reminder to answer the questions",
  invite_nudge_2: "Last reminder to answer the questions",
  book_nudge_1: "Reminder to book a showing",
  book_nudge_2: "Last reminder to book",
  showing_day_before: "Day-before reminder",
  showing_soon: "Two-hours-before reminder",
  after_showing: "After-showing note with the application",
  still_looking: "\u201cDid you find a place?\u201d",
};

const at = (iso: string) => new Date(iso).toLocaleString("en-US", {
  timeZone: ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export type EmptyLot = Lot & {
  vacantSince: string | null;
  vacantSinceEstimated: boolean;
  blocker: string | null;
};

const OUTCOMES: { key: string; said: string }[] = [
  { key: "leased_with_us", said: "Took one of ours" },
  { key: "leased_elsewhere", said: "Rented somewhere else" },
  { key: "wrong_location", said: "Wrong area" },
  { key: "price_mismatch", said: "Price did not work" },
  { key: "did_not_qualify", said: "Did not qualify" },
  { key: "bought_home", said: "Bought a house" },
  { key: "relocated_away", said: "Moved away" },
  { key: "unknown", said: "Never found out" },
];

/** Permanent suppressions, said in the button rather than discovered after. */
const FOREVER = new Set(["bought_home", "relocated_away"]);

const DAY = 864e5;
const waiting = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / DAY));

function said(w: Wanted): { label: string; value: string; key: keyof Wanted }[] {
  const out: { label: string; value: string; key: keyof Wanted }[] = [];
  if (w.bedroomsMin !== undefined) out.push({ key: "bedroomsMin", label: "Beds", value: `${w.bedroomsMin}+` });
  if (w.priceCeiling !== undefined) out.push({ key: "priceCeiling", label: "Up to", value: money(w.priceCeiling * 100) });
  if (w.area) out.push({ key: "area", label: "Area", value: w.area });
  if (w.hasPets !== undefined) out.push({ key: "hasPets", label: "Pets", value: w.hasPets ? "Yes" : "No" });
  if (w.moveInFrom) out.push({ key: "moveInFrom", label: "From", value: w.moveInFrom });
  return out;
}

export default function LeasingBoard(
  { looking, lots, full, clock, canEdit, pipeline, showings, listings, unitFacts, hours, rules, feedUrl }:
  { looking: Looking[]; lots: EmptyLot[]; full: boolean; clock: boolean; canEdit: boolean;
    pipeline: boolean; showings: ShowingRow[]; listings: Record<string, ListingDraft>;
    unitFacts: Record<string, { bedrooms: string; bathrooms: string; rent: string; squareFeet: string }>;
    hours: Hours[]; rules: Rules; feedUrl: string },
) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Opening this screen sends whatever follow-ups have come due. The cron
  // fires once a day on this plan; the office looks far more often than
  // that. The server decides whether a run is needed, so asking is cheap.
  useEffect(() => {
    if (!pipeline) return;
    fetch("/api/followups/run", { method: "POST" })
      .then((r) => r.json()).then((r) => { if (r?.sent) router.refresh(); })
      .catch(() => {});
  }, [pipeline, router]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setProblem(null); setNote(null);
    const res = await fetch("/api/leasing", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    if (!res || !res.ok) { setProblem(out.error ?? "That didn't go through. Try again."); return; }
    setNote(done);
    start(() => router.refresh());
  };

  const counts = Object.fromEntries(STAGES.map((st) => [st.key, looking.filter((p) => p.stage === st.key).length]));
  const shown = stage ? looking.filter((p) => p.stage === stage) : looking;

  const call = async (body: Record<string, unknown>) => {
    setProblem(null);
    const res = await fetch("/api/leasing", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    // Nothing on screen changes until the server says it took it. Silence and
    // success look identical, and the one time they are not the same is the
    // time it matters.
    if (!res || !res.ok) { setProblem(out.error ?? "That didn't save. Try again."); return; }
    start(() => router.refresh());
  };

  const byLongest = longestFirst(lots, (l) =>
    spell(l.vacantSince, { estimated: l.vacantSinceEstimated }));
  const lost = lots.reduce((a, l) => a + (l.rent ?? 0), 0);

  return (
    <main className="wrap">
      <BackLink />
      <h1>Looking for a home</h1>

      <p className="leadsay">
        {looking.length
          ? `${looking.length} ${looking.length === 1 ? "person" : "people"} looking`
          : "Nobody on file yet"}
        {" · "}
        {lots.length} {lots.length === 1 ? "lot" : "lots"} empty
        {lost ? ` · ${money(lost * 100)}/mo not coming in` : ""}
      </p>

      {problem ? <p className="leadbad">{problem}</p> : null}
      {note ? <p className="leadgood">{note}</p> : null}

      {!pipeline ? (
        <p className="leadnone">
          Run migration 051 and this screen also tracks each person from enquiry to
          showing, sends the prescreening questions and reminders, books showings, and
          lists homes on Zillow.
        </p>
      ) : (
        <div className="funnel" role="tablist" aria-label="Where they have got to">
          <button role="tab" aria-selected={!stage} className={`funstage${!stage ? " on" : ""}`}
                  onClick={() => setStage(null)}>
            <b>{looking.length}</b><span>Everyone</span>
          </button>
          {STAGES.map((st) => (
            <button key={st.key} role="tab" aria-selected={stage === st.key}
                    className={`funstage${stage === st.key ? " on" : ""}${counts[st.key] ? "" : " none"}`}
                    onClick={() => setStage(stage === st.key ? null : st.key)}>
              <b>{counts[st.key]}</b><span>{st.said}</span>
            </button>
          ))}
        </div>
      )}

      {!looking.length ? (
        /* Empty because nothing has arrived since this started recording, not
           because the screen is broken -- and the difference is worth saying,
           since every enquiry before today went into a thread and nowhere
           else. */
        <p className="leadnone">
          Every enquiry from now on lands here — a text to the shared line, the
          prequalification form, or a website form. The ones from before today
          were only ever written into their own conversation, so they are not
          here. {!full ? "Run migration 037 as well: without it this screen "
                      + "cannot keep what it read a preference out of." : ""}
        </p>
      ) : null}

      <ul className="leadlist">
        {shown.map((p) => {
          const fits = saidNothing(p.wanted) ? [] : matches(lots, p.wanted);
          const days = waiting(p.inquiredAt);
          return (
            <li key={p.id} className="lead">
              <div className="leadhead">
                <span className="leadwho">{p.name ?? p.phone ?? "No name"}</span>
                {p.phone ? <a className="leadtel" href={`tel:${p.phone}`}>{p.phone}</a>
                  : /@convo\.zillow\.com$/i.test(p.email ?? "")
                    ? <span className="leadnonum">Zillow lead — no number yet</span>
                    : p.email ? <span className="leadnonum">{p.email}</span> : null}
                {p.conversationId
                  ? <Link className="mini" href={`/c/${p.conversationId}`}>The conversation</Link>
                  : null}
                <span className="leadwait">
                  {days === 0 ? "Asked today" : `Asked ${days} day${days === 1 ? "" : "s"} ago`}
                  {p.source ? ` · ${p.source}` : ""}
                </span>
              </div>

              {pipeline ? (
                <div className="leadpipe">
                  <span className={`stagepill st-${p.stage}`}>
                    {STAGES.find((st) => st.key === p.stage)?.said ?? p.stage}
                  </span>
                  {(() => {
                    const next = p.followups.find((f) => f.state === "scheduled" || f.state === "handed");
                    const last = [...p.followups].reverse().find((f) => f.state === "sent");
                    return (
                      <span className="leadnext">
                        {next ? `Next: ${FOLLOWUP[next.kind] ?? next.kind}, ${at(next.dueAt)}` : "Nothing planned"}
                        {last ? ` · Last sent: ${FOLLOWUP[last.kind] ?? last.kind} by ${last.channel}` : ""}
                      </span>
                    );
                  })()}
                  {canEdit ? (
                    <span className="leadacts">
                      {p.stage === "new" ? (
                        <button className="leadout" disabled={busy}
                                onClick={() => act({ id: p.id, action: "invite" }, "Prescreening questions sent.")}>
                          Send the questions
                        </button>
                      ) : null}
                      {p.stage === "review" ? (
                        <button className="leadout" disabled={busy}
                                onClick={() => {
                                  const reason = window.prompt("Why are they OK to book? (kept on the record)");
                                  if (reason !== null) act({ id: p.id, action: "approve", reason }, "Booking link sent.");
                                }}>
                          Let them book
                        </button>
                      ) : null}
                      {p.stage === "booked" || p.stage === "shown" ? (
                        <button className="leadout" disabled={busy}
                                onClick={() => act({ id: p.id, action: "applied" }, "Marked as applied.")}>
                          They applied
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  {p.followups.some((f) => f.state === "failed") ? (
                    <span className="leadbut">
                      A follow-up could not go: {p.followups.find((f) => f.state === "failed")?.reason}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <dl className="leadsaid">
                {said(p.wanted).length ? said(p.wanted).map((s) => (
                  <div key={s.key} className="leadbit">
                    <dt>{s.label}</dt>
                    <dd>
                      {s.value}
                      {/* Where it came from, when it came from a guess. A
                          guess that says what it read is corrected in one
                          press; a silent one is never corrected at all. */}
                      {p.read[s.key]
                        ? <span className="leadfrom">read from “{p.read[s.key]!.from}”</span>
                        : null}
                    </dd>
                  </div>
                )) : (
                  <p className="leadquiet">
                    They have not said what they are after yet. Every lot fits
                    until they do.
                  </p>
                )}
              </dl>

              {fits.length ? (
                <div className="leadfits">
                  <h3>{fits.length} {fits.length === 1 ? "lot" : "lots"} to ring them about</h3>
                  <ul>
                    {fits.slice(0, 6).map((f) => (
                      <li key={f.lot.id} className={f.against.length ? "leadnear" : ""}>
                        <span className="leadlot">{f.lot.property} {f.lot.label}</span>
                        <span className="leadspec">
                          {[f.lot.bedrooms ? `${f.lot.bedrooms} bed` : null,
                            f.lot.rent ? `${money(f.lot.rent * 100)}/mo` : null]
                            .filter(Boolean).join(" · ") || "nothing recorded"}
                        </span>
                        {f.against.length
                          ? <span className="leadbut">{f.against.join(" · ")}</span>
                          : <span className="leadyes">fits what they asked for</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : saidNothing(p.wanted) ? null : (
                <p className="leadquiet">Nothing empty fits what they asked for.</p>
              )}

              {canEdit && (
                <div className="leadclose">
                  {open === p.id ? (
                    <>
                      <span className="leadask">How did it end?</span>
                      {/* Not `.mini`. Eight look-alike buttons 26px tall, two
                          of which stop us ever contacting somebody again, is a
                          row where the wrong one gets pressed -- which the
                          picture harness said in pixels before anybody had to
                          find out from a customer. They are a decision, so
                          they are sized like one, and the two permanent ones
                          do not look like the other six.

                          Not `.danger` either: that is the filled destructive
                          button, red ground and white text, and overriding
                          only its colour has already given red on red once. */}
                      {OUTCOMES.map((o) => (
                        <button key={o.key} disabled={busy}
                                className={`leadout${FOREVER.has(o.key) ? " forever" : ""}`}
                                onClick={() => call({ id: p.id, outcome: o.key })}>
                          {o.said}{FOREVER.has(o.key) ? " — never contact again" : ""}
                        </button>
                      ))}
                      <button className="leadout" onClick={() => setOpen(null)}>Not now</button>
                    </>
                  ) : (
                    <button className="mini" onClick={() => setOpen(p.id)}>Close this out</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pipeline ? (
        <>
          <h2>Showings</h2>
          <ShowingsList rows={showings} canEdit={canEdit} />
          {canEdit ? (
            <p className="leadquiet">
              <button className="mini" onClick={() => setShowHours(!showHours)}>
                {showHours ? "Hide showing hours" : "When we show homes"}
              </button>
            </p>
          ) : null}
          {showHours ? <ShowingHours hours={hours} rules={rules} /> : null}
        </>
      ) : null}

      <h2>Empty, longest first</h2>
      {pipeline ? (
        <p className="leadquiet zillowfeed">
          Homes you list go into the feed Zillow reads at {feedUrl}. Zillow has to approve
          that address once before anything appears there; after that it picks up changes
          on its own, usually within a day.
        </p>
      ) : null}
      {!clock ? (
        <p className="leadnone">
          Run migration 037 and this says how long each one has been empty and
          what is stopping it. Until then it is a list in no particular order.
        </p>
      ) : null}
      <ul className="leadempty">
        {byLongest.map((l) => {
          const s = spell(l.vacantSince, { estimated: l.vacantSinceEstimated });
          return (
            <li key={l.id}>
              <span className="leadlot">{l.property} {l.label}</span>
              <span className="leadspec">
                {[l.bedrooms ? `${l.bedrooms} bed` : null,
                  l.rent ? `${money(l.rent * 100)}/mo` : null]
                  .filter(Boolean).join(" · ") || "nothing recorded"}
              </span>
              <span className={worrying(s) ? "leadslow" : "leadsince"}>
                {howLong(s) ?? (clock ? "Nobody has been counting" : "—")}
              </span>
              {l.blocker
                ? <span className="leadblock">{l.blocker}</span>
                : <span className="leadnoblock">Nothing said about what is stopping it</span>}
              {pipeline && canEdit ? (
                <span className="leadlist-z">
                  {listings[l.id]?.onZillow ? <span className="leadyes">In the Zillow feed</span> : null}
                  <button className="leadout" onClick={() => setEditing(editing === l.id ? null : l.id)}>
                    {listings[l.id]?.onZillow ? "Edit listing" : "List on Zillow"}
                  </button>
                </span>
              ) : null}
              {editing === l.id && listings[l.id] ? (
                <ListingEditor unitId={l.id} title={`${l.property} ${l.label}`}
                               draft={listings[l.id]} facts={unitFacts[l.id]}
                               onClose={() => setEditing(null)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
