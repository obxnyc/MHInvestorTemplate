"use client";
import { useState } from "react";
import HandOff from "./HandOff";

/**
 * Send this request to somebody who can fix it.
 *
 * THE FEATURE EXISTED AND NOBODY COULD FIND IT. `HandOff` has done
 * forward-to-a-vendor and open-a-work-order since it was written, and
 * the only way in was a three-dot menu on one message bubble, halfway
 * down a scroll. "I also dont see a way to right click it and send to
 * someone in a maintenance ticket." There wasn't one — not on the
 * thread, which is the only screen the question is ever asked from.
 *
 * So it sits in the header beside Notes and Close, where the other
 * things you do TO a thread are, rather than the things you do to a
 * message. The per-message menu stays: forwarding one particular
 * photograph is a real thing and a different one.
 *
 * Two entries rather than one, because they are different decisions and
 * the work-order box is off by default inside `HandOff` for a good
 * reason: you text a plumber to ask whether a dead water heater is his
 * or the electrician's, and at most one of those turns into work. A job
 * opened at the moment of asking would be wrong often enough that
 * people stop opening them at all.
 */
export default function SendTo(
  { messageId, preview }: { messageId: string; preview: string },
) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"forward" | "job" | null>(null);

  return (
    <>
      <div className="msgmenu">
        <button type="button" className="btn" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}>
          Send to…
        </button>
        {open && (
          <>
            <button type="button" className="scrim" aria-hidden="true" tabIndex={-1}
                    onClick={() => setOpen(false)} />
            <div className="ovmenu">
              <button className="ovitem"
                      onClick={() => { setOpen(false); setSheet("forward"); }}>
                Send to a vendor or someone here…
              </button>
              <button className="ovitem"
                      onClick={() => { setOpen(false); setSheet("job"); }}>
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
