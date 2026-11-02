"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Ask Rent Manager for anything new, because somebody opened the inbox.
 *
 * Draws nothing until it has something to say. A spinner on every page load
 * for a thing that is usually a no-op is noise, and noise on the screen
 * somebody lives in all day is noise they stop reading.
 *
 * Fired after paint, never awaited by the page: the pull can take most of a
 * minute and the inbox must not wait for it. Whether it runs at all is the
 * database's decision -- see migration 042 -- so twenty tabs open across the
 * office make one pull between them, not twenty.
 */
export default function PullNew() {
  const router = useRouter();
  const [filed, setFiled] = useState(0);
  const [mended, setMended] = useState(0);
  const [stillBlank, setStillBlank] = useState(0);
  const [needs, setNeeds] = useState<string | null>(null);
  /* React runs effects twice in development. Without this the second run is
     refused by the lock and looks like working code, which is the worst way
     to find out the guard is the only thing saving you. */
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let alive = true;
    (async () => {
      const res = await fetch("/api/rentmanager/issues/auto", { method: "POST" })
        .catch(() => null);
      if (!res || !alive) return;
      const out = await res.json().catch(() => null);
      if (!out || !alive) return;
      if (out.needs) { setNeeds(out.needs); return; }
      if (out.mended > 0) {
        setMended(out.mended);
        setStillBlank(out.stillBlank ?? 0);
      }
      if (out.filed > 0) setFiled(out.filed);
      if (out.filed > 0 || out.mended > 0) {
        // The new rows are on the server; the list on screen is older than it.
        router.refresh();
      }
    })();
    return () => { alive = false; };
  }, [router]);

  if (needs) return <p className="pullnote warn">{needs}</p>;

  /* THE TIDYING IS WORTH SAYING, AND ONLY WHILE IT IS HAPPENING.
   *
   * Requests pulled from Rent Manager arrive with no tenant, no number
   * and no lot -- the issue record carries none of them. They are being
   * filled in a dozen at a time, by itself, whenever somebody opens this
   * page. Nobody presses anything.
   *
   * Said while there is progress to report and silent otherwise. A line
   * that appears every single time is a line that stops being read, and
   * this one is only interesting while the backlog is going down. */
  if (!filed && !mended) return null;

  if (!filed && mended) {
    return (
      <p className="pullnote">
        {mended === 1
          ? "Filled in the tenant and address on 1 older maintenance request."
          : `Filled in the tenant and address on ${mended} older maintenance`
            + " requests."}
        {stillBlank > 0 && ` ${stillBlank} still to go — they fill in`
          + " as you work, a few each time you open this page."}
      </p>
    );
  }

  /* ANYTHING THIS FINDS IS SOMETHING THE EMAIL MISSED.
   *
   * Rent Manager emails a notification the moment a tenant submits, and that
   * mail is the real-time path: a Gmail filter forwards it, Postmark takes
   * it, the webhook files it within seconds. This poll is the backstop.
   *
   * So a request turning up HERE is evidence the forward did not deliver it
   * -- and that is worth saying, because a broken forward is otherwise
   * perfectly silent. Nothing errors. It reads as a quiet week.
   *
   * Said once, beside the thing it is about, rather than left on a settings
   * page nobody opens until somebody rings up. */
  return (
    <p className="pullnote">
      {filed === 1
        ? "1 maintenance request came in from Tenant Web Access."
        : `${filed} maintenance requests came in from Tenant Web Access.`}
      {mended > 0 && ` Filled in the tenant and address on ${mended} older`
        + ` one${mended === 1 ? "" : "s"}${stillBlank > 0
            ? `, ${stillBlank} still to go` : ""}.`}
      {" "}
      <a href="/setup">
        These were found by checking Rent Manager directly. If the email
        forward were working they would have arrived the moment they were
        submitted — check it here.
      </a>
    </p>
  );
}
