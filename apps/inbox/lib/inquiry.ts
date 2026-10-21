import { readWanted, mergeWanted, type Reading, type Wanted } from "./wanted";
import type { supabaseAdmin } from "./supabase-admin";

/**
 * The inquiry record.
 *
 * `inquiries` and `nurture_touches` have been in the schema since the first
 * migration with not one line of code touching either. So every leasing
 * enquiry this business has ever taken landed as a thread and nothing else:
 * the three bedrooms under nine hundred existed as a sentence somebody would
 * have to read again, which means it could not be counted, matched against an
 * empty lot, or followed up when one came free.
 *
 * This is the row the rest of the pipeline hangs off. Nothing clever: one row
 * per person who is looking, what they said they wanted, and how it ended.
 */

type Db = ReturnType<typeof supabaseAdmin>;

export type OpenInquiry = {
  contactId: string;
  conversationId?: string | null;
  /** 'web form', 'sign call', 'zillow', 'referral' -- free text, as the column is. */
  source?: string | null;
  /** What they wrote. Read for stated preferences; never stored here, the
   *  message already holds it. */
  text?: string | null;
  /** Towns and parks worth matching. Nothing is invented off this list. */
  places?: string[];
  unitId?: string | null;
  today?: Date;
};

export type InquiryResult = {
  id: string;
  created: boolean;
  wanted: Wanted;
  declined: Reading["declined"];
};

/**
 * Open an inquiry, or bring an open one up to date.
 *
 * One open row per person, which the unique index in 037 also enforces: a
 * second call three days later is the same person still looking, and two open
 * rows means two follow-up schedules and two people ringing them back.
 *
 * The merge is the part with a bug in it waiting to happen. A caller who
 * rings back to change the date has not withdrawn the bedrooms they asked for
 * on Monday, so a later message that is silent about a field must leave that
 * field alone. Writing the new reading straight over the row would empty it,
 * quietly, and the record would get thinner every time they called.
 */
export async function openInquiry(db: Db, item: OpenInquiry): Promise<InquiryResult | null> {
  const reading = readWanted(item.text ?? "", { places: item.places, today: item.today });

  const { data: had } = await db
    .from("inquiries")
    .select("id, bedrooms_min, price_ceiling, area, has_pets, move_in_from, read, unit_id, conversation_id")
    .eq("contact_id", item.contactId)
    .eq("outcome", "open")
    .maybeSingle();

  const prior: Wanted & { read?: Reading["read"] } = had ? {
    bedroomsMin: had.bedrooms_min ?? undefined,
    priceCeiling: had.price_ceiling === null || had.price_ceiling === undefined
      ? undefined : Number(had.price_ceiling),
    area: had.area ?? undefined,
    // Written out rather than `?? undefined` so a stored false survives: a
    // caller who said they have no pets stated something, and turning that
    // back into "nobody asked" loses the only answer they gave.
    hasPets: had.has_pets === null || had.has_pets === undefined ? undefined : had.has_pets,
    moveInFrom: had.move_in_from ?? undefined,
    read: (had.read ?? {}) as Reading["read"],
  } : {};

  const { wanted, read } = mergeWanted(prior, reading);

  const columns = {
    bedrooms_min: wanted.bedroomsMin ?? null,
    price_ceiling: wanted.priceCeiling ?? null,
    area: wanted.area ?? null,
    has_pets: wanted.hasPets ?? null,
    move_in_from: wanted.moveInFrom ?? null,
    read,
  };

  if (had) {
    await db.from("inquiries").update({
      ...columns,
      // Never unset a link that is already there by sending a null over it.
      conversation_id: had.conversation_id ?? item.conversationId ?? null,
      unit_id: had.unit_id ?? item.unitId ?? null,
    }).eq("id", had.id);
    return { id: had.id, created: false, wanted, declined: reading.declined };
  }

  const { data, error } = await db.from("inquiries").insert({
    contact_id: item.contactId,
    conversation_id: item.conversationId ?? null,
    unit_id: item.unitId ?? null,
    source: item.source ?? null,
    ...columns,
  }).select("id").single();

  // A race on the one-open-per-contact index means somebody else just opened
  // it -- which is the right outcome, so take theirs rather than failing.
  if (error) {
    const { data: theirs } = await db.from("inquiries")
      .select("id").eq("contact_id", item.contactId).eq("outcome", "open").maybeSingle();
    if (!theirs) throw error;
    return { id: theirs.id, created: false, wanted, declined: reading.declined };
  }

  return { id: data!.id, created: true, wanted, declined: reading.declined };
}

/** The outcomes that mean stop contacting this person, ever. */
const PERMANENT = new Set(["bought_home", "relocated_away"]);

export type Outcome =
  | "leased_with_us" | "leased_elsewhere" | "wrong_location" | "price_mismatch"
  | "bought_home" | "relocated_away" | "did_not_qualify" | "unknown";

/**
 * Close an inquiry.
 *
 * The outcome is what keeps a follow-up away from somebody who bought a
 * house, so it is required and there is no default. 'unknown' is a real
 * answer and the safe one -- the schema's own comment says treat it as
 * leased_elsewhere -- but it has to be chosen rather than fallen into.
 */
export async function closeInquiry(
  db: Db, id: string, outcome: Outcome, note?: string | null,
) {
  const { error } = await db.from("inquiries").update({
    outcome,
    outcome_note: note?.trim() || null,
    outcome_at: new Date().toISOString(),
  }).eq("id", id).eq("outcome", "open");
  if (error) throw error;
  return { ok: true, suppressed: PERMANENT.has(outcome) };
}

/** The places worth matching an inquiry against: our parks and our markets. */
export async function knownPlaces(db: Db): Promise<string[]> {
  const [props, markets] = await Promise.all([
    db.from("properties").select("name"),
    db.from("markets").select("name").eq("active", true),
  ]);
  const names = [
    ...(props.data ?? []).map((p) => p.name as string),
    ...(markets.data ?? []).map((m) => m.name as string),
  ].filter(Boolean);
  // Longest first, so "Elizabeth City" is matched before "Elizabeth" would be
  // if both were ever on the list.
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}
