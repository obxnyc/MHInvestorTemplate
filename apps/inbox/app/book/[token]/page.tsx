import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a showing — Larabee Homes" };

/**
 * The gate. A booking token only exists because the ruleset issued one, so a
 * prospect cannot reach the calendar by guessing a URL or sharing a link that
 * was never theirs. Cal.com handles availability, timezones, double-booking
 * and reminders; we own who is allowed to see it.
 */
export default async function Book({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();

  const { data: sub } = await db.from("prequal_submissions")
    .select("id, outcome, contact_id, unit_id, contacts(full_name, email), units(label, properties(name))")
    .eq("booking_token", token).maybeSingle();

  if (!sub || sub.outcome !== "auto_approve") notFound();

  const contact = sub.contacts as unknown as { full_name: string | null; email: string | null };
  const unit = sub.units as unknown as { label: string; properties: { name: string } };
  const address = `${unit?.properties?.name ?? ""}${unit?.label ? ` — ${unit.label}` : ""}`;

  const base = process.env.CALCOM_EVENT_URL;
  if (!base) {
    return (
      <main className="apply">
        <p className="brand">Larabee Homes</p>
        <h1>Almost there</h1>
        <p className="lede">
          You&rsquo;re prequalified for {address}. Our booking calendar isn&rsquo;t
          connected yet — we&rsquo;ll text you to arrange a time.
        </p>
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
