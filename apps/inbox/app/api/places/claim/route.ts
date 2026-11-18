import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { places, findPlace } from "@/lib/places";
import { placeKey, readHint } from "@/lib/alias";
import { kindOf } from "@/lib/property";

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

  const url = new URL(req.url);
  const hint = (url.searchParams.get("hint") ?? "").trim();
  /* What somebody has typed into the box, when there was no hint to go
     on. A request from Rent Manager names no place at all, and offering
     only "add this property" to a house that is already on the books is
     how a second copy of it gets made. */
  const typed = (url.searchParams.get("q") ?? "").trim();

  const db = await supabaseServer();
  const [{ data: props }, { data: units }] = await Promise.all([
    db.from("properties").select("id, name, address, kind"),
    db.from("units").select("id, property_id, label"),
  ]);

  const pick = (list: ReturnType<typeof places>) => list.map((p) => ({
    id: p.id, kind: p.kind, label: p.label, where: p.where,
    propertyId: p.propertyId, unitId: p.unitId,
  }));

  const said = readHint(hint);
  const all = places((props ?? []) as never, (units ?? []) as never);

  /* NOTHING TO MATCH ON.
   *
   * This used to answer with `all.slice(0, 40)` -- forty fat cards, and
   * because lots sort before properties they were forty lots of ONE park.
   * "Why is it showing me all these properties up, that is a terrible user
   * interface." It was: overwhelming and unrepresentative at once.
   *
   * TYPING IS THE PATH. "Most people probably won't be pointing and
   * clicking, they will type in info." So nothing is listed until
   * something is typed, and what is offered instead is a way IN: the kinds
   * of place there are, with their counts, so somebody who does want to
   * point and click goes park -> lot instead of scrolling four hundred
   * rows.
   *
   * Three states, and the narrowest one that applies wins:
   *   typed       search everything, a few results
   *   property=   the lots inside that park
   *   group=      the properties of that kind
   *   (nothing)   the kinds, counted
   */
  if (!hint) {
    if (typed) {
      return NextResponse.json({
        said: null, browsing: true, total: all.length,
        suggestions: pick(findPlace(typed, all, 10)),
      });
    }

    const within = String(url.searchParams.get("property") ?? "").trim();
    if (within) {
      return NextResponse.json({
        said: null, browsing: true, within,
        suggestions: pick(all.filter((p) => p.propertyId === within && p.unitId)),
      });
    }

    /* How many lots each property has, so a single home can be filed with
       one press rather than opened to reveal itself. */
    const lots = new Map<string, number>();
    for (const u of units ?? []) {
      lots.set(u.property_id, (lots.get(u.property_id) ?? 0) + 1);
    }

    const group = String(url.searchParams.get("group") ?? "").trim();
    if (group) {
      const mine = (props ?? []).filter((p) => (p.kind ?? "sfh") === group);
      return NextResponse.json({
        said: null, browsing: true, group,
        suggestions: mine
          .map((p) => {
            const n = lots.get(p.id) ?? 0;
            const only = n === 1
              ? (units ?? []).find((u) => u.property_id === p.id) : null;
            return {
              id: `p:${p.id}`,
              kind: "property",
              label: p.name,
              where: p.address ?? "",
              propertyId: p.id,
              /* One unit means the property IS the place, so picking it
                 files against the unit and the work order has an address.
                 More than one and it opens instead. */
              unitId: only?.id ?? null,
              opens: n > 1 ? n : 0,
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label)),
      });
    }

    /* THE KINDS THAT ARE ACTUALLY ON THE BOOKS, read off the properties
       and labelled from `property.ts`. Not a list written here: this
       codebase has already shipped a table naming two kinds that did not
       exist and missing three that did. */
    const counted = new Map<string, number>();
    for (const p of props ?? []) {
      const k = p.kind ?? "sfh";
      counted.set(k, (counted.get(k) ?? 0) + 1);
    }

    return NextResponse.json({
      said: null,
      browsing: true,
      total: all.length,
      kinds: [...counted.entries()]
        .map(([kind, n]) => ({ kind, label: kindOf(kind).label, properties: n }))
        .sort((a, b) => b.properties - a.properties),
      suggestions: [],
    });
  }

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

  /* A HINT IS WHAT MAKES THE NEXT ONE FILE ITSELF, not what makes this
     one possible. A request from Rent Manager carries no place at all --
     no subject line, no address, nothing -- and refusing to file it left
     the office with a thread naming a broken fridge in a house nobody
     could identify, and no way to say which house it was. So filing
     always works; remembering is the part that needs words to remember. */
  const hint = String(convo.place_hint ?? "").trim();

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
     minute must not be an error, and the answer is the same either way.
     *
     * BUT NOT UNDER AN EMPTY KEY, and one of those is already on this
     * database -- written 2 November, keyed on "", pointing at a house.
     *
     * `placeKey("")` is `""`. A thread with no place_hint is the COMMON
     * case, not the edge: every request the Rent Manager pull files
     * carries no place at all, and so does an outbound text to a plumber.
     * Filing one of those used to write the alias "a request that said
     * nothing about where it is means THIS house", and the next answer
     * overwrote it with a different house.
     *
     * Nothing reads it today, because every lookup happens to be guarded
     * by a truthy hint. That is luck, not a rule -- one unguarded call and
     * three hundred unplaced requests file themselves against whichever
     * house was answered last. A hint is what makes the NEXT one file
     * itself; with no words there is nothing to remember, and filing this
     * one still works. */
  const key = placeKey(hint);
  if (key) {
    const { error: aliasError } = await db.from("place_aliases").upsert({
      key, saw: hint.slice(0, 200),
      property_id: propertyId, unit_id: unitId, by_staff: me.id,
    }, { onConflict: "key" });
    if (aliasError) {
      return NextResponse.json({
        error: aliasError.message.includes("place_aliases")
          ? "Run migration 045 so this can be remembered."
          : aliasError.message,
      }, { status: 500 });
    }
  }

  // The thread, and any job already opened for it.
  await db.from("conversations").update({ unit_id: unitId }).eq("id", conversationId);

  /* THE PERSON IS NOT THE PLACE.
   *
   * This used to write the chosen unit onto whoever the thread names, with
   * no test of who that is. The owner texted his PLUMBER about a leak at
   * 128 Sunflower Ln and answering "which property" would have recorded
   * the plumber as living there -- and he works at every house on the
   * books, so the next thing to read his record reads it wrong.
   *
   * `intake.ts` already refuses this in so many words: "a tenant reports a
   * leak at their neighbour's as readily as their own, and writing an
   * address onto a person from one request is how somebody's record
   * quietly becomes wrong." The rule was written down and this route did
   * it anyway.
   *
   * So: only a tenant, and only one who has no home on file yet. Fill a
   * blank, never an answer. */
  if (convo.contact_id && unitId) {
    await db.from("contacts").update({ unit_id: unitId })
      .eq("id", convo.contact_id)
      .eq("party", "current_tenant")
      .is("unit_id", null);
  }

  /* AND WHO LIVES THERE, WHICH IS THE WHOLE POINT OF ANSWERING THIS.
   *
   * A Rent Manager request arrives attached to a placeholder contact --
   * no name, no number, a `rm:issue:` string in the phone column
   * because the column will not take a null. Somebody then picks the
   * property, and until now that is all that happened: the thread knew
   * the address and still said "Nobody is attached to this request, so
   * there is nowhere to send a reply", with the tenant's name sitting
   * in the lease roster one join away.
   *
   * So the thread is pointed at the person who lives there.
   *
   * THE TWO REFUSALS MATTER MORE THAN THE MATCH.
   *
   * Only when the thread names NOBODY. A named contact was put there by
   * the email path or by a person, and a tenant reports a leak at their
   * neighbour's as readily as their own -- overwriting that is how
   * somebody's record quietly becomes wrong. Fill a blank, never an
   * answer.
   *
   * And only when the unit has exactly ONE tenant on it. Two names
   * against one address is a question, and picking either is a reply
   * sent to the wrong person about their own home.
   */
  let person: string | null = null;
  if (unitId && convo.contact_id) {
    const { data: here } = await db.from("contacts")
      .select("id, full_name, phone")
      .eq("id", convo.contact_id).maybeSingle();
    const anonymous = here
      && !here.full_name
      && (!here.phone || String(here.phone).startsWith("rm:")
          || String(here.phone).startsWith("email:"));

    if (anonymous) {
      const { data: living } = await db.from("contacts")
        .select("id, full_name")
        .eq("unit_id", unitId)
        .eq("party", "current_tenant")
        .not("full_name", "is", null)
        .neq("id", convo.contact_id)
        .limit(2);
      if (living?.length === 1) {
        await db.from("conversations")
          .update({ contact_id: living[0]!.id }).eq("id", conversationId);
        person = living[0]!.full_name as string;
      }
    }
  }
  await db.from("work_orders")
    .update({ unit_id: unitId }).eq("conversation_id", conversationId).is("unit_id", null);

  return NextResponse.json({ ok: true, propertyId, unitId, person });
}
