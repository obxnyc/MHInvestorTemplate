"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import { money } from "@/lib/prices";
import { spell, howLong, worrying, longestFirst } from "@/lib/empty";
import { matches, saidNothing, type Lot } from "@/lib/match";
import type { Wanted } from "@/lib/wanted";
import { STAGES, STAGE_INFO, stageLabel, waiting as howWaiting, chaseOrder,
         type Stage } from "@/lib/stage";

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
  /** Where we got to with them. NULL is not 'new': it means this one was
   *  taken before the board kept track and nobody has said. */
  stage: Stage | null;
  /** When the stage last moved, which is what the waiting is measured from.
   *  Not `inquiredAt` -- a lead that moved this morning is not waiting. */
  stageAt: string | null;
  /** What we would not record off this enquiry, and why. Shown where the
   *  empty box is, because the blank is what invites somebody to fill it in
   *  with the occupant count sitting in the thread above it. */
  declined: { field: string; because: string }[];
};

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
  { looking, lots, full, clock, tracks, canEdit }:
  { looking: Looking[]; lots: EmptyLot[]; full: boolean; clock: boolean;
    tracks: boolean; canEdit: boolean },
) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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

      {/* Without 049 there is no stage column, so the board cannot say where
          anybody got to. It says THAT, rather than drawing every lead with no
          stage and reading as a pipeline where nothing has ever moved. */}
      {looking.length && !tracks ? (
        <p className="leadnone">
          This board cannot yet say where each person got to. Run migration
          049 and it will track them from “not answered” through to approved.
        </p>
      ) : null}

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

      {/* The ones somebody has to do something about first, then the ones
          nobody has said anything about, then by how long they have sat.
          NOT by date received: a lead from this morning that nobody has
          answered outranks one from last week waiting on a signature. */}
      <ul className="leadlist">
        {(tracks ? chaseOrder(looking, new Date()) : looking).map((p) => {
          const fits = saidNothing(p.wanted) ? [] : matches(lots, p.wanted);
          const days = waiting(p.inquiredAt);
          return (
            <li key={p.id} className="lead">
              <div className="leadhead">
                <span className="leadwho">{p.name ?? p.phone ?? "No name"}</span>
                {p.phone ? <a className="leadtel" href={`tel:${p.phone}`}>{p.phone}</a> : null}
                {p.conversationId
                  ? <Link className="mini" href={`/c/${p.conversationId}`}>The conversation</Link>
                  : null}
                <span className="leadwait">
                  {days === 0 ? "Asked today" : `Asked ${days} day${days === 1 ? "" : "s"} ago`}
                  {p.source ? ` · ${p.source}` : ""}
                </span>
              </div>

              {tracks ? (() => {
                const w = howWaiting(p, new Date());
                return (
                  <div className={`leadstage${w.late ? " late" : ""}`}>
                    <span className="leadstagenow">{stageLabel(p.stage)}</span>
                    {/* Three answers and not two. Late, fine, or nobody has
                        said -- and the third is not reported as either of the
                        others, because "not answered yet" is a claim about
                        work somebody may have done. */}
                    <span className="leadstagesay">
                      {w.late ? w.why
                        : "unknown" in w ? w.why
                        : p.stage
                          ? `${STAGE_INFO[p.stage].next}${
                              w.days === 0 ? "" : ` (${w.days} day${w.days === 1 ? "" : "s"})`}`
                          : ""}
                    </span>
                    {canEdit ? (
                      <label className="leadstageset">
                        <select
                          aria-label="Where this one got to"
                          value={p.stage ?? ""}
                          disabled={busy}
                          onChange={(e) => call({ id: p.id, stage: e.target.value })}
                        >
                          {/* Only present when nothing has been recorded, and
                              it cannot be chosen: "nobody has said" is a
                              state to leave, not one to put a lead into. */}
                          {p.stage ? null : <option value="" disabled>Nobody has said</option>}
                          {STAGES.map((st) => (
                            <option key={st} value={st}>{STAGE_INFO[st].label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                );
              })() : null}

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

              {/* WHY A BOX IS EMPTY, where the empty box is.
                  A Zillow enquiry carries the occupant count and the income
                  in the message body, so both are on screen in the thread. An
                  empty Beds box beside "Number of Occupants 5" is what
                  invites somebody to type 5 into it -- and that puts a
                  familial-status fact in a column this business matches on.
                  Saying we do not record it is the whole point of saying
                  anything. */}
              {p.declined.length ? (
                <ul className="leadwont">
                  {p.declined.map((d, i) => (
                    <li key={`${d.field}-${i}`}>{d.because}</li>
                  ))}
                </ul>
              ) : null}

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

      <h2>Empty, longest first</h2>
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
            </li>
          );
        })}
      </ul>
    </main>
  );
}
