import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import { catLabel, type Category } from "@/lib/category";

export const dynamic = "force-dynamic";

/**
 * Where the logo takes you: your own screen, not the shared inbox.
 *
 * The inbox is everybody's. This is the part of it that is yours -- what you
 * picked up, what nobody has picked up yet, and what is waiting on you
 * elsewhere. Four people opening this see four different pages, which is the
 * whole point: "what am I supposed to be doing" is a different question from
 * "what has come in", and the shared list answers only the second.
 *
 * Deliberately thin. It is a place to stand, and what belongs on it is what
 * turns out to be missed -- which nobody knows yet, so nothing is invented
 * here to fill space.
 */
export default async function Home() {
  const me = await requireStaff();
  if (!me) return null;
  const supabase = await supabaseServer();

  const [{ data: mine }, { count: unclaimed }, { data: jobs }, { data: threads }] =
    await Promise.all([
      supabase.from("conversations")
        .select("id, subject, category, last_message_preview, last_message_at, contacts(full_name, phone)")
        .eq("assigned_to", me.id).neq("status", "closed")
        .order("last_message_at", { ascending: false }).limit(6),
      supabase.from("conversations")
        .select("id", { count: "exact", head: true })
        .is("assigned_to", null).neq("status", "closed"),
      supabase.from("work_orders")
        .select("id, summary, status, scheduled_for")
        .eq("assigned_tech", me.id).not("status", "in", "(done,cancelled)")
        .order("scheduled_for", { ascending: true, nullsFirst: false }).limit(6),
      supabase.from("dm_members")
        .select("last_read_at, thread:thread_id(id, title, dm_members(staff:staff_id(id, full_name)), dm_messages(created_at, author_id))")
        .eq("staff_id", me.id),
    ]);

  // Unread is "somebody else has said something since you last looked", worked
  // out here rather than stored, so it cannot go stale against the messages.
  const waiting = (threads ?? []).map((row) => {
    const t = row.thread as unknown as {
      id: string; title: string | null;
      dm_members: { staff: { id: string; full_name: string } | null }[];
      dm_messages: { created_at: string; author_id: string | null }[];
    } | null;
    if (!t) return null;
    const last = (t.dm_messages ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!last || last.author_id === me.id) return null;
    if (row.last_read_at && last.created_at <= row.last_read_at) return null;
    const others = (t.dm_members ?? []).map((m) => m.staff)
      .filter((s): s is { id: string; full_name: string } => s !== null && s.id !== me.id);
    return {
      id: t.id,
      who: t.title ?? (others.map((o) => o.full_name).join(", ") || "Just you"),
      at: last.created_at,
    };
  }).filter((x): x is { id: string; who: string; at: string } => x !== null)
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="dash">
      <h1>{me.full_name}</h1>
      <p className="muted">What&rsquo;s yours, and what nobody has picked up.</p>

      <section className="dashgroup">
        <h2>Yours <span className="cnt">{mine?.length ?? 0}</span></h2>
        {mine?.length ? (
          <ul className="dashlist">
            {mine.map((c) => {
              const who = c.contacts as unknown as
                { full_name: string | null; phone: string } | null;
              const name = who?.full_name || prettyPhone(who?.phone ?? "");
              return (
                <li key={c.id}>
                  <Link href={`/c/${c.id}`}>
                    <span className="dname">{name}</span>
                    <span className={`badge cat-${c.category}`}>
                      {catLabel(c.category as Category)}
                    </span>
                    <span className="dprev">{c.last_message_preview ?? c.subject}</span>
                    <span className="dwhen">{timeAgo(c.last_message_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dashnone">Nothing picked up. Anything you claim lands here.</p>
        )}
      </section>

      <section className="dashgroup">
        <h2>Waiting for anyone <span className="cnt">{unclaimed ?? 0}</span></h2>
        <p className="dashnone">
          {unclaimed
            ? `${unclaimed} conversation${unclaimed > 1 ? "s" : ""} nobody has picked up.`
            : "Everything that is open has somebody on it."}
          {" "}<Link className="dashgo" href="/?who=unclaimed">Open the inbox →</Link>
        </p>
      </section>

      {jobs?.length ? (
        <section className="dashgroup">
          <h2>Your jobs <span className="cnt">{jobs.length}</span></h2>
          <ul className="dashlist">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href="/jobs">
                  <span className="dname">{j.summary}</span>
                  <span className="badge">{j.status.replace("_", " ")}</span>
                  <span className="dwhen">
                    {j.scheduled_for ? timeAgo(j.scheduled_for) : "unscheduled"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {waiting.length ? (
        <section className="dashgroup">
          <h2>Team messages <span className="cnt">{waiting.length}</span></h2>
          <ul className="dashlist">
            {waiting.map((t) => (
              <li key={t.id}>
                <Link href={`/team?t=${t.id}`}>
                  <span className="dname">{t.who}</span>
                  <span className="pill warn">new</span>
                  <span className="dwhen">{timeAgo(t.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
