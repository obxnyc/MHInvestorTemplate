"use client";
import { useState } from "react";
import { readIntake, sentWhen } from "@/lib/intake-view";

/**
 * A portal submission, as a card rather than an email.
 *
 * The original stays one click away and nothing is thrown out. What changes
 * is what you see first: the place, the fault, and when the tenant actually
 * reported it -- which is the original Date line, not when somebody got round
 * to forwarding it. A repair reported Tuesday and forwarded Thursday is two
 * days old, and a thread that shows Thursday is telling you something untrue
 * at exactly the moment it matters.
 *
 * Falls back to the raw text whenever too little was understood. A card with
 * a heading and nothing under it is worse than the email it replaced.
 */
export default function IntakeCard({ body, label }: { body: string; label: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const v = readIntake(body);

  if (!v.readable) return <p className="rawmail">{body}</p>;

  const when = sentWhen(v.sentAt);

  return (
    <div className="intake">
      <div className="ihead">
        <span className="isrc">{v.from ?? label}</span>
        {when && <span className="iwhen">Reported {when}</span>}
      </div>

      {v.place && <p className="iplace">{v.place}</p>}
      {v.title && <p className="ititle">{v.title}</p>}
      {v.description && v.description !== v.title && (
        <p className="idesc">{v.description}</p>
      )}

      {(v.tenant || v.phone) && (
        <p className="iwho">
          {v.tenant}
          {v.tenant && v.phone && " · "}
          {v.phone}
        </p>
      )}

      <button type="button" className="iraw" onClick={() => setShowRaw((s) => !s)}>
        {showRaw ? "Hide original" : "Show original"}
      </button>
      {showRaw && <pre className="rawmail">{body}</pre>}
    </div>
  );
}
