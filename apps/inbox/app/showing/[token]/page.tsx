import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { homeName, whenSaid } from "@/lib/pipeline";
import CancelShowing from "@/components/CancelShowing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your showing — Larabee Homes" };

/**
 * The prospect's own page for their showing: when, where, and the two things
 * they might want -- a different time, or not to come. Every reminder links
 * here, because "reply to change it" makes the office do the moving, and the
 * office is showing somebody else a home at that moment.
 */
export default async function Showing({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();
  const { data: s } = await db.from("showings")
    .select("id, status, scheduled_for, unit_id, contact_id").eq("manage_token", token).maybeSingle();
  if (!s) notFound();

  const where = s.unit_id ? await homeName(db, s.unit_id as string) : { home: "the home", address: null };
  const { data: sub } = await db.from("prequal_submissions").select("booking_token")
    .eq("contact_id", s.contact_id).not("booking_token", "is", null)
    .order("decided_at", { ascending: false }).limit(1).maybeSingle();
  const live = s.status === "booked" || s.status === "confirmed";
  const past = Date.parse(s.scheduled_for as string) < Date.now();

  return (
    <main className="book">
      <p className="brand">Larabee Homes</p>
      <h1>Your showing</h1>
      <p className="lede">{where.home}</p>
      <dl className="showfacts">
        <div><dt>When</dt><dd>{whenSaid(s.scheduled_for as string)} (Eastern)</dd></div>
        {where.address ? <div><dt>Where</dt><dd>{where.address}</dd></div> : null}
        <div><dt>Status</dt><dd>{{
          booked: "Booked", confirmed: "Confirmed", cancelled: "Cancelled",
          shown: "Done — thanks for coming", no_show: "Missed",
        }[s.status as string] ?? s.status}</dd></div>
      </dl>
      {sub?.booking_token && !(past && s.status === "shown") ? (
        <p><a className="cta" href={`/book/${sub.booking_token}`}>
          {live ? "Pick a different time" : "Book another time"}
        </a></p>
      ) : null}
      {live && !past ? <CancelShowing token={token} /> : null}
    </main>
  );
}
