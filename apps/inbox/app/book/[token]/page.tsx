import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { loadSlots, whenSaid } from "@/lib/pipeline";
import { ZONE } from "@/lib/zone";
import ShowingPicker from "@/components/ShowingPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a showing — Larabee Homes" };

/**
 * The gate. A booking token only exists because the ruleset issued one, or
 * because a person reviewed the answers and said yes -- so a prospect cannot
 * reach the calendar by guessing a URL or sharing a link that was never
 * theirs.
 *
 * Our own calendar by default: the showing hours set on the leasing screen,
 * less what is already booked. Cal.com instead when CALCOM_EVENT_URL is set,
 * as before.
 */
export default async function Book({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();

  const { data: sub } = await db.from("prequal_submissions")
    .select("id, outcome, reviewed_at, contact_id, unit_id, contacts(full_name, email), units(label, properties(name))")
    .eq("booking_token", token).maybeSingle();

  if (!sub || !(sub.outcome === "auto_approve" || sub.reviewed_at)) notFound();

  const contact = sub.contacts as unknown as { full_name: string | null; email: string | null };
  const unit = sub.units as unknown as { label: string; properties: { name: string } } | null;
  const address = `${unit?.properties?.name ?? ""}${unit?.label ? ` — ${unit.label}` : ""}`;

  // Already on the calendar? Then this page is about that showing, not a
  // second one -- booking again would be moving it, and it says so.
  const { data: upcoming } = await db.from("showings").select("scheduled_for, manage_token")
    .eq("contact_id", sub.contact_id).in("status", ["booked", "confirmed"])
    .gt("scheduled_for", new Date().toISOString()).order("scheduled_for").limit(1).maybeSingle();

  const base = process.env.CALCOM_EVENT_URL;
  if (!base) {
    const { slots } = await loadSlots(db);
    return (
      <main className="book">
        <p className="brand">Larabee Homes</p>
        <h1>Book a showing</h1>
        <p className="lede">{address}</p>
        {upcoming ? (
          <p className="pickhave">
            You&rsquo;re already booked for {whenSaid(upcoming.scheduled_for as string)}.
            {" "}Picking a time below moves it.{" "}
            {upcoming.manage_token ? <a href={`/showing/${upcoming.manage_token}`}>Cancel it instead</a> : null}
          </p>
        ) : null}
        <ShowingPicker token={token} slots={slots} zone={ZONE} unitId={sub.unit_id as string | null} />
        <p className="fineprint">Times are Eastern. A showing takes about half an hour.</p>
      </main>
    );
  }

  // Prefill and carry the submission id through, so the webhook can tie the
  // booking back to the person who qualified for it.
  const url = new URL(base);
  if (contact?.full_name) url.searchParams.set("name", contact.full_name);
  if (contact?.email) url.searchParams.set("email", contact.email);
  url.searchParams.set("metadata[submissionId]", sub.id);
  url.searchParams.set("metadata[unitId]", sub.unit_id ?? "");

  return (
    <main className="book">
      <p className="brand">Larabee Homes</p>
      <h1>Book a showing</h1>
      <p className="lede">{address}</p>
      <iframe src={url.toString()} title="Choose a showing time" className="cal" />
      <p className="fineprint">
        Trouble with the calendar? <a href={url.toString()}>Open it in a new tab</a>.
      </p>
    </main>
  );
}
