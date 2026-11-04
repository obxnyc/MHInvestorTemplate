"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ZONE } from "@/lib/zone";

export type ShowingRow = {
  id: string; at: string; status: string; who: string; phone: string | null; home: string;
};

const SAID: Record<string, string> = {
  booked: "Booked", confirmed: "Confirmed", cancelled: "Cancelled", shown: "Shown", no_show: "Did not come",
};

/**
 * The calendar, as a list, with the one question each row is waiting on.
 * Upcoming: are they still coming. Past: did they come. Marking a no-show
 * sends them the rebooking link at once, which is why it is a button and not
 * a note somebody writes.
 */
export default function ShowingsList({ rows, canEdit }: { rows: ShowingRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function mark(id: string, status: string) {
    setBusy(id); setProblem(null);
    const res = await fetch("/api/showings", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(null);
    if (!res || !res.ok) { setProblem(out.error ?? "That didn't save. Try again."); return; }
    router.refresh();
  }

  const now = Date.now();
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", {
    timeZone: ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (!rows.length) {
    return <p className="leadnone">Nothing on the calendar. Prequalified people book themselves in from their link.</p>;
  }
  return (
    <>
      {problem ? <p className="leadbad">{problem}</p> : null}
      <ul className="showlist">
        {rows.map((r) => {
          const past = Date.parse(r.at) < now;
          const live = r.status === "booked" || r.status === "confirmed";
          return (
            <li key={r.id} className={`showrow${live ? "" : " done"}`}>
              <span className="showwhen">{when(r.at)}</span>
              <span className="showwho">{r.who}
                {r.phone ? <a className="leadtel" href={`tel:${r.phone}`}> {r.phone}</a> : null}
              </span>
              <span className="showhome">{r.home}</span>
              <span className={`showstate s-${r.status}`}>
                {past && live ? "Waiting to be marked" : SAID[r.status] ?? r.status}
              </span>
              {canEdit && live ? (
                <span className="showacts">
                  {past ? (
                    <>
                      <button className="leadout" disabled={busy === r.id} onClick={() => mark(r.id, "shown")}>They came</button>
                      <button className="leadout" disabled={busy === r.id} onClick={() => mark(r.id, "no_show")}>Did not come</button>
                    </>
                  ) : (
                    <>
                      {r.status === "booked"
                        ? <button className="leadout" disabled={busy === r.id} onClick={() => mark(r.id, "confirmed")}>They confirmed</button>
                        : null}
                      <button className="leadout" disabled={busy === r.id} onClick={() => mark(r.id, "cancelled")}>Cancel</button>
                    </>
                  )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
