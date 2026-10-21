"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The crew timesheet.
 *
 * A phone, in a work glove, in a yard. The first version was one dark square
 * floating in white space with the words wrapped across two lines, which read
 * as a prototype -- so the layout here is panels with headings and a
 * full-width action, and the wording is the wording a timesheet uses:
 * Clock In, Begin Break, Submit for Approval, Request an Adjustment.
 *
 * Three rules underneath it, and none is cosmetic.
 *
 * NOTHING CHANGES ON SCREEN UNTIL THE SERVER SAYS IT TOOK IT. This is a pay
 * record. "I pressed it" against "we have no row" is an argument nobody can
 * win, so a press that failed must not look like a press that worked.
 *
 * THE POSITION IS ASKED FOR, AND NEVER WAITED ON FOREVER. A phone in a metal
 * building takes thirty seconds or never answers. Clocking in goes through
 * without one, recorded as having no position, because a man standing there
 * unable to start work is a worse outcome than a row with a blank in it.
 *
 * AND A REQUEST IS NOT A CHANGE. Asking for an adjustment writes a question,
 * never an hour. The hours stay as the clock recorded them until the office
 * agrees, and the screen says which state a request is in.
 */

type Nudge = { key: string; says: string; urgent?: boolean };
type Shift = {
  id: string; startedAt: string; endedAt: string | null;
  propertyId: string | null; signedOffAt?: string | null;
};
type Day = {
  day: string; hours: number; running: number; breakMinutes: number;
  shifts: Shift[]; signedOff: boolean;
};
type Week = {
  start: string; days: Day[]; hours: number; running: number;
  breakMinutes: number; toSign: number;
};
type Ask = {
  id: string; shift_id: string | null; kind: string; reason: string;
  state: "asked" | "approved" | "declined"; created_at: string;
};
type State = {
  worked: { hours: number; running: number; breakMinutes: number;
            onTheClock: boolean; abandoned: Shift[] };
  onBreak: boolean;
  openShiftId: string | null;
  nudges: Nudge[];
  places: { id: string; name: string }[];
  shifts: Shift[];
  week: Week;
  lastWeek: Week;
  asks: Ask[];
};

/** How long to wait for a position before going without one. */
const FIX_MS = 6_000;
/** How often to send one while on the clock. Generous on purpose: a ping a
 *  minute is a battery complaint and a tracking device, and neither is what
 *  was asked for. */
const PING_MS = 10 * 60_000;

const KINDS: { key: string; said: string; needs: "times" | "break" | "none" }[] = [
  { key: "missed_clock_in", said: "I started before I clocked in", needs: "times" },
  { key: "missed_clock_out", said: "I finished before I clocked out", needs: "times" },
  { key: "never_clocked_in", said: "I never clocked in that day", needs: "times" },
  { key: "missed_break", said: "I took a break and did not record it", needs: "break" },
  { key: "other", said: "Something else", needs: "none" },
];

function position(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: GeolocationPosition | null) => {
      if (!done) { done = true; resolve(p); }
    };
    // Belt as well as braces: the browser's own timeout is not always
    // honoured when permission has never been answered, and a promise that
    // never settles is a button that never does anything.
    const t = setTimeout(() => finish(null), FIX_MS);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); finish(p); },
      () => { clearTimeout(t); finish(null); },
      { enableHighAccuracy: true, timeout: FIX_MS, maximumAge: 30_000 },
    );
  });
}

const fixOf = (p: GeolocationPosition | null) => p ? {
  lat: p.coords.latitude, lng: p.coords.longitude,
  // Not `?? 0`. A device that did not say how sure it is has not said it is
  // certain, and the fence reader has to be able to tell those apart.
  accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
} : null;

const hhmm = (h: number) => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}:${String(mins).padStart(2, "0")}`;
};
const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayName = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const longDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

export default function ClockScreen({ name }: { name: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [showLast, setShowLast] = useState(false);
  const [asking, setAsking] = useState(false);
  const on = state?.worked.onTheClock ?? false;
  const onRef = useRef(on);
  onRef.current = on;

  // The handset's own offset. The person reading this is the person whose
  // Tuesday it is; a server in UTC files Monday evening under Tuesday.
  const offset = useRef(0);
  useEffect(() => { offset.current = new Date().getTimezoneOffset(); }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clock?offset=${new Date().getTimezoneOffset()}`)
      .catch(() => null);
    if (!res?.ok) return;
    setState(await res.json().catch(() => null));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    const wantsFix = action === "in" || action === "out";
    setFinding(wantsFix);

    const fix = wantsFix ? fixOf(await position()) : null;

    const res = await fetch("/api/clock", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, fix, offset: offset.current, ...extra }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};

    setBusy(false);
    setFinding(false);
    // Nothing on screen moves until the server says it took it. This is a pay
    // record: a press that failed must not look like a press that worked.
    if (!res || !res.ok) {
      setProblem(out.error ?? "That did not go through. Please try again.");
      return false;
    }
    setState(out as State);
    return true;
  };

  // The trail belongs to the shift. It starts when the shift does and stops
  // when it does, and the panel below says which it is doing.
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const send = async () => {
      const p = fixOf(await position());
      if (!alive || !p) return;
      await fetch("/api/clock/ping", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      }).catch(() => null);
    };
    void send();
    const id = setInterval(() => { if (onRef.current) void send(); }, PING_MS);

    // A phone in a pocket with the screen off is not sending anything: every
    // browser throttles a background tab's timers and most suspend them
    // outright, and iOS suspends almost at once. So the trail has gaps, and
    // the sentence above says so rather than claiming a coverage this cannot
    // have -- a tracking promise that quietly is not kept is worse than an
    // honest one that is.
    //
    // What IS worth doing is a fix the moment the screen comes back, so the
    // gap is bounded by how long the phone was away rather than by when the
    // next tick happens to land.
    const onBack = () => {
      if (document.visibilityState === "visible" && onRef.current) void send();
    };
    document.addEventListener("visibilitychange", onBack);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [on]);

  if (!state) {
    return (
      <main className="tsheet">
        <p className="tsloading">Loading your timesheet&hellip;</p>
      </main>
    );
  }

  const today = state.worked;
  const total = today.hours + today.running;
  const openShift = state.shifts.find((s) => !s.endedAt) ?? null;
  const unsigned = state.shifts.some((s) => s.endedAt && !s.signedOffAt) && !on;
  const shown = showLast ? state.lastWeek : state.week;
  const waiting = state.asks.filter((a) => a.state === "asked");

  return (
    <main className="tsheet">
      <header className="tshead">
        <h1>Timesheet</h1>
        <p className="tswho">{name}</p>
      </header>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}
      {said ? <p className="tsdone" role="status">{said}</p> : null}

      {/* ---------------------------------------------------------- today
          The card carries the state as a block of colour, readable across a
          yard at arm's length: green on the clock, red off it.

          The WORDS still carry the answer. Red and green are the one pair a
          colour-blind man cannot tell apart, and roughly one in twelve of
          them is -- so the card says "On the Clock" or "Off the Clock" and
          the button says Clock In or Clock Out, and the colour only agrees
          with them. The rest of the stylesheet avoids this pair entirely for
          that reason; here it is the right answer because it is a glance at
          two states and the text is right there beside it. */}
      <section className={`tscard today ${on ? (state.onBreak ? "onbreak" : "onclock") : "offclock"}`}>
        <div className="tscardhead">
          <h2>Today</h2>
          <span className="tsbadge state">
            {on ? (state.onBreak ? "On Break" : "On the Clock") : "Off the Clock"}
          </span>
        </div>

        <p className="tsdate">{longDay(new Date().toISOString().slice(0, 10))}</p>

        <div className="tsbig">
          <span className="tshours">{hhmm(total)}</span>
          <span className="tsunit">hours</span>
        </div>
        {today.breakMinutes
          ? <p className="tsnote">{today.breakMinutes} minutes of breaks recorded</p>
          : null}

        <button className={`tsact ${on ? "stop" : "go"}`} disabled={busy}
                onClick={() => act(on ? "out" : "in")}>
          {busy
            ? (finding ? "Checking your location…" : "Please wait…")
            : on ? "Clock Out" : "Clock In"}
        </button>

        {on ? (
          <button className="tsminor" disabled={busy}
                  onClick={() => act(state.onBreak ? "break-end" : "break-start")}>
            {state.onBreak ? "End Break" : "Begin Break"}
          </button>
        ) : null}

        {state.shifts.length ? (
          <ul className="tsruns">
            {state.shifts.map((s) => (
              <li key={s.id}>
                <span className="tsspan">
                  {clockTime(s.startedAt)} &ndash; {s.endedAt ? clockTime(s.endedAt) : "now"}
                </span>
                <span className="tsplace">
                  {s.propertyId
                    ? state.places.find((p) => p.id === s.propertyId)?.name ?? "A property"
                    : "No job recorded"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tsnote">No hours recorded today.</p>
        )}

        {/* The fence could not tell, or said two. Asking beats guessing:
            labour filed against the wrong property is worse than labour
            filed against none. */}
        {on && !openShift?.propertyId ? (
          <div className="tsfield">
            <label htmlFor="job">Which job are you on?</label>
            <select id="job" disabled={busy} defaultValue=""
                    onChange={(e) => e.target.value && act("where", { propertyId: e.target.value })}>
              <option value="" disabled>Select a property</option>
              {state.places.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {!state.places.length ? (
              <p className="tsnote">
                No properties on file yet. Your office can add them.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Said out loud. Somebody who cannot tell whether they are being
            followed assumes the worse answer, and they would be right to. */}
        {on ? (
          <p className="tstrail">
            Your location is recorded about every {Math.round(PING_MS / 60_000)} minutes
            while this screen is open and you are on the clock. It stops when you
            clock out, and while your phone is locked or on another app.
          </p>
        ) : null}
      </section>

      {state.nudges.map((n) => (
        <p key={n.key} className={`tsnudge ${n.urgent ? "loud" : ""}`}>{n.says}</p>
      ))}

      {unsigned ? (
        <button className="tsminor wide" disabled={busy}
                onClick={async () => {
                  if (await act("sign-off")) setSaid("Hours submitted for approval.");
                }}>
          Submit {hhmm(today.hours)} Hours for Approval
        </button>
      ) : null}

      {/* ----------------------------------------------------------- week */}
      <section className="tscard">
        <div className="tscardhead">
          <h2>{showLast ? "Last Week" : "This Week"}</h2>
          <button className="tslink" onClick={() => setShowLast(!showLast)}>
            {showLast ? "Show This Week" : "Show Last Week"}
          </button>
        </div>

        <table className="tsweek">
          <thead>
            <tr><th scope="col">Day</th><th scope="col">Hours</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {shown.days.map((d) => (
              <tr key={d.day} className={d.hours || d.running ? "" : "tsoff"}>
                <th scope="row">{dayName(d.day)}</th>
                <td className="tsnum">
                  {d.hours || d.running ? hhmm(d.hours + d.running) : "—"}
                </td>
                <td className="tsstate">
                  {d.running ? "In progress"
                   : !d.hours ? ""
                   : d.signedOff ? "Approved ✓" : "Awaiting approval"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="tsnum">{hhmm(shown.hours + shown.running)}</td>
              <td className="tsstate">
                {shown.toSign ? `${shown.toSign} to submit` : ""}
              </td>
            </tr>
          </tfoot>
        </table>
        {shown.breakMinutes
          ? <p className="tsnote">{shown.breakMinutes} minutes of breaks recorded this week.</p>
          : null}
      </section>

      {/* -------------------------------------------------------- requests */}
      <section className="tscard">
        <div className="tscardhead">
          <h2>Corrections</h2>
          {!asking ? (
            <button className="tslink" onClick={() => setAsking(true)}>
              Request an Adjustment
            </button>
          ) : null}
        </div>

        {asking ? (
          <AskForm shifts={state.shifts} week={state.week} busy={busy}
                   onCancel={() => setAsking(false)}
                   onSend={async (body) => {
                     if (await act("ask", body)) {
                       setAsking(false);
                       setSaid("Your request has been sent to the office.");
                     }
                   }} />
        ) : (
          <p className="tsnote">
            Forgot to clock in, or took a break you did not record? Send a
            request and the office will review it. Your hours do not change
            until it is approved.
          </p>
        )}

        {state.asks.length ? (
          <ul className="tsasks">
            {state.asks.slice(0, 6).map((a) => (
              <li key={a.id}>
                <span className="tsasksaid">
                  {KINDS.find((k) => k.key === a.kind)?.said ?? a.kind}
                </span>
                <span className="tsaskwhy">{a.reason}</span>
                <span className={`tsbadge ${a.state}`}>
                  {a.state === "asked" ? "Pending Review"
                   : a.state === "approved" ? "Approved" : "Declined"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {waiting.length
          ? <p className="tsnote">
              {waiting.length === 1 ? "One request is" : `${waiting.length} requests are`}
              {" "}with the office. Your hours are unchanged until they are approved.
            </p>
          : null}
      </section>
    </main>
  );
}

/**
 * Asking for a correction.
 *
 * The form asks WHAT went wrong first, and shows only the fields that kind of
 * problem actually needs -- a missed break asks for minutes and nothing else,
 * because a form that offers to move the start time as well is a form that
 * moves it by accident.
 */
function AskForm(
  { shifts, week, busy, onSend, onCancel }: {
    shifts: Shift[]; week: Week; busy: boolean;
    onSend: (body: Record<string, unknown>) => void; onCancel: () => void;
  },
) {
  const [kind, setKind] = useState(KINDS[0].key);
  const [shiftId, setShiftId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [mins, setMins] = useState("30");
  const [reason, setReason] = useState("");
  const needs = KINDS.find((k) => k.key === kind)?.needs ?? "none";

  // Every shift in the week, so a correction can be asked about Tuesday on
  // Friday -- which is when somebody actually notices.
  const recent = week.days.flatMap((d) => d.shifts).concat(
    shifts.filter((s) => !week.days.some((d) => d.shifts.some((x) => x.id === s.id))));

  return (
    <div className="tsform">
      <div className="tsfield">
        <label htmlFor="k">What happened?</label>
        <select id="k" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.said}</option>)}
        </select>
      </div>

      {kind !== "never_clocked_in" && recent.length ? (
        <div className="tsfield">
          <label htmlFor="sh">Which shift?</label>
          <select id="sh" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Not listed</option>
            {recent.map((s) => (
              <option key={s.id} value={s.id}>
                {dayName(s.startedAt.slice(0, 10))} &middot; {clockTime(s.startedAt)}
                {s.endedAt ? ` – ${clockTime(s.endedAt)}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {needs === "times" ? (
        <>
          <div className="tsfield">
            <label htmlFor="st">Actual start</label>
            <input id="st" type="datetime-local" value={start}
                   onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="tsfield">
            <label htmlFor="en">Actual finish</label>
            <input id="en" type="datetime-local" value={end}
                   onChange={(e) => setEnd(e.target.value)} />
          </div>
        </>
      ) : null}

      {needs === "break" ? (
        <div className="tsfield">
          <label htmlFor="mn">Break length, in minutes</label>
          <input id="mn" type="number" inputMode="numeric" min="1" max="480"
                 value={mins} onChange={(e) => setMins(e.target.value)} />
        </div>
      ) : null}

      <div className="tsfield">
        <label htmlFor="rs">Why</label>
        <textarea id="rs" rows={3} value={reason} placeholder="My phone was dead until half nine."
                  onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="tsrow">
        <button className="tsact go" disabled={busy || reason.trim().length < 3}
                onClick={() => onSend({
                  kind, shiftId: shiftId || null,
                  start: needs === "times" ? start : "",
                  end: needs === "times" ? end : "",
                  breakMinutes: needs === "break" ? Number(mins) : 0,
                  reason,
                })}>
          Send Request
        </button>
        <button className="tsminor" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
