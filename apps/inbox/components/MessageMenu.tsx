"use client";
import { useState } from "react";
import HandOff from "./HandOff";

/** The two things anyone wants to do with a message that is not a reply: send
 *  it to someone who can act on it, or make it a job. Hidden behind a dot menu
 *  rather than sitting on every bubble, because a thread of forty messages with
 *  two buttons each is noise. */
export default function MessageMenu(
  { messageId, preview }: { messageId: string; preview: string },
) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"forward" | "job" | null>(null);

  return (
    <>
      <div className="msgmenu">
        <button type="button" className="msgdots" aria-label="More for this message"
                aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          &#8943;
        </button>
        {open && (
          <>
            <button type="button" className="scrim" aria-hidden="true" tabIndex={-1}
                    onClick={() => setOpen(false)} />
            <div className="ovmenu">
              <button className="ovitem" onClick={() => { setOpen(false); setSheet("forward"); }}>
                Forward…
              </button>
              <button className="ovitem" onClick={() => { setOpen(false); setSheet("job"); }}>
                Open a work order…
              </button>
            </div>
          </>
        )}
      </div>

      {sheet && (
        <HandOff messageId={messageId} preview={preview}
                 defaultMode={sheet} onClose={() => setSheet(null)} />
      )}
    </>
  );
}
