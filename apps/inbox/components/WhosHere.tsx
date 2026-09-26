"use client";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { STATUS_LABEL, since, type Status } from "@/lib/presence";

type Person = {
  id: string; name: string; role: string; status: Status;
  lastSeen: string | null; me: boolean; lastLogin?: string | null;
};

const ORDER: Status[] = ["online", "idle", "offline"];

const ROLE: Record<string, string> = {
  admin: "Admin", office: "Office", tech: "Maintenance", shower: "Showings",
};

/**
 * Who is on, who has stepped away, and who is not here.
 *
 * Refreshed on a timer rather than pushed. The list is a handful of people and
 * the question is never urgent to the second -- a socket per employee to save
 * thirty seconds of staleness is a lot of moving parts for "is Alex about".
 *
 * Last sign-in appears only for an admin, and only because the database will
 * not hand that column to anybody else. It is not on the wire for the rest of
 * the staff, so there is nothing to find in the network tab either.
 */
export default function WhosHere() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [pending, setPending] = useState(false);
  const [showLogins, setShowLogins] = useState(false);
  const [canSeeLogins, setCanSeeLogins] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/presence").then((r) => r.json()).then((d) => {
        if (!alive) return;
        setPending(Boolean(d.pending));
        setPeople(d.people ?? []);
        setCanSeeLogins(Boolean(d.canSeeLogins));
      }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (pending) {
    return (
      <section className="dashgroup">
        <h2>Who&rsquo;s here</h2>
        <p className="notice">
          Waiting on migration 018 being run on the database. Until then there
          is nowhere to record who is online.
        </p>
      </section>
    );
  }

  if (!people) {
    return (
      <section className="dashgroup">
        <h2>Who&rsquo;s here</h2>
        <p className="dashnone">Looking…</p>
      </section>
    );
  }

  const on = people.filter((p) => p.status === "online").length;

  return (
    <section className="dashgroup">
      <h2>
        Who&rsquo;s here <span className="cnt">{on}</span>
        {canSeeLogins && (
          <button type="button" className="mini whostoggle"
                  aria-pressed={showLogins}
                  onClick={() => setShowLogins((v) => !v)}>
            {showLogins ? "Hide last sign-in" : "Show last sign-in"}
          </button>
        )}
      </h2>

      <ul className="whoslist">
        {ORDER.flatMap((status) => {
          const group = people.filter((p) => p.status === status);
          if (!group.length) return [];
          return [
            <li key={status} className="whoshead">{STATUS_LABEL[status]}</li>,
            ...group.map((p) => (
              <li key={p.id} className={`whos ${status}`}>
                <span className="whosav">
                  <Avatar name={p.name} />
                  <span className={`dot ${status}`} aria-hidden="true" />
                </span>
                <span className="whosname">
                  {/* Name and badge on their own line. Left as siblings of the
                      role they stack above, the badge became a flex item of
                      the column and stretched the full width of the row. */}
                  <span className="whosline">
                    <span className="whoswho">{p.name}</span>
                    {p.me && <span className="whosyou">you</span>}
                  </span>
                  <span className="whosrole">{ROLE[p.role] ?? p.role}</span>
                </span>
                <span className="whoswhen">
                  {status === "online" ? "Online now" : since(p.lastSeen)}
                </span>
                {showLogins && canSeeLogins && (
                  <span className="whoslogin">
                    Last signed in {since(p.lastLogin ?? null)}
                  </span>
                )}
              </li>
            )),
          ];
        })}
        {!people.length && <li className="none">Nobody on the staff list yet.</li>}
      </ul>

      <p className="whosnote">
        {/* Said out loud, the same as the DM oversight line. A status that is
            visible one way only is not a status board. */}
        Everyone on staff can see this.
        {canSeeLogins
          ? " Last sign-in is yours alone — the database does not give that column to anybody else."
          : ""}
      </p>
    </section>
  );
}
