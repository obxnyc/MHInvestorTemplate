"use client";
import { useState } from "react";
import { clockTime, dayLabel } from "@/lib/format";
import Attachment from "./Attachment";

export type Note = {
  id: string;
  body: string;
  created_at: string;
  kind?: string;
  media_paths?: string[] | null;
  staff: { full_name: string } | null;
};

/**
 * Every note on this conversation, in one place.
 *
 * Notes render in the thread where they were written, which is right --
 * context is most of what a note means. But a thread is a scroll, and the
 * one line saying "the owner will not pay for a new heater, do not promise
 * one" is four hundred messages up by the time it matters. So it is also
 * here, gathered, newest first.
 *
 * Typed notes and logged events are kept apart. Both belong on the
 * conversation and only one of them is somebody talking to their colleagues;
 * mixing them means three real notes buried under forty lines of "Moved
 * from Maintenance to Leasing", which is the burial this exists to prevent.
 */
export default function NotesPanel(
  { notes, media }: { notes: Note[]; media?: Record<string, string> },
) {
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Anything without a kind predates migration 022 and was a note back when
  // that was the only thing this table held.
  const written = notes.filter((n) => (n.kind ?? "note") === "note");
  const logged = notes.filter((n) => n.kind === "event");
  const shown = showLog ? [...notes] : written;
  shown.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <button type="button" className={`noteslink${written.length ? " has" : ""}`}
              aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Notes
        {written.length > 0 && <span className="notecount">{written.length}</span>}
      </button>

      {open && (
        <div className="notesheet">
          {shown.length === 0 ? (
            <p className="dashnone">
              {showLog
                ? "Nothing written and nothing logged."
                : "No notes yet. Anything your team writes here stays internal."}
            </p>
          ) : (
            <ul className="noteslist">
              {shown.map((n) => (
                <li key={n.id} className={n.kind === "event" ? "logged" : ""}>
                  <span className="nwho">
                    {n.staff?.full_name ?? "Automatically"}
                    <span className="nwhen">
                      {dayLabel(n.created_at)} · {clockTime(n.created_at)}
                    </span>
                  </span>
                  {n.body && <p>{n.body}</p>}
                  {(n.media_paths ?? []).map((path) => (
                    <Attachment key={path} path={path} src={media?.[path]} />
                  ))}
                </li>
              ))}
            </ul>
          )}

          {logged.length > 0 && (
            <button type="button" className="mini" onClick={() => setShowLog((v) => !v)}>
              {showLog
                ? "Just the notes"
                : `Include ${logged.length} logged action${logged.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
