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
 * The notes, beside the conversation rather than inside it.
 *
 * "Didn't we talk about not having notes as a running list in the messages
 * portion but something easily referenceable? It should be in the right hand
 * pane ... you should be able to reference the notes easily while typing back
 * to the tenant or vendor."
 *
 * He asked twice. What existed was a dropdown hanging off the header: it
 * covered the thread, it shut the moment anything else was clicked, and it
 * could not be open at the same time as the box you type in -- which is the
 * whole of what he asked for. A thing you have to hold open to read is not
 * referenceable, the same way a thing you have to aim at is not usable.
 *
 * So it is a column, beside the messages and above nothing: the composer sits
 * under both, so the note and the half-written reply are on screen together.
 *
 * ON A PHONE there is no beside. 390px cannot carry two columns and a separate
 * screen is worse than the dropdown was -- it takes away the message you are
 * answering. So the same component, in DOM order after the messages and before
 * the composer, collapses to one band: tap it and the notes sit directly above
 * the box, which is the one place on a phone that satisfies "while typing".
 *
 * The two layouts are the same markup and differ only in CSS, so the phone is
 * not a second implementation that can rot.
 */
export default function NotesRail(
  { notes, media }: { notes: Note[]; media?: Record<string, string> },
) {
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Anything without a kind predates migration 022 and was a note back when
  // that was the only thing this table held.
  const written = notes.filter((n) => (n.kind ?? "note") === "note");
  const logged = notes.filter((n) => n.kind === "event");
  const newestFirst = (list: Note[]) =>
    [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = newestFirst(showLog ? notes : written);

  // The band's one line of preview, so a collapsed band on a phone still says
  // what the newest note is about rather than only that there is one. Taken
  // from the notes alone: "Moved from Maintenance to Leasing" is not what
  // anybody wants the one visible line to be.
  const peek = (newestFirst(written)[0]?.body ?? "").split("\n")[0].slice(0, 60);

  return (
    <aside className={`noterail${open ? " open" : ""}${written.length ? "" : " bare"}`}
           aria-label="Notes on this conversation">
      {/* Wide: a heading. There is nothing to toggle, so there is no control
          that does nothing -- a dead button is its own small lie. */}
      <span className="notetitle">
        Notes
        {written.length > 0 && <span className="notecount">{written.length}</span>}
      </span>

      {/* Narrow: the band. */}
      <button type="button" className="noteband" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}>
        <span className="nbt">
          Notes
          {written.length > 0 && <span className="notecount">{written.length}</span>}
        </span>
        {!open && peek && <span className="notepeek">{peek}</span>}
        <span className="nbc" aria-hidden="true">{open ? "⌄" : "⌃"}</span>
      </button>

      <div className="notesbody">
        {shown.length === 0 ? (
          <p className="notenone">
            {showLog
              ? "Nothing written and nothing logged."
              : "No notes yet. Switch the box below to Note and anything you "
                + "write stays with your team."}
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

        {/* Typed notes and logged events are kept apart. Both belong on the
            conversation and only one of them is somebody talking to their
            colleagues; mixing them means three real notes buried under forty
            lines of "Moved from Maintenance to Leasing". */}
        {logged.length > 0 && (
          <button type="button" className="mini" onClick={() => setShowLog((v) => !v)}>
            {showLog
              ? "Just the notes"
              : `Include ${logged.length} logged action${logged.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </aside>
  );
}
