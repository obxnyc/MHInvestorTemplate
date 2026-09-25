"use client";
import { useState } from "react";
import { initials } from "@/lib/format";

export type Read = { staffId: string; at: string; name: string };

/**
 * Who has seen this message.
 *
 * Collapsed to a row of initials, because the answer is usually "everyone" and
 * a list of five names under every message would bury the messages. The names
 * and times are there on hover -- the detail that matters is not who looked,
 * it is when, and that only matters when something went wrong.
 *
 * Hover is not enough on its own: there is no hover on a phone, and a person
 * navigating by keyboard never triggers one. So the same panel opens on tap
 * and on focus, and hover is the shortcut rather than the mechanism.
 */
export default function Seen({ readers }: { readers: Read[] }) {
  const [open, setOpen] = useState(false);
  if (!readers.length) return null;

  return (
    <span className={`seen${open ? " open" : ""}`}>
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

      {/* Always rendered, shown by hover, focus or a tap. Rendering it only
          when open would mean hovering could not reveal it without JavaScript
          doing the work on every pointer move. */}
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
    </span>
  );
}
