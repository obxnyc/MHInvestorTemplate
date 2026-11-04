"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Hours, Rules } from "@/lib/slots";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** When we show homes. Prospects only ever see times inside these. */
export default function ShowingHours({ hours, rules }: { hours: Hours[]; rules: Rules }) {
  const router = useRouter();
  const [rows, setRows] = useState<Hours[]>(hours);
  const [r, setR] = useState<Rules>(rules);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (i: number, k: keyof Hours, v: string) =>
    setRows((x) => x.map((h, j) => (j === i ? { ...h, [k]: k === "weekday" ? Number(v) : v } : h)));

  async function save() {
    setBusy(true); setSaid(null);
    const res = await fetch("/api/showing-hours", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ hours: rows, rules: r }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res || !res.ok) { setSaid(out.error ?? "That didn't save. Try again."); return; }
    setSaid("Saved");
    router.refresh();
  }

  return (
    <div className="hoursbox">
      <ul className="hourslist">
        {rows.map((h, i) => (
          <li key={i}>
            <select value={h.weekday} onChange={(e) => set(i, "weekday", e.target.value)} aria-label="Day">
              {DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
            </select>
            <input type="time" value={h.starts} onChange={(e) => set(i, "starts", e.target.value)} aria-label="From" />
            <span>to</span>
            <input type="time" value={h.ends} onChange={(e) => set(i, "ends", e.target.value)} aria-label="Until" />
            <button className="leadout" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ul>
      <button className="leadout" onClick={() => setRows((x) => [...x, { weekday: 1, starts: "10:00", ends: "17:00" }])}>
        Add hours
      </button>
      <div className="hoursrules">
        <label>Each showing
          <select value={r.slotMinutes} onChange={(e) => setR({ ...r, slotMinutes: Number(e.target.value) })}>
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label>Notice we need
          <select value={r.noticeMinutes} onChange={(e) => setR({ ...r, noticeMinutes: Number(e.target.value) })}>
            {[0, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m === 0 ? "none" : m < 1440 ? `${m / 60} hr` : "a day"}</option>)}
          </select>
        </label>
        <label>Book up to
          <select value={r.horizonDays} onChange={(e) => setR({ ...r, horizonDays: Number(e.target.value) })}>
            {[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
          </select>
        </label>
        <label>Showings at once
          <select value={r.atOnce} onChange={(e) => setR({ ...r, atOnce: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <button className="btn pri" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save showing hours"}</button>
      {said ? <span className={said === "Saved" ? "leadyes" : "leadbut"}> {said}</span> : null}
    </div>
  );
}
