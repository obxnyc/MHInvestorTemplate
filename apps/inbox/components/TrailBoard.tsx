"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { TrailPoint, TrailStop, TrailSite } from "./TrailMap";

// MapLibre touches `window` on import, so it loads in the browser only.
const TrailMap = dynamic(() => import("./TrailMap"), { ssr: false });

/**
 * Where somebody went on a day. Pick the person and the day; the map draws
 * the route with arrows, and the list underneath says the same thing in
 * words -- clock-in, every stop with how long and whether it was a job, and
 * clock-out -- because a map is for seeing the shape of a day and a list is
 * for reading off "10:05 to 10:30, not a job site".
 */

type Shift = { id: string; startedAt: string; endedAt: string | null; site: string | null;
               offSite: boolean; metres: number | null; noFix: boolean; autoOut: boolean };
type Data = {
  people: { id: string; name: string }[];
  day?: string; shifts?: Shift[];
  points?: TrailPoint[]; stops?: TrailStop[]; sites?: TrailSite[]; metres?: number;
  jobs?: TrailSite[];
  error?: string;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d);
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const miles = (m: number) => `${(m / 1609.344).toFixed(1)} mi`;

export default function TrailBoard() {
  const [staff, setStaff] = useState("");
  const [day, setDay] = useState(ymd(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Opened from a name on the timesheets: ?staff=<id>&day=<yyyy-mm-dd>.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("staff")) setStaff(q.get("staff")!);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("day") ?? "")) setDay(q.get("day")!);
  }, []);

  const load = useCallback(async () => {
    setProblem(null);
    const off = new Date().getTimezoneOffset();
    const res = await fetch(`/api/trail?offset=${off}&staff=${encodeURIComponent(staff)}&day=${day}`)
      .catch(() => null);
    const text = await res?.text().catch(() => "") ?? "";
    let out: Data | null = null;
    try { out = JSON.parse(text); } catch { /* not JSON */ }
    if (!res?.ok || !out) { setProblem(out?.error ?? "Could not load the trail."); if (out) setData(out); return; }
    setData(out);
    if (!staff && out.people.length === 1) setStaff(out.people[0].id);
  }, [staff, day]);
  useEffect(() => { void load(); }, [load]);

  const today = ymd(new Date());
  const pts = data?.points ?? [];
  const pings = pts.filter((p) => p.kind === "ping").length;

  // The day in order: clock-ins, stops and clock-outs, one list.
  const events = [
    ...(data?.shifts ?? []).flatMap((s) => [
      { at: s.startedAt, kind: "in" as const, s },
      ...(s.endedAt ? [{ at: s.endedAt, kind: "out" as const, s }] : []),
    ]),
    ...(data?.stops ?? []).map((st) => ({ at: st.from, kind: "stop" as const, st })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <main className="wrap crewwrap">
      <div className="tshead">
        <h1>Where They Went</h1>
        <span className="tsrow"><a className="tslink" href="/timesheets">Timesheets</a></span>
      </div>

      <section className="tscard">
        <div className="crewgrid">
          <div className="tsfield">
            <label htmlFor="who">Who</label>
            <select id="who" value={staff} onChange={(e) => setStaff(e.target.value)}>
              <option value="">Pick someone</option>
              {(data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="tsfield">
            <label htmlFor="day">Day</label>
            <input id="day" type="date" value={day} max={today}
                   onChange={(e) => e.target.value && setDay(e.target.value)} />
          </div>
        </div>
        <div className="tsrow">
          <button className="tslink" onClick={() => setDay(addDays(day, -1))}>&larr; Day before</button>
          <button className="tslink" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>
            Day after &rarr;
          </button>
        </div>
      </section>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}

      {staff && data?.shifts ? (
        <section className="tscard">
          <div className="tscardhead">
            <h2>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2>
            {data.metres ? <span className="tsnum">{miles(data.metres)} travelled</span> : null}
          </div>
          {data.shifts.length ? (
            <>
              <TrailMap points={pts} stops={data.stops ?? []} sites={data.sites ?? []}
                        jobs={data.jobs ?? []}
                        live={day === today && data.shifts.some((s) => !s.endedAt)} />
              {pts.length ? (
                <p className="tsnote">
                  {pts.length} positions, each with its time. Arrows show the way they went;
                  amber circles are places they stayed 8 minutes or more. Zoom in to see
                  every time.
                </p>
              ) : (
                <p className="tsnudge loud">
                  The phone sent no position at all this day, so the map shows the job they
                  chose{data.jobs?.length ? "" : " (it has no map pin)"} — not where they were.
                </p>
              )}
              {pts.length && !pings ? (
                <p className="tsnote">
                  Only clock-in and clock-out positions: in between, the phone sends its
                  position only while the clock screen is open. The installed app sends it
                  every two minutes all day.
                </p>
              ) : null}
              <ul className="tsruns">
                {events.map((e, i) => (
                  <li key={i}>
                    <span className="tsspan">{time(e.at)}</span>
                    {e.kind === "stop" ? (
                      <span className="tsplace">
                        Stopped {e.st.minutes} min, until {time(e.st.to)} —{" "}
                        {e.st.site ? e.st.site.name : "not a job site"}
                      </span>
                    ) : e.kind === "in" ? (
                      <span className="tsplace">
                        Clocked in at {e.s.site ?? "no job chosen"}
                        {e.s.noFix ? " — no location" : e.s.offSite
                          ? ` — off site${e.s.metres !== null ? `, ${miles(e.s.metres)} away` : ""}` : ""}
                      </span>
                    ) : (
                      <span className="tsplace">
                        {e.s.autoOut ? "Clocked out by the clock (forgot)" : "Clocked out"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="tsnote">No time on the clock that day.</p>}
        </section>
      ) : null}
    </main>
  );
}
