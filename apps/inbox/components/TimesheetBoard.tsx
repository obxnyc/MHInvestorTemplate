"use client";

import { useCallback, useEffect, useState } from "react";

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
  } | null>(null);
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

  if (!data) return <main className="wrap"><p className="tsloading">Loading&hellip;</p></main>;

  const out = data.people.filter((p) => p.onTheClock);

  return (
    <main className="wrap">
      <h1>Timesheets</h1>

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
            <button className="tslink" onClick={() => setShowing(shift(data.week, -7))}>
              &larr; Earlier
            </button>
            <button className="tslink" onClick={() => setShowing(shift(data.week, 7))}>
              Later &rarr;
            </button>
          </span>
        </div>

        {data.people.length ? (
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
        ) : (
          /* Nobody on the crew yet is not the same as nobody having worked,
             and the screen should say which it is. */
          <p className="tsnote">
            No field staff on file yet. Add somebody as Crew on the people
            screen and their hours appear here.
          </p>
        )}
      </section>
    </main>
  );
}
