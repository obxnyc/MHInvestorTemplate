"use client";
import { useCallback, useEffect, useState } from "react";

type Pair = {
  pulledMessageId: string; pulledConversationId: string;
  keepConversationId: string; title: string | null; when: string;
  keepIsFor: string | null;
};

/**
 * The same request, in the list twice.
 *
 * Every Tenant Web Access issue has arrived two ways for months: an
 * email with the tenant, their number and the address, and an hourly
 * pull with none of them. They are joined on arrival now, but the ones
 * already here are already two threads -- and the empty one is as likely
 * to be the one somebody opens.
 *
 * Nothing is touched until asked. What is asked for is CLOSED, not
 * deleted: a thread somebody might have written on is not a thing to
 * remove because a rule decided it was redundant.
 */
export default function TwinThreads() {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const look = useCallback(async () => {
    setProblem(null); setSaid(null);
    try {
      const res = await fetch("/api/rentmanager/twins?days=90", { cache: "no-store" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setProblem(out.error ?? "Could not look."); return; }
      setPairs(out.pairs ?? []);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not look.");
    }
  }, []);
  useEffect(() => { void look(); }, [look]);

  const close = async () => {
    if (!pairs?.length) return;
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/rentmanager/twins", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: pairs.map((p) => p.pulledConversationId) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { setProblem(out.error ?? "That did not work."); return; }
      /* BOTH NUMBERS. Twenty closed out of thirty is not a success and is
         not a failure, and saying either hides the ten. */
      setSaid(`${out.closed} closed.`
        + (out.kept ? ` ${out.kept} left alone — somebody had already replied`
          + " on them, which makes them conversations rather than duplicates." : ""));
      await look();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not work.");
    } finally { setBusy(false); }
  };

  return (
    <section className="rmtwins">
      <h2>The same request, twice</h2>
      <p>
        A Tenant Web Access issue reaches us two ways: Rent Manager emails
        it within the minute, with the tenant, their number and the address,
        and the hourly pull finds the same issue later with none of those.
        Arrivals are joined now. These are the pairs already here.
      </p>

      {problem && <p className="err">{problem}</p>}
      {said && <p className="dim">{said}</p>}

      {pairs === null ? (
        <p className="dim">Looking…</p>
      ) : !pairs.length ? (
        <p className="dim">
          No doubled-up requests in the last 90 days.
        </p>
      ) : (
        <>
          <p className="dim">
            <strong>{pairs.length}</strong> request
            {pairs.length === 1 ? "" : "s"} are in the list twice. Closing
            keeps the one that knows who it is from and closes the empty
            one — nothing is deleted, and anything somebody has replied on
            is left alone.
          </p>
          <ul className="twinlist">
            {pairs.slice(0, 40).map((p) => (
              <li key={p.pulledConversationId}>
                <strong>{p.title || "Untitled request"}</strong>
                <span className="dim">
                  {" "}· {new Date(p.when).toLocaleDateString("en-US",
                    { dateStyle: "medium" })}
                  {p.keepIsFor ? ` · keeping ${p.keepIsFor}` : ""}
                </span>
                <a href={`/c/${p.keepConversationId}`}>the one being kept</a>
                <a href={`/c/${p.pulledConversationId}`}>the empty one</a>
              </li>
            ))}
          </ul>
          {pairs.length > 40 && (
            <p className="dim">…and {pairs.length - 40} more.</p>
          )}
          <button type="button" className="btn pri" disabled={busy}
                  onClick={() => void close()}>
            {busy ? "Closing…" : `Close the ${pairs.length} empty one${
              pairs.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </section>
  );
}
