"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One button.
 *
 * This is a phone in a work glove in a yard, so the button is the whole
 * screen and everything else is underneath it. The things that matter here
 * are not features:
 *
 * NOTHING CHANGES ON SCREEN UNTIL THE SERVER SAYS IT TOOK IT. A clock-in that
 * failed and a clock-in that worked must not look the same from the chair --
 * this is a pay record, and "I pressed it" against "we have no row" is an
 * argument nobody can win. The same fault as the team chat send and the park
 * layout debounce.
 *
 * THE POSITION IS ASKED FOR, AND NEVER WAITED ON FOREVER. A phone in a metal
 * building can take thirty seconds to answer or never answer at all. The
 * clock-in goes through without it after a few seconds, recorded as having no
 * position, because a man standing there unable to start work is a worse
 * outcome than a row with a blank in it.
 *
 * AND THE TRACKING IS SAID OUT LOUD. The screen says when it is sending a
 * position and when it has stopped. Somebody who cannot tell whether they are
 * being followed assumes the worse answer, and they would be right to.
 */

type Nudge = { key: string; says: string; urgent?: boolean };
type State = {
  worked: { hours: number; running: number; breakMinutes: number; onTheClock: boolean;
            abandoned: { id: string; startedAt: string }[] };
  onBreak: boolean;
  openShiftId: string | null;
  nudges: Nudge[];
  places: { id: string; name: string }[];
  shifts: { id: string; startedAt: string; endedAt: string | null;
            propertyId: string | null }[];
};

/** How long to wait for a position before going without one. */
const FIX_MS = 6_000;
/** How often to send one while on the clock. Generous on purpose: a ping a
 *  minute is a battery complaint and a tracking device, and neither is what
 *  was asked for. */
const PING_MS = 10 * 60_000;

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

const clock = (h: number) => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, "0")}m`;
};

export default function ClockScreen({ name }: { name: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState<"asking" | "sent" | "none" | null>(null);
  const on = state?.worked.onTheClock ?? false;
  const onRef = useRef(on);
  onRef.current = on;

  const load = useCallback(async () => {
    const res = await fetch("/api/clock").catch(() => null);
    if (!res?.ok) return;
    setState(await res.json().catch(() => null));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setProblem(null);
    setSending(action === "in" || action === "out" ? "asking" : null);

    const fix = (action === "in" || action === "out")
      ? fixOf(await position()) : null;

    const res = await fetch("/api/clock", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, fix, ...extra }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};

    setBusy(false);
    setSending(null);
    // Nothing on screen moves until the server says it took it. This is a pay
    // record: a press that failed must not look like a press that worked.
    if (!res || !res.ok) {
      setProblem(out.error ?? "That didn't go through. Try again.");
      return;
    }
    setState(out as State);
  };

  // The trail belongs to the shift. It starts when the shift does and stops
  // when it does, and the screen below says which it is doing.
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
    return () => { alive = false; clearInterval(id); };
  }, [on]);

  if (!state) return <main className="clockwrap"><p className="clockload">One moment…</p></main>;

  const total = state.worked.hours + state.worked.running;
  const unsigned = state.shifts.some((s) => s.endedAt) && !state.worked.onTheClock;

  return (
    <main className="clockwrap">
      <p className="clockwho">{name}</p>

      <button className={`clockbig ${on ? "off" : "in"}`} disabled={busy}
              onClick={() => act(on ? "out" : "in")}>
        {busy ? (sending === "asking" ? "Finding you…" : "One moment…")
              : on ? "Clock out" : "Clock in"}
      </button>

      {problem ? <p className="clockbad">{problem}</p> : null}

      <p className="clocksum">
        {on ? `On the clock · ${clock(total)} today` : `${clock(state.worked.hours)} today`}
        {state.worked.breakMinutes
          ? ` · ${state.worked.breakMinutes} min break` : ""}
      </p>

      {on ? (
        <>
          <button className="clockmid" disabled={busy}
                  onClick={() => act(state.onBreak ? "break-end" : "break-start")}>
            {state.onBreak ? "Back from break" : "Start break"}
          </button>

          {/* Said out loud. Somebody who cannot tell whether they are being
              followed assumes the worse answer, and they would be right to. */}
          <p className="clocktrail">
            Sending your position every {Math.round(PING_MS / 60_000)} minutes while
            you are on the clock. It stops when you clock out.
          </p>

          {/* The fence could not tell, or said two. Asking beats guessing:
              labour filed against the wrong house is worse than labour filed
              against none. */}
          {!state.shifts.find((s) => !s.endedAt)?.propertyId ? (
            <label className="clockwhere">
              Which job are you on?
              <select disabled={busy} defaultValue=""
                      onChange={(e) => act("where", { propertyId: e.target.value })}>
                <option value="" disabled>Choose a property</option>
                {state.places.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      {state.nudges.map((n) => (
        <p key={n.key} className={`clocknudge ${n.urgent ? "loud" : ""}`}>{n.says}</p>
      ))}

      {unsigned ? (
        <button className="clockmid" disabled={busy} onClick={() => act("sign-off")}>
          Sign off {clock(state.worked.hours)}
        </button>
      ) : null}

      <ul className="clocklist">
        {state.shifts.map((s) => (
          <li key={s.id}>
            <span className="clockspan">
              {new Date(s.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" – "}
              {s.endedAt
                ? new Date(s.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "now"}
            </span>
            <span className="clockat">
              {s.propertyId
                ? state.places.find((p) => p.id === s.propertyId)?.name ?? "a property"
                : "no job set"}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
