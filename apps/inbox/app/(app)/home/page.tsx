import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import { money } from "@/lib/prices";
import { catLabel, type Category } from "@/lib/category";

export const dynamic = "force-dynamic";

const DONE = ["done", "cancelled"];

/**
 * The owner's screen, and everyone else's.
 *
 * Two halves. The top is the business -- what is broken, what is empty, what is
 * owed -- and it is the same for everybody who can see it. The bottom is yours:
 * what you picked up and what is waiting on you.
 *
 * Some of these numbers are real and some are a shape waiting for data, and
 * that difference is drawn on the card rather than left for the reader to
 * guess. A dashboard that shows $0 owed because it has no ledger is worse than
 * one that says it has no ledger: the first is a wrong answer and the second is
 * a to-do. Nothing here invents a figure.
 *
 * What is missing is leases, rent charges and payments, and vendor invoices --
 * all of which live in Rent Manager today. The cards for them are built and
 * queryless; when that data lands they are a query each.
 */
export default async function Home() {
  const me = await requireStaff();
  if (!me) return null;
  const supabase = await supabaseServer();

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 864e5).toISOString();
  const monthBack = new Date(now.getTime() - 30 * 864e5).toISOString();
  const quarterBack = new Date(now.getTime() - 90 * 864e5).toISOString();

  const [
    { data: openJobs }, { data: units }, { data: showings },
    { data: recentDone }, { data: spend }, { count: unclaimed },
    { data: mine },
  ] = await Promise.all([
    supabase.from("work_orders").select("id, urgency, status, scheduled_for")
      .not("status", "in", `(${DONE.join(",")})`),
    supabase.from("units").select("id, is_vacant, monthly_rent, available_on"),
    supabase.from("showings").select("id, scheduled_for, attended")
      .gte("scheduled_for", monthBack),
    supabase.from("work_orders").select("created_at, completed_at")
      .eq("status", "done").gte("completed_at", quarterBack),
    supabase.from("work_orders").select("cost_cents, costed_on")
      .not("cost_cents", "is", null).gte("costed_on", monthBack.slice(0, 10)),
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .is("assigned_to", null).neq("status", "closed"),
    supabase.from("conversations")
      .select("id, subject, category, last_message_preview, last_message_at, contacts(full_name, phone)")
      .eq("assigned_to", me.id).neq("status", "closed")
      .order("last_message_at", { ascending: false }).limit(5),
  ]);

  const jobs = openJobs ?? [];
  const urgent = jobs.filter((j) => (j.urgency ?? 3) <= 2).length;
  const overdue = jobs.filter((j) =>
    j.scheduled_for && j.scheduled_for < now.toISOString()).length;

  const allUnits = units ?? [];
  const vacant = allUnits.filter((u) => u.is_vacant);
  // What the empty ones would bring in if they were let. The number an owner
  // actually feels, and the reason vacancy is a cost rather than a count.
  const lostRent = vacant.reduce((a, u) => a + Number(u.monthly_rent ?? 0), 0);
  const occupancy = allUnits.length
    ? Math.round(((allUnits.length - vacant.length) / allUnits.length) * 100) : null;

  const booked = (showings ?? []).filter((s) => s.scheduled_for >= now.toISOString()
    && s.scheduled_for <= weekAhead).length;
  const past = (showings ?? []).filter((s) => s.scheduled_for < now.toISOString());
  const showed = past.filter((s) => s.attended === true).length;
  const turnout = past.length ? Math.round((showed / past.length) * 100) : null;

  const closed = (recentDone ?? []).filter((w) => w.completed_at);
  const avgDays = closed.length
    ? Math.round(closed.reduce((a, w) =>
        a + (new Date(w.completed_at!).getTime() - new Date(w.created_at).getTime()), 0)
        / closed.length / 864e5 * 10) / 10
    : null;

  const spent = (spend ?? []).reduce((a, w) => a + (w.cost_cents ?? 0), 0);

  return (
    <div className="dash">
      <h1>{me.full_name}</h1>
      <p className="muted">The business, then what&rsquo;s yours.</p>

      <div className="mgrid">
        <Metric label="Open maintenance" value={jobs.length} href="/jobs"
                note={jobs.length
                  ? [urgent ? `${urgent} urgent` : null,
                     overdue ? `${overdue} past due` : null]
                      .filter(Boolean).join(" · ") || "none urgent or late"
                  : "nothing outstanding"} />

        <Metric label="Vacant" value={allUnits.length ? `${vacant.length}` : null}
                note={allUnits.length
                  ? `${money(lostRent * 100)}/mo not coming in${
                      occupancy === null ? "" : ` · ${occupancy}% occupied`}`
                  : "no units on file yet"} />

        <Metric label="Showings this week" value={booked}
                note={turnout === null
                  ? "no showings in the last 30 days"
                  : `${turnout}% turned up, last 30 days`} />

        <Metric label="Paid to trades" value={money(spent)}
                note="last 30 days, from jobs with a cost on them" />

        <Metric label="Average repair" value={avgDays === null ? null : `${avgDays} days`}
                note={avgDays === null
                  ? "no jobs closed in the last 90 days"
                  : "reported to finished, last 90 days"} />

        <Metric label="Nobody has picked up" value={unclaimed ?? 0}
                href="/?who=unclaimed"
                note={unclaimed ? "waiting on somebody" : "everything open has an owner"} />

        {/* Below here: built, and waiting on the data. Each says what it needs,
            because a card showing zero would be read as an answer. */}
        <Metric label="Expiring leases" pending="No leases on file" />
        <Metric label="Delinquency" pending="No rent ledger" />
        <Metric label="Money in" pending="No payments on file" />
        <Metric label="Outstanding invoices" pending="No invoices on file" />
      </div>

      <p className="dashnote">
        The last four need lease, rent and invoice data, which lives in Rent
        Manager today. They are laid out and empty on purpose — a figure invented
        to fill the space is worse than a gap that says what it is waiting for.
      </p>

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
    </div>
  );
}

/** One number. `pending` means there is no data behind it yet, and the card
 *  says so instead of showing a zero somebody would read as an answer. */
function Metric(
  { label, value, note, href, pending }:
  { label: string; value?: string | number | null; note?: string;
    href?: string; pending?: string },
) {
  const body = (
    <>
      <span className="mlabel">{label}</span>
      <span className="mvalue">{pending ? "—" : value ?? "—"}</span>
      <span className="mnote">{pending ?? note}</span>
    </>
  );
  if (pending) return <div className="metric pending">{body}</div>;
  return href
    ? <Link href={href} className="metric">{body}</Link>
    : <div className="metric">{body}</div>;
}
