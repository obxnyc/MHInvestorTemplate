"use client";
import { useMemo, useState } from "react";

export type PickSlot = { start: string; end: string; day: string };

/**
 * Pick a showing time. Days across the top, times under the chosen day,
 * one press to book. Nothing on screen says "booked" until the server has
 * said so -- a time that went to somebody else a second earlier comes back
 * as a sentence asking for another, not as a confirmation that is not true.
 */
export default function ShowingPicker(
  { token, slots, zone, unitId }: { token: string; slots: PickSlot[]; zone: string; unitId?: string | null },
) {
  const days = useMemo(() => [...new Set(slots.map((s) => s.day))], [slots]);
  const [day, setDay] = useState(days[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ when: string; manageUrl: string } | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());

  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", {
    timeZone: zone, hour: "numeric", minute: "2-digit" });

  async function book(s: PickSlot) {
    setBusy(s.start); setProblem(null);
    const res = await fetch("/api/showings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ booking: token, start: s.start, unitId }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(null);
    if (!res || !res.ok) {
      setProblem(out.error ?? "That didn't book. Please try again.");
      if (res?.status === 409) setGone((g) => new Set(g).add(s.start));
      return;
    }
    setDone({ when: `${dayLabel(s.day)} at ${time(s.start)}`, manageUrl: out.manageUrl });
  }

  if (done) {
    return (
      <div className="pickdone">
        <h2>You&rsquo;re booked</h2>
        <p className="lede">{done.when}. We&rsquo;ve sent you a confirmation, and we&rsquo;ll remind you the day before.</p>
        <p>Need to change it? <a href={done.manageUrl}>Manage your showing</a>.</p>
      </div>
    );
  }

  if (!slots.length) {
    return (
      <p className="lede">
        There are no open showing times in the next couple of weeks. We&rsquo;ll be in touch
        to arrange one — or reply to our message and say when suits you.
      </p>
    );
  }

  const today = slots.filter((s) => s.day === day && !gone.has(s.start));
  return (
    <div className="pick">
      <div className="pickdays" role="tablist" aria-label="Day">
        {days.map((d) => (
          <button key={d} role="tab" aria-selected={d === day}
                  className={`pickday${d === day ? " on" : ""}`} onClick={() => setDay(d)}>
            {dayLabel(d)}
          </button>
        ))}
      </div>
      <div className="picktimes">
        {today.length ? today.map((s) => (
          <button key={s.start} className="picktime" disabled={!!busy} onClick={() => book(s)}>
            {busy === s.start ? "Booking…" : time(s.start)}
          </button>
        )) : <p className="muted">Nothing left on this day — try another.</p>}
      </div>
      {problem ? <p className="error">{problem}</p> : null}
    </div>
  );
}
