import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publicBase } from "@/lib/twilio";
import { stillOpen } from "@/lib/slots";
import { bookShowing, changeShowing, loadSlots } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who a booking link belongs to, if it is a live one. */
async function holder(db: ReturnType<typeof supabaseAdmin>, token: string) {
  const { data } = await db.from("prequal_submissions")
    .select("id, outcome, reviewed_at, contact_id, unit_id").eq("booking_token", token).maybeSingle();
  // The ruleset said yes, or a person reviewed it and said yes. Nothing else
  // reaches the calendar.
  if (!data || !(data.outcome === "auto_approve" || data.reviewed_at)) return null;
  return data;
}

/** Book. Public: the booking token is the permission. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const sub = await holder(db, String(body.booking ?? ""));
  if (!sub) return NextResponse.json({ error: "This booking link is not valid." }, { status: 404 });

  // Asked again here, not trusted from the page: the list they picked from
  // may be ten minutes old and somebody else may have the slot now.
  const { slots, rules } = await loadSlots(db);
  const slot = stillOpen(String(body.start ?? ""), slots);
  if (!slot) {
    return NextResponse.json({ error: "Somebody just took that time. Please pick another." },
                             { status: 409 });
  }

  try {
    const out = await bookShowing(db, {
      contactId: sub.contact_id as string,
      unitId: (body.unitId as string | undefined) || (sub.unit_id as string | null),
      submissionId: sub.id as string,
      start: slot.start, end: slot.end,
    }, publicBase(req));

    // Two people pressing the same slot in the same second both pass the
    // check above. Count afterwards; the later booking gives way.
    const { data: clash } = await db.from("showings").select("id, created_at")
      .in("status", ["booked", "confirmed"]).lt("scheduled_for", slot.end)
      .gt("ends_at", slot.start).order("created_at");
    if ((clash?.length ?? 0) > rules.atOnce
        && clash!.findIndex((c) => c.id === out.showingId) >= rules.atOnce) {
      await changeShowing(db, out.showingId, "cancelled", publicBase(req),
        { reason: "slot taken at the same moment" });
      return NextResponse.json({ error: "Somebody just took that time. Please pick another." },
                               { status: 409 });
    }
    return NextResponse.json({ ok: true, manageUrl: out.manageUrl });
  } catch (e) {
    console.error("booking failed", e);
    return NextResponse.json({ error: "That didn't book. Please try again." }, { status: 500 });
  }
}

/** The prospect cancels from their own link. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const { data: s } = await db.from("showings").select("id, status, scheduled_for")
    .eq("manage_token", String(body.manage ?? "")).maybeSingle();
  if (!s) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  if (body.action !== "cancel") return NextResponse.json({ error: "what?" }, { status: 400 });
  if (s.status !== "booked" && s.status !== "confirmed") {
    return NextResponse.json({ error: `This showing is already ${s.status}.` }, { status: 409 });
  }
  await changeShowing(db, s.id as string, "cancelled", publicBase(req), { by: "prospect" });
  return NextResponse.json({ ok: true });
}

/** The office marks what happened. */
export async function PATCH(req: Request) {
  const me = await requireStaff();
  // The desk, and whoever is out showing the home -- they are the one who
  // knows whether anybody turned up.
  if (!me || !(isDesk(me.role) || me.role === "shower")) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? "");
  if (!["confirmed", "cancelled", "shown", "no_show"].includes(status)) {
    return NextResponse.json({ error: "not a status" }, { status: 400 });
  }
  try {
    await changeShowing(supabaseAdmin(), String(body.id ?? ""),
      status as "confirmed" | "cancelled" | "shown" | "no_show",
      publicBase(req), { reason: body.reason, by: "office" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
