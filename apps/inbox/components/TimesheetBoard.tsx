"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

// MapLibre touches `window` on import, so it loads in the browser only.
const CrewMap = dynamic(() => import("./CrewMap"), { ssr: false });

/**
 * The office's side of the clock.
 *
 * Everybody's week, and the corrections waiting to be agreed. The crew screen
 * can ask for one; without this the asking goes nowhere, which looks exactly
 * like it worked.
 *
 * Nothing here moves until the server says it took it, and a decline has to
 * carry a reason -- a correction turned down with no word on it is the thing
 * somebody rings the office about.
 */

type Day = { day: string; hours: number; running: number; signedOff: boolean };
type Week = { start: string; days: Day[]; hours: number; running: number;
              breakMinutes: number; toSign: number };
type Person = { id: string; name: string; onTheClock: boolean; week: Week };
type Ask = {
  id: string; name: string; kind: string; reason: string;
  asked_start: string | null; asked_end: string | null;
  asked_break_minutes: number | null; created_at: string;
};

type Live = {
  shiftId: string; staffId: string; name: string; startedAt: string;
  site: { id: string; name: string } | null;
  at: { lat: number; lng: number; accuracy: number | null } | null;
  from: "ping" | "clock-in" | null; seenAt: string | null;
  fence: string | null; metres: number | null;
  abandoned: boolean; quietMinutes: number | null;
};
type SiteHours = { id: string | null; name: string; hours: number; people: number };
type SiteRow = { id: string; name: string; lat: number | null; lng: number | null };

const FENCE_SAID: Record<string, string> = {
  inside: "on site", outside: "off site", unsure: "can't tell if on site",
};
const ago = (mins: number | null) => mins === null ? ""
  : mins < 2 ? "just now" : mins < 90 ? `${mins} min ago`
  : mins < 48 * 60 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;

const KIND_SAID: Record<string, string> = {
  missed_clock_in: "Started before clocking in",
  missed_clock_out: "Finished before clocking out",
  never_clocked_in: "Never clocked in",
  missed_break: "Break not recorded",
  wrong_times: "Both times wrong",
  other: "Something else",
};

const hhmm = (h: number) => {
  const whole = Math.floor(h);
  return `${whole}:${String(Math.round((h - whole) * 60)).padStart(2, "0")}`;
};
const shortDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString([], { weekday: "narrow" });
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
  : "—";
const weekLabel = (start: string) =>
  new Date(`${start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "long" });

const shift = (start: string, days: number) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function TimesheetBoard() {
  const [data, setData] = useState<{
    week: string; people: Person[]; asks: Ask[]; migrationMissing: boolean;
    live: Live[]; bySite: SiteHours[]; sites: { total: number; pinned: number };
    sitesList: SiteRow[]; liveError: string | null;
  } | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async (which?: string) => {
    const off = new Date().getTimezoneOffset();
    const url = `/api/timesheets?offset=${off}${which ? `&week=${which}` : ""}`;
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) { setProblem("Could not load the timesheets."); return; }
    setData(await res.json().catch(() => null));
  }, []);

  useEffect(() => { void load(showing ?? undefined); }, [load, showing]);
  // The live list goes stale while the screen sits open on somebody's desk.
  useEffect(() => {
    const id = setInterval(() => { void load(showing ?? undefined); }, 120_000);
    return () => clearInterval(id);
  }, [load, showing]);

  const pinSites = async () => {
    setPinning("Finding the addresses…");
    let total = 0;
    const missed: string[] = [];
    // The function stops before Vercel's sixty seconds and says `more`; keep
    // asking until it does not.
    for (let round = 0; round < 10; round++) {
      const res = await fetch("/api/clock/pins", { method: "POST" }).catch(() => null);
      const text = await res?.text().catch(() => "") ?? "";
      let out: { pinned?: number; missed?: string[]; more?: boolean; error?: string } = {};
      try { out = JSON.parse(text); } catch { /* a cut-off reply is not JSON */ }
      if (!res?.ok) {
        setPinning(out.error ?? `Stopped after ${total}: the server did not finish (${res?.status ?? "no answer"}).`);
        return;
      }
      total += out.pinned ?? 0;
      missed.push(...(out.missed ?? []));
      setPinning(`${total} pinned so far…`);
      if (!out.more) break;
    }
    setPinning(`${total} job site${total === 1 ? "" : "s"} pinned from their address.`
      + (missed.length ? ` No match for ${missed.length}: ${missed.slice(0, 8).join(", ")}`
        + `${missed.length > 8 ? "…" : ""} — set those on the property's own page.` : ""));
    await load(showing ?? undefined);
  };

  const decide = async (id: string, decision: "approve" | "decline", why?: string) => {
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/timesheets", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision, note: why }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    // Nothing on screen changes until the server says it took it.
    if (!res || !res.ok) { setProblem(out.error ?? "That did not go through."); return; }
    setDeclining(null);
    setNote("");
    await load(showing ?? undefined);
  };

  if (!data) return <main className="wrap crewwrap"><p className="tsloading">Loading&hellip;</p></main>;

  const out = data.people.filter((p) => p.onTheClock);

  return (
    <main className="wrap crewwrap">
      <div className="tshead">
        <h1>Timesheets</h1>
        <span className="tsrow">
          <a className="tslink" href="/pay">Friday pay</a>
          <a className="tslink" href="/crew">Crews &amp; texts</a>
        </span>
      </div>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}

      <p className="leadsay">
        {out.length
          ? `${out.length} on the clock right now`
          : "Nobody is on the clock"}
        {data.asks.length ? ` · ${data.asks.length} correction${
          data.asks.length === 1 ? "" : "s"} to review` : ""}
      </p>

      {data.migrationMissing ? (
        <p className="leadnone">
          Run migration 039 and corrections requested by the crew appear here.
        </p>
      ) : null}

      {/* ---------------------------------------------------------- crew now */}
      <section className="tscard">
        <div className="tscardhead"><h2>On the Clock Now</h2></div>
        {data.liveError ? (
          <p className="tsalert" role="alert">
            Could not read who is on the clock: {data.liveError}
          </p>
        ) : data.live.length ? (
          <>
            <CrewMap
              dots={data.live.filter((l) => l.at).map((l) => ({
                id: l.shiftId, name: l.name, lat: l.at!.lat, lng: l.at!.lng,
                fresh: l.from === "ping" && (l.quietMinutes ?? 99) <= 6,
                abandoned: l.abandoned,
              }))}
              sites={data.sitesList.filter((s) => s.lat !== null && s.lng !== null)
                .map((s) => ({ id: s.id, name: s.name, lat: s.lat!, lng: s.lng! }))}
            />
            <ul className="tsruns">
              {data.live.map((l) => (
                <li key={l.shiftId}>
                  <span className="tsspan">{l.name}</span>
                  {l.abandoned
                    ? <span className="tsbadge asked">Never clocked out</span>
                    : <span className="tsbadge onclock">since {when(l.startedAt)}</span>}
                  <span className="tsplace">
                    {l.site?.name ?? "Site not set"}
                    {l.fence ? ` · ${FENCE_SAID[l.fence] ?? l.fence}` : ""}
                    {l.from === "ping" ? ` · seen ${ago(l.quietMinutes)}`
                      : l.from === "clock-in" ? ` · position from clock-in, ${ago(l.quietMinutes)}`
                      : " · phone gave no position"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tsnote">
              The phone sends its position every two minutes while the clock
              screen is open. With the phone locked or the app closed it cannot,
              so a dot that has gone quiet is the last place it was seen.
            </p>
          </>
        ) : <p className="tsnote">Nobody is on the clock right now.</p>}
      </section>

      {data.sites.pinned < data.sites.total ? (
        <section className="tscard">
          <div className="tscardhead"><h2>Job Site Pins</h2></div>
          <p className="tsnote">
            {data.sites.pinned} of {data.sites.total} job sites have a pin on the map.
            The phone can only tell somebody is on site where there is one; everywhere
            else a clock-in reads &ldquo;can&rsquo;t tell&rdquo;.
          </p>
          <button className="tsminor" disabled={!!pinning && !/pinned from|Stopped|No match/.test(pinning)}
                  onClick={pinSites}>
            Pin job sites from their addresses
          </button>
          {pinning ? <p className="tsnote" role="status">{pinning}</p> : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------ corrections */}
      {data.asks.length ? (
        <section className="tscard">
          <div className="tscardhead"><h2>Corrections to Review</h2></div>
          <ul className="tsasks">
            {data.asks.map((a) => (
              <li key={a.id} className="tsask">
                <span className="tsasksaid">{a.name}</span>
                <span className="tsbadge asked">{KIND_SAID[a.kind] ?? a.kind}</span>
                <span className="tsaskwhy">{a.reason}</span>
                <span className="tsaskwhat">
                  {a.asked_start || a.asked_end
                    ? `Asking for ${when(a.asked_start)} – ${when(a.asked_end)}`
                    : a.asked_break_minutes
                    ? `Asking for a ${a.asked_break_minutes} minute break`
                    : "No change to the hours"}
                </span>
                {declining === a.id ? (
                  <div className="tsform">
                    <div className="tsfield">
                      <label htmlFor={`n${a.id}`}>Why are you declining it?</label>
                      <textarea id={`n${a.id}`} rows={2} value={note}
                                onChange={(e) => setNote(e.target.value)} />
                    </div>
                    <div className="tsrow">
                      <button className="tsact stop" disabled={busy || note.trim().length < 3}
                              onClick={() => decide(a.id, "decline", note)}>
                        Decline
                      </button>
                      <button className="tsminor" onClick={() => setDeclining(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tsrow">
                    <button className="tsact go" disabled={busy}
                            onClick={() => decide(a.id, "approve")}>Approve</button>
                    <button className="tsminor" disabled={busy}
                            onClick={() => { setDeclining(a.id); setNote(""); }}>
                      Decline
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------ week */}
      <section className="tscard">
        <div className="tscardhead">
          <h2>Week of {weekLabel(data.week)}</h2>
          <span className="tsrow">
            <a className="tslink"
               href={`/api/timesheets/export?week=${data.week}&offset=${new Date().getTimezoneOffset()}`}>
              Download spreadsheet
            </a>
            <button className="tslink" onClick={() => setShowing(shift(data.week, -7))}>
              &larr; Earlier
            </button>
            <button className="tslink" onClick={() => setShowing(shift(data.week, 7))}>
              Later &rarr;
            </button>
          </span>
        </div>

        {data.people.length ? (
          <div className="tsscroll">
          <table className="tsweek">
            <thead>
              <tr>
                <th scope="col">Who</th>
                {data.people[0].week.days.map((d) => (
                  <th key={d.day} scope="col" className="tsnum">{shortDay(d.day)}</th>
                ))}
                <th scope="col" className="tsnum">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    {p.name}
                    {p.onTheClock ? <span className="tsbadge onclock">On</span> : null}
                  </th>
                  {p.week.days.map((d) => (
                    <td key={d.day} className={`tsnum ${d.hours || d.running ? "" : "tsoff"}`}>
                      {d.hours || d.running ? hhmm(d.hours + d.running) : "—"}
                    </td>
                  ))}
                  <td className="tsnum">{hhmm(p.week.hours + p.week.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          /* Nobody on the crew yet is not the same as nobody having worked,
             and the screen should say which it is. */
          <p className="tsnote">
            No field staff on file yet. Add somebody as Crew on the people
            screen and their hours appear here.
          </p>
        )}
      </section>

      {/* ----------------------------------------------------------- by site */}
      {data.bySite.length ? (
        <section className="tscard">
          <div className="tscardhead"><h2>Hours by Job Site</h2></div>
          <table className="tsweek">
            <thead>
              <tr><th scope="col">Site</th><th scope="col" className="tsnum">People</th>
                  <th scope="col" className="tsnum">Hours</th></tr>
            </thead>
            <tbody>
              {data.bySite.map((s) => (
                <tr key={s.id ?? "none"} className={s.id ? "" : "tsoff"}>
                  <th scope="row">{s.name}</th>
                  <td className="tsnum">{s.people}</td>
                  <td className="tsnum">{hhmm(s.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tsnote">Finished shifts only. A shift still running counts once it ends.</p>
        </section>
      ) : null}
    </main>
  );
}
