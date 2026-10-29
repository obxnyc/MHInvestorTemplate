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
  /** Preferences the source stated as form answers.
   *
   *  A form answer is evidence of a different order to a phrase found in a
   *  sentence, so it is merged LAST and wins. Zillow asks the renter for the
   *  move-in date, the bedrooms and the pets and sends the answers; the
   *  message body beside them is "I would like to schedule a tour".
   *
   *  It is not merely that the prose says less. Read as prose, the
   *  notification's own layout -- the income figure sitting on the line above
   *  the pets answer -- matched the pet rule on the words "75000 Pets" and
   *  recorded hasPets TRUE on a renter who had answered No. A wrong stated
   *  answer is worse than a blank, because it is the one that gets planned
   *  around. */
  stated?: Reading | null;
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
/** The open inquiry already on file, as this function reads it. `declined`
 *  is optional because it arrives with 049. */
type PriorRow = {
  id: string;
  bedrooms_min: number | null;
  price_ceiling: number | string | null;
  area: string | null;
  has_pets: boolean | null;
  move_in_from: string | null;
  read: unknown;
  unit_id: string | null;
  conversation_id: string | null;
  declined?: unknown;
};

/** The refusals on file, plus any new ones, with the duplicates dropped.
 *  Keyed on the sentence as well as the field: two different reasons for
 *  leaving the same box empty are both worth saying, and the same reason
 *  twice is not. */
export function keepDeclines(
  had: { field: string; because: string }[],
  now: { field: string; because: string }[],
): { field: string; because: string }[] {
  const out = [...(Array.isArray(had) ? had : [])];
  for (const d of now) {
    if (!out.some((o) => o.field === d.field && o.because === d.because)) out.push(d);
  }
  return out;
}

export async function openInquiry(db: Db, item: OpenInquiry): Promise<InquiryResult | null> {
  const prose = readWanted(item.text ?? "", { places: item.places, today: item.today });

  /* The form answers go on top of the prose reading, so a stated answer beats
     a phrase found in the message -- and the refusals from both are kept, so
     the screen can still say why a field is blank. */
  const reading: Reading = item.stated
    ? {
        ...mergeWanted({ ...prose.wanted, read: prose.read }, item.stated),
        declined: [...prose.declined, ...item.stated.declined],
      }
    : prose;

  /* `declined` arrives with 049. Asked for and then fallen back on, rather
     than assumed: a select naming a column that is not there fails the whole
     query, and an inquiry that could not be read is a second open row for
     somebody who already has one. */
  //
  // Two tiers, branched on the ERROR and not on an empty result: a select
  // naming a column that is not there fails the whole query rather than
  // returning a row without it, and most calls here legitimately find
  // nothing. Branching on "no row" would re-query every genuinely new
  // contact and still never notice the real failure.
  //
  // Each tier is one string literal rather than a concatenation, because the
  // client infers the row type from the select text.
  let had: PriorRow | null = null;
  {
    const withDeclines = await db
      .from("inquiries")
      .select("id, bedrooms_min, price_ceiling, area, has_pets, move_in_from, read, unit_id, conversation_id, declined")
      .eq("contact_id", item.contactId)
      .eq("outcome", "open")
      .maybeSingle();
    if (!withDeclines.error) {
      had = (withDeclines.data as PriorRow | null) ?? null;
    } else {
      const plain = await db
        .from("inquiries")
        .select("id, bedrooms_min, price_ceiling, area, has_pets, move_in_from, read, unit_id, conversation_id")
        .eq("contact_id", item.contactId)
        .eq("outcome", "open")
        .maybeSingle();
      had = (plain.data as PriorRow | null) ?? null;
    }
  }

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
    /* What we would not record and why, so the card can say it where the
       empty box is. A blank Beds box beside "5 occupants" in the thread is
       what invites somebody to type 5 into it.

       UNIONED WITH WHAT IS ALREADY THERE, never written over it. A Zillow
       lead's second message is a plain line of prose with no "About <renter>"
       block in it, so it produces no refusals at all -- and writing that over
       the row would take the explanation off the card and leave the empty
       Beds box sitting under "Number of Occupants 5" in the thread with
       nothing to say why. The same rule as every other field here: a later
       message that is silent about something must leave it alone. */
    declined: keepDeclines(
      (had?.declined ?? []) as { field: string; because: string }[],
      reading.declined,
    ),
  };

  /* `declined` arrives with 049, and a deployment is live for however long it
     takes somebody to open the SQL editor. A write naming a column that is
     not there fails the whole statement, so the refusals are dropped and the
     lead is still recorded rather than the other way round.

     The same two-tier shape as the leasing screen's select. It is the order
     that matters: the gap is a sentence missing from a card, where the
     alternative is a lead that vanished because of a bookkeeping column. */
  const withoutDeclined = () => {
    const { declined: _dropped, ...rest } = columns;
    return rest;
  };
  const missingColumn = (e: { message?: string } | null) =>
    !!e?.message && /declined/i.test(e.message);

  if (had) {
    const link = {
      // Never unset a link that is already there by sending a null over it.
      conversation_id: had.conversation_id ?? item.conversationId ?? null,
      unit_id: had.unit_id ?? item.unitId ?? null,
    };
    const { error: upError } = await db.from("inquiries")
      .update({ ...columns, ...link }).eq("id", had.id);
    if (upError) {
      if (!missingColumn(upError)) throw upError;
      console.warn("inquiry stored without its refusals: run migration 049");
      const { error: retry } = await db.from("inquiries")
        .update({ ...withoutDeclined(), ...link }).eq("id", had.id);
      if (retry) throw retry;
    }
    return { id: had.id, created: false, wanted, declined: reading.declined };
  }

  const identity = {
    contact_id: item.contactId,
    conversation_id: item.conversationId ?? null,
    unit_id: item.unitId ?? null,
    source: item.source ?? null,
  };
  let { data, error } = await db.from("inquiries")
    .insert({ ...identity, ...columns }).select("id").single();
  if (error && missingColumn(error)) {
    console.warn("inquiry opened without its refusals: run migration 049");
    ({ data, error } = await db.from("inquiries")
      .insert({ ...identity, ...withoutDeclined() }).select("id").single());
  }

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

/**
 * We have answered them.
 *
 * The ONE stage move this application makes on its own, and it makes it
 * because a reply is a row we just wrote rather than a thing inferred from
 * the absence of something else. Everything past this -- a showing happened,
 * an application came in -- is somebody saying so, because the app cannot
 * know.
 *
 * ONLY FROM 'new'. A lead whose application is in does not go back to
 * "replied" because the office sent them a note about the gate code, and the
 * stage is what decides who gets rung this afternoon.
 *
 * A lead with NO stage is left alone too. Null means the inquiry predates the
 * column and nobody has said where it got to; answering a question somebody
 * never asked is not the same as answering this one, and quietly writing
 * 'replied' over it would destroy the only honest thing the row says.
 *
 * Never throws into the reply path. The message has gone out; a stage that
 * did not move is a board somebody corrects in one press, where a reply that
 * failed because of a bookkeeping column is a reply that did not happen.
 */
export async function markReplied(db: Db, conversationId: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("inquiries")
      .update({ stage: "replied", stage_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("outcome", "open")
      .eq("stage", "new")
      .select("id");
    // The column arrives with 049. Before that this is a no-op and says so in
    // the log rather than looking like a lead that was already answered.
    if (error) {
      console.warn("inquiry stage not advanced", { conversationId, why: error.message });
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.warn("inquiry stage not advanced", { conversationId, e });
    return false;
  }
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
