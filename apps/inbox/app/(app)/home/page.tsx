import Link from "next/link";
import { spell } from "@/lib/empty";
import { leaks } from "@/lib/leaks";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import { money } from "@/lib/prices";
import { catLabel, type Category } from "@/lib/category";
import WhosHere from "@/components/WhosHere";
import MaintenanceBox from "@/components/MaintenanceBox";
import type { JobRow } from "@/lib/jobs";

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
    { data: clocks },
    { data: asked },
    { data: doneJobs },
    { data: bills },
  ] = await Promise.all([
    // Asked for in full rather than counted. The count was already here and a
    // count is not an answer: "11 open" says there is work and nothing about
    // which work. The same rows now serve both the number at the top and the
    // list below it, so they cannot disagree.
    supabase.from("work_orders")
      .select("id, summary, urgency, status, scheduled_for, created_at, conversation_id, units(label, properties(name)), staff:assigned_tech(full_name), vendor:assigned_vendor(full_name)")
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
    // Both of these arrive with 037, and both are asked for on their own so a
    // database without that migration loses the two new numbers rather than
    // the whole dashboard. Last in the list because the destructuring above
    // is positional, and an insert in the middle silently hands every query
    // after it the wrong rows -- which typechecks only by luck.
    supabase.from("units")
      // One string literal, not a concatenation: the client infers the row
      // type from the select text, and a joined string makes every field on
      // the result an error rather than a column.
      .select("id, label, bedrooms, monthly_rent, available_on, vacant_since, vacant_since_estimated, blocker, properties(name, address)")
      .eq("is_vacant", true),
    supabase.from("inquiries")
      .select("id, bedrooms_min, price_ceiling, area, has_pets, move_in_from")
      .eq("outcome", "open"),
    // Finished work with nothing on it. Ninety days because a job costed six
    // months late was never going to be costed, and a list that long is one
    // nobody opens.
    supabase.from("work_orders").select("id, completed_at, cost_cents")
      .eq("status", "done").gte("completed_at", quarterBack),
    supabase.from("vendor_invoices").select("id, amount_cents, emailed_at"),
  ]);

  const jobs = openJobs ?? [];

  // Flattened here rather than in the component, so the component takes a
  // shape it can render and not a shape Supabase happened to return.
  const jobRows: JobRow[] = jobs.map((j) => {
    const unit = j.units as unknown as
      { label: string; properties: { name: string } | null } | null;
    const property = unit?.properties?.name ?? null;
    return {
      id: j.id,
      summary: j.summary,
      status: j.status,
      urgency: j.urgency ?? null,
      scheduledFor: j.scheduled_for ?? null,
      createdAt: j.created_at,
      conversationId: j.conversation_id ?? null,
      where: unit
        ? [property, unit.label].filter(Boolean).join(" · ")
        : property,
      // The vendor first: a plumber is who is actually standing in the
      // bathroom, and the member of staff who dispatched him is not.
      who: (j.vendor as unknown as { full_name: string } | null)?.full_name
        ?? (j.staff as unknown as { full_name: string } | null)?.full_name ?? null,
    };
  });
  const urgent = jobs.filter((j) => (j.urgency ?? 3) <= 2).length;
  const overdue = jobs.filter((j) =>
    j.scheduled_for && j.scheduled_for < now.toISOString()).length;

  const allUnits = units ?? [];
  const vacant = allUnits.filter((u) => u.is_vacant);
  // What the empty ones would bring in if they were let. The number an owner
  // actually feels, and the reason vacancy is a cost rather than a count.
  const lostRent = vacant.reduce((a, u) => a + Number(u.monthly_rent ?? 0), 0);
  // What the empty lots have cost so far, not what they cost per month.
  //
  // Only the lots with a measured start date count towards it. A backfilled
  // date is a guess, and a guess multiplied by a rent is a figure somebody
  // puts in front of an investor -- so the ones carried over from before
  // anything was measuring are left out rather than estimated into the total.
  // The empty lots, the people waiting, and the two kinds of money nobody
  // has filed. Every one of these is tolerant of its migration being absent:
  // a query that fails comes back as null and its line simply is not there,
  // rather than taking the dashboard with it.
  const whereItGoes = leaks({
    empty: (clocks ?? []).map((u) => {
      const prop = u.properties as unknown as { name: string; address: string | null } | null;
      return {
        id: String(u.id), label: String(u.label ?? ""), property: prop?.name ?? "—",
        rent: u.monthly_rent === null || u.monthly_rent === undefined
          ? null : Number(u.monthly_rent),
        bedrooms: (u.bedrooms as number | null) ?? null,
        area: prop?.address ?? null,
        availableOn: (u.available_on as string | null) ?? null,
        vacantSince: (u.vacant_since as string | null) ?? null,
        vacantSinceEstimated: Boolean(u.vacant_since_estimated),
        blocker: (u.blocker as string | null) ?? null,
      };
    }),
    looking: (asked ?? []).map((i) => ({
      id: String(i.id),
      wanted: {
        bedroomsMin: (i.bedrooms_min as number | null) ?? undefined,
        priceCeiling: i.price_ceiling === null || i.price_ceiling === undefined
          ? undefined : Number(i.price_ceiling),
        area: (i.area as string | null) ?? undefined,
        // A stored false is a stated no. `?? undefined` would turn it back
        // into "nobody asked", which is a different answer.
        hasPets: i.has_pets === null || i.has_pets === undefined
          ? undefined : Boolean(i.has_pets),
        moveInFrom: (i.move_in_from as string | null) ?? undefined,
      },
    })),
    jobs: (doneJobs ?? []).map((j) => ({
      id: String(j.id),
      completedAt: (j.completed_at as string | null) ?? null,
      costCents: (j.cost_cents as number | null) ?? null,
    })),
    invoices: (bills ?? []).map((b) => ({
      id: String(b.id),
      amountCents: Number(b.amount_cents ?? 0),
      emailedAt: (b.emailed_at as string | null) ?? null,
    })),
  });

  const goneAlready = Math.round((clocks ?? []).reduce((a, c) => {
    if (c.vacant_since_estimated) return a;
    const s = spell(c.vacant_since as string | null);
    const rent = Number(c.monthly_rent ?? 0);
    return a + (s && rent ? (s.days / 30.44) * rent : 0);
  }, 0));

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
                href="/leasing"
                note={allUnits.length
                  ? [`${money(lostRent * 100)}/mo not coming in`,
                     occupancy === null ? null : `${occupancy}% occupied`,
                     // The number that makes somebody act. A lot empty since
                     // July has already cost a figure, and the monthly rate
                     // reads as something that is about to happen rather than
                     // something that has.
                     goneAlready ? `${money(goneAlready * 100)} gone already` : null]
                      .filter(Boolean).join(" · ")
                  : "no units on file yet"} />

        <Metric label="Looking for a home" value={(asked ?? []).length || null} href="/leasing"
                note={(asked ?? []).length
                  ? "what each of them asked for, and the lots that fit"
                  : "nothing recorded yet — every enquiry from now on lands here"} />

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

      {whereItGoes.length ? (
        /* Where the money is going, and where there is more of it.
         *
         * Money to be had first -- it is the only line anybody can act on
         * today, and a list that opens with four things going wrong is a list
         * that gets shut.
         *
         * Nothing leaking is nothing here. An empty list is not the same as a
         * screen of zeroes, and a business with none of these problems should
         * not be shown a panel telling it so. */
        <section className="dashgroup">
          <h2>Where the money is</h2>
          <ul className="leak">
            {whereItGoes.map((l) => (
              <li key={l.key} className={l.upside ? "leakup" : ""}>
                <span className="leaksays">{l.says}</span>
                {l.perMonth ? (
                  <span className="leakfig">
                    {money(l.perMonth * 100)}{l.key === "unsent" ? "" : "/mo"}
                    {l.upside ? " if they let" : ""}
                  </span>
                ) : (
                  /* No figure, because the amount is genuinely not known. A
                     made-up number in the figures that decide what a property
                     costs to run is worse than a gap somebody can see. */
                  <span className="leaknofig">amount not known</span>
                )}
                {l.gone ? (
                  <span className="leakgone">{money(l.gone * 100)} gone already</span>
                ) : null}
                {l.short ? <span className="leakshort">{l.short.because}</span> : null}
                {l.go ? <Link className="leakgo" href={l.go.href}>{l.go.said}</Link> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <MaintenanceBox jobs={jobRows} />

      <WhosHere />

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
