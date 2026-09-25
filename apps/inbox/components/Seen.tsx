"use client";
import { useState } from "react";

export type Read = { staffId: string; at: string; name: string };

const initials = (n: string) =>
  n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/**
 * Who has seen this message.
 *
 * Collapsed to a row of initials, because the answer is usually "everyone" and
 * a list of five names under every message would bury the messages. Tapping it
 * opens the times -- the detail that matters is not who looked, it is when,
 * and that only matters when something went wrong.
 *
 * Shown on inbound messages only. A receipt on a message we sent ourselves is
 * noise: what a shared line needs to know is whether a tenant's text has been
 * seen, not whether the office read its own reply.
 */
export default function Seen({ readers }: { readers: Read[] }) {
  const [open, setOpen] = useState(false);
  if (!readers.length) return null;

  return (
    <span className="seen">
      <button type="button" className="seenbtn" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              title={`Seen by ${readers.map((r) => r.name).join(", ")}`}>
        <span className="seenpips" aria-hidden="true">
          {readers.slice(0, 4).map((r) => (
            <span key={r.staffId} className="seenpip">{initials(r.name)}</span>
          ))}
        </span>
        <span className="seenword">
          {readers.length > 4 ? `+${readers.length - 4}` : ""} seen
        </span>
      </button>

      {open && (
        <ul className="seenlist">
          {readers.map((r) => (
            <li key={r.staffId}>
              <span className="seenpip">{initials(r.name)}</span>
              <span className="seenname">{r.name}</span>
              <span className="seenwhen">
                {new Date(r.at).toLocaleString("en-US", {
                  timeZone: "America/New_York", month: "short", day: "numeric",
                  hour: "numeric", minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
