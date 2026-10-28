import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { places, findPlace } from "@/lib/places";
import { placeKey, readHint } from "@/lib/alias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saying which property a request came from, once.
 *
 * A Tenant Web Access request carries the tenant, their number and the place
 * as Rent Manager names it -- "114 Lisas Way, 114 Lisas Way" -- and nothing
 * here has ever matched that to a property we hold. So the request lands
 * knowing exactly who and where, and filed against nothing.
 *
 * Matching the text on every arrival would be a guess repeated, and a guess
 * that lands on the wrong home is worse than one that lands on none. So
 * somebody answers it ONCE, here, and migration 045 remembers -- the next
 * request from that address files itself.
 */

/** What this place might be, out of what we already hold. */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const hint = (new URL(req.url).searchParams.get("hint") ?? "").trim();
  if (!hint) return NextResponse.json({ suggestions: [], said: null });

  const db = await supabaseServer();
  const [{ data: props }, { data: units }] = await Promise.all([
    db.from("properties").select("id, name, address, kind"),
    db.from("units").select("id, property_id, label"),
  ]);

  const said = readHint(hint);
  const all = places((props ?? []) as never, (units ?? []) as never);
  /* Asked with the property name rather than the whole subject: the subject
     repeats itself and carries a lot marking, and every word has to land for
     a place to be offered at all. "1140 Northside #51, 1140 Northside Rd" as
     one query matches nothing. */
  const ask = [said.property, said.lot && `Lot ${said.lot}`]
    .filter(Boolean).join(" ") || hint;

  return NextResponse.json({
    said,
    suggestions: findPlace(ask, all, 6).map((p) => ({
      id: p.id, kind: p.kind, label: p.label, where: p.where,
      propertyId: p.propertyId, unitId: p.unitId,
    })),
  });
}

/**
 * Either "it is this one" or "it is a new one".
 *
 * NOTHING IS CREATED WITHOUT BEING ASKED FOR. A typo in a Rent Manager
 * property name would otherwise become a property in our records, and a
 * records list with four spellings of one address in it is worse than one
 * with a gap.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    conversationId?: string; unitId?: string; propertyId?: string;
    create?: { name?: string; address?: string; kind?: string; lot?: string };
  };
  const conversationId = String(body.conversationId ?? "");
  if (!conversationId) {
    return NextResponse.json({ error: "which request?" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: convo } = await db.from("conversations")
    .select("id, place_hint, contact_id").eq("id", conversationId).maybeSingle();
  if (!convo) return NextResponse.json({ error: "no such request" }, { status: 404 });

  const hint = String(convo.place_hint ?? "").trim();
  if (!hint) {
    return NextResponse.json({
      error: "This request did not say what the place was called, so there is"
        + " nothing to remember. Set the property on the job instead.",
    }, { status: 400 });
  }

  let propertyId = body.propertyId ?? null;
  let unitId = body.unitId ?? null;

  if (body.create) {
    const name = String(body.create.name ?? "").trim();
    if (name.length < 3) {
      return NextResponse.json({ error: "Give the property a name." }, { status: 400 });
    }
    const kind = String(body.create.kind ?? "sfh");
    const { data: made, error } = await db.from("properties").insert({
      name,
      address: String(body.create.address ?? "").trim() || null,
      kind,
    }).select("id").single();
    if (error || !made) {
      return NextResponse.json(
        { error: error?.message ?? "Could not add the property." }, { status: 400 });
    }
    propertyId = made.id as string;

    /* A HOUSE STILL GETS A UNIT ROW. Everything downstream -- the work order,
       the lease, the vacancy clock -- hangs off a unit, and a property with
       none is a property nothing can be filed against. The house is its own
       unit; a park lot is the lot. */
    const label = String(body.create.lot ?? "").trim() || name;
    const { data: unit } = await db.from("units")
      .insert({ property_id: propertyId, label }).select("id").single();
    unitId = unit?.id as string ?? null;
  }

  if (!propertyId && !unitId) {
    return NextResponse.json({ error: "pick one, or add it" }, { status: 400 });
  }
  if (!propertyId && unitId) {
    const { data: u } = await db.from("units")
      .select("property_id").eq("id", unitId).maybeSingle();
    propertyId = (u?.property_id as string) ?? null;
  }

  /* Remembered first, because that is the part that stops this happening
     again. Upserted: two people answering the same request in the same
     minute must not be an error, and the answer is the same either way. */
  const { error: aliasError } = await db.from("place_aliases").upsert({
    key: placeKey(hint), saw: hint.slice(0, 200),
    property_id: propertyId, unit_id: unitId, by_staff: me.id,
  }, { onConflict: "key" });
  if (aliasError) {
    return NextResponse.json({
      error: aliasError.message.includes("place_aliases")
        ? "Run migration 045 so this can be remembered."
        : aliasError.message,
    }, { status: 500 });
  }

  // The thread, the contact and any job already opened for it.
  await db.from("conversations").update({ unit_id: unitId }).eq("id", conversationId);
  if (convo.contact_id && unitId) {
    await db.from("contacts").update({ unit_id: unitId }).eq("id", convo.contact_id);
  }
  await db.from("work_orders")
    .update({ unit_id: unitId }).eq("conversation_id", conversationId).is("unit_id", null);

  return NextResponse.json({ ok: true, propertyId, unitId });
}
