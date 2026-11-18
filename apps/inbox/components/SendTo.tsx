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
  const [sheet, setSheet] = useState<"forward" | "job" | null>(null);

  return (
    <>
      {/* TWO BUTTONS, NOT A MENU.
          "There needs to be a create a ticket button on the messages."
          There was one, behind a dropdown labelled "Send to…" -- which is
          not what somebody looking to raise a ticket reads, so it was
          found by nobody for the second time. The feature has now been
          unreachable twice in two different ways, once behind a three-dot
          menu on a message bubble and once behind a word that described
          the other entry.

          Raising a ticket is the commoner of the two and says so. */}
      <button type="button" className="btn pri" onClick={() => setSheet("job")}>
        Create ticket
      </button>
      <button type="button" className="btn" onClick={() => setSheet("forward")}>
        Send to…
      </button>

      {sheet && (
        <HandOff messageId={messageId} preview={preview}
                 defaultMode={sheet} onClose={() => setSheet(null)} />
      )}
    </>
  );
}
