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
      if (out.filed > 0) {
        setFiled(out.filed);
        // The new rows are on the server; the list on screen is older than it.
        router.refresh();
      }
    })();
    return () => { alive = false; };
  }, [router]);

  if (needs) return <p className="pullnote warn">{needs}</p>;
  if (!filed) return null;
  return (
    <p className="pullnote">
      {filed === 1
        ? "1 new maintenance request came in from Tenant Web Access."
        : `${filed} new maintenance requests came in from Tenant Web Access.`}
    </p>
  );
}
