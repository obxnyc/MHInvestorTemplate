/**
 * What a caller said they wanted.
 *
 * Every leasing inquiry since the first schema has landed as a thread and
 * nothing else, so "three bedrooms under nine hundred, Fayetteville, moving
 * in June" existed only as a sentence somebody would have to read again. This
 * turns that sentence into the five columns `inquiries` has been waiting for.
 *
 * Two rules decide the whole shape of this file.
 *
 * STATED ONLY, AND ONLY THESE FIVE. The schema's own comment is the law here:
 * segment on stated preferences and nothing else, never on anything inferred,
 * and never on anything standing in for family status, national origin or
 * disability. So "I have three kids" is not three bedrooms, and a service
 * animal is not a pet -- it is a disability disclosure, and the right amount
 * of it to store is none.
 *
 * AND IT REPORTS WHAT IT READ. Every field comes back with the words it came
 * out of, because this is a guess and the screen can show its working. A
 * guess that says where it came from is corrected in one press. A silent one
 * is never corrected at all -- the same reason `pick` in rm-issues.ts hands
 * back which spelling answered.
 */

export type Wanted = {
  bedroomsMin?: number;
  priceCeiling?: number;
  area?: string;
  hasPets?: boolean;
  moveInFrom?: string;            // ISO date, yyyy-mm-dd
};

/** The words a field was read out of, and where in the text they were. */
export type Read = Record<keyof Wanted, { from: string; at: number } | undefined>;

export type Reading = {
  wanted: Wanted;
  read: Partial<Read>;
  /** Fields deliberately left unset, and why. Shown on screen so nobody
   *  helpfully types in the thing we are declining to keep. */
  declined: { field: string; because: string }[];
};

/* ------------------------------------------------------------------ bedrooms
 *
 * A number of bedrooms is said two ways -- "3 bedroom" and "3/2" -- and a
 * number of PEOPLE is said a dozen ways that look identical to a regex. The
 * list of things a number can be counting is the whole guard here: reading
 * "3 kids" as three bedrooms would put a family-status fact in a column we
 * segment on, which is the one thing this file must never do.
 */
const HOUSEHOLD =
  /\b(kids?|child(ren)?|babies|baby|son|daughter|people|persons?|adults?|of us|family|grand(son|daughter|kids?|children))\b/i;

const BEDS = /(\d{1,2})\s*(?:-|\s)?\s*(?:bed\s?rooms?|bedrms?|bdrms?|beds?|bd|br)\b/i;
const BED_BATH = /\b(\d{1,2})\s*\/\s*(\d{1,2}(?:\.\d)?)\b/;

function bedrooms(text: string): { n: number; from: string; at: number } | null {
  const m = BEDS.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 6) return { n, from: m[0].trim(), at: m.index };
  }
  // "3/2" is three bedrooms and two bathrooms, and nothing else is written
  // that way in a housing inquiry -- except a date, and "moving 3/1" is the
  // first of March.
  //
  // The bathroom bound used to carry a second test for that, asking whether
  // the right-hand number was too big to be a bathroom. It was the same
  // question twice: anything over four fails the bound anyway, so the extra
  // test could be deleted without a check noticing. Dead logic shaped like a
  // guard is worse than no guard, because the next person trusts it. What
  // actually separates the two is the word in front: a date is being moved
  // in on, a bed count is not.
  const b = BED_BATH.exec(text);
  if (b) {
    const n = Number(b[1]), bath = Number(b[2]);
    const before = text.slice(Math.max(0, b.index - 24), b.index);
    const aDateIsComing = /\b(mov(e|ing)|move[- ]?in|available|starting|by|from|on|around|after)\s*$/i.test(before);
    if (!aDateIsComing && n >= 1 && n <= 6 && bath >= 1 && bath <= 4) {
      return { n, from: b[0].trim(), at: b.index };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ the money
 *
 * "Under $900" is a ceiling. "$900 deposit" is a fact about our own terms,
 * "$2,400 a month" said of their wages is their income, and either one
 * written into price_ceiling sends them listings they cannot afford or hides
 * the ones they can. So a bare figure counts only when nothing beside it says
 * it is something else.
 */
const CEILING =
  /\b(?:under|below|up to|at most|max(?:imum)?|no more than|less than|budget(?:\s+(?:of|is|around))?|around|about|roughly|range of)\s*\$?\s*([\d][\d,]{1,6})\b/i;
const MONTHLY = /\$\s*([\d][\d,]{1,6})\s*(?:\/|\s*(?:a|per)\s*)(?:mo|month)\b/i;
const BARE = /\$\s*([\d][\d,]{1,6})\b/;
const NOT_A_CEILING =
  /\b(deposit|income|i (?:make|earn|bring|gross|net)|we (?:make|earn|bring)|paid|salary|wages?|an hour|hourly|a week|weekly|bi[- ]?weekly|credit|score|fee|rent is)\b/i;

const money = (s: string) => Number(s.replace(/,/g, ""));

/** The sentence a figure is sitting in.
 *
 *  The sentence and not the message, because "Is there a deposit? My budget
 *  is $850" states a budget and mentions a deposit, and reading the whole
 *  message would throw the budget away. Split on `?` and `!` as well as `.`
 *  -- the deposit in that example is a question, and a question mark is the
 *  only thing separating it from the answer we want.
 */
function sentenceAround(text: string, at: number): string {
  const starts = Math.max(
    text.lastIndexOf(".", at), text.lastIndexOf("?", at), text.lastIndexOf("!", at),
  );
  const ends = [text.indexOf(".", at), text.indexOf("?", at), text.indexOf("!", at)]
    .filter((i) => i >= 0);
  return text.slice(starts + 1, ends.length ? Math.min(...ends) : text.length);
}

/** A rate follows its figure rather than preceding it: "$18 an hour". */
const A_RATE = /^\s*(?:\/\s*)?(?:an? hour|hourly|hr\b|a week|weekly|wk\b|bi[- ]?weekly|a year|annually|yr\b)/i;

function ceiling(text: string): { n: number; from: string; at: number } | null {
  // Every candidate goes through the same two refusals, including the ones
  // carrying an explicit ceiling phrase. "I make around $2,400 a month" has
  // the word "around" in it and is not a budget, and the first version of
  // this read it as one because only the bare-figure branch was checked.
  const take = (m: RegExpExecArray | null) => {
    if (!m) return null;
    const n = money(m[1]);
    if (n < 100 || n > 100_000) return null;
    const sentence = sentenceAround(text, m.index);
    if (NOT_A_CEILING.test(sentence)) return null;
    const after = text.slice(m.index + m[0].length);
    if (A_RATE.test(after)) return null;
    return { n, from: m[0].trim(), at: m.index };
  };

  return take(CEILING.exec(text))
      ?? take(MONTHLY.exec(text))
      ?? take(BARE.exec(text));
}

/* ------------------------------------------------------------------ animals
 *
 * A service or assistance animal is not a pet in law and is not a preference
 * in fact -- it is a disability disclosure. We refuse the field rather than
 * fill it in, and we SAY we refused it, so that the blank does not read as
 * something nobody got round to typing.
 */
const ASSISTANCE =
  /\b(service (?:dog|animal)|emotional support (?:animal|dog|cat)|esa\b|assistance (?:dog|animal)|guide dog|therapy (?:dog|animal))\b/i;
const NO_PETS = /\b(no pets?|don'?t have (?:any )?pets?|do not have (?:any )?pets?|without (?:any )?pets?|pet[- ]?free)\b/i;
const HAS_PETS =
  /\b(?:i|we)\s+(?:have|'?ve got|got|own)\s+(?:a |an |two |three |\d+ )?(?:pets?|dogs?|cats?|puppy|puppies|kitten|kittens)\b|\b(?:my|our)\s+(?:pets?|dogs?|cats?|puppy|kitten)\b|\b(?:one|two|three|\d+)\s+(?:small |large |little |big )?(?:dogs?|cats?|pets?)\b/i;

function pets(text: string): { yes: boolean; from: string; at: number } | null {
  const no = NO_PETS.exec(text);
  if (no) return { yes: false, from: no[0].trim(), at: no.index };
  const yes = HAS_PETS.exec(text);
  if (yes) return { yes: true, from: yes[0].trim(), at: yes.index };
  return null;
}

/* ------------------------------------------------------------------ the date
 *
 * `today` is a parameter and never `new Date()`, because a parser that reads
 * the clock cannot be checked. "ASAP" means today, and "the first" means the
 * next first that has not already gone.
 */
const MONTHS = ["january","february","march","april","may","june","july",
                "august","september","october","november","december"];

const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function moveIn(text: string, today: Date): { on: string; from: string; at: number } | null {
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const soon = /\b(asap|as soon as possible|immediately|right away|right now|today|tomorrow|this week)\b/i.exec(text);
  if (soon) {
    const d = new Date(now);
    if (/tomorrow/i.test(soon[0])) d.setUTCDate(d.getUTCDate() + 1);
    return { on: iso(d), from: soon[0].trim(), at: soon.index };
  }

  const named = new RegExp(
    `\\b(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\.?\\s*(\\d{1,2})?(?:st|nd|rd|th)?\\b`, "i",
  ).exec(text);
  if (named) {
    const month = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase().slice(0, 3)));
    const day = named[2] ? Number(named[2]) : 1;
    if (day >= 1 && day <= 31) {
      // A month already gone is next year's: somebody writing "March" in
      // October means the March that is coming.
      let year = now.getUTCFullYear();
      let d = new Date(Date.UTC(year, month, day));
      if (d < now) { year += 1; d = new Date(Date.UTC(year, month, day)); }
      return { on: iso(d), from: named[0].trim(), at: named.index };
    }
  }

  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (slash) {
    const month = Number(slash[1]), day = Number(slash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = slash[3]
        ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
        : now.getUTCFullYear();
      let d = new Date(Date.UTC(year, month - 1, day));
      if (!slash[3] && d < now) d = new Date(Date.UTC(++year, month - 1, day));
      return { on: iso(d), from: slash[0].trim(), at: slash.index };
    }
  }

  const next = /\b(next month|first of (?:the |next )?month|the first|end of (?:the )?month|beginning of (?:the )?month)\b/i.exec(text);
  if (next) {
    const endOf = /end of/i.test(next[0]);
    const d = endOf
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { on: iso(endOf && d < now ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)) : d),
             from: next[0].trim(), at: next.index };
  }
  return null;
}

/* ------------------------------------------------------------------ the place
 *
 * Only ever a name off a list we were handed -- the parks and towns we
 * actually let in. Inventing a place out of the text is how "I'm in
 * Fayetteville now, looking to get to Raeford" becomes Fayetteville.
 */
function area(text: string, places: string[]): { name: string; from: string; at: number } | null {
  const hay = text.toLowerCase();
  const hits = places
    .map((p) => ({ name: p, at: hay.indexOf(p.toLowerCase()) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (hits.length !== 1) return null;     // two places named is a sentence, not a preference
  return { name: hits[0].name, from: text.slice(hits[0].at, hits[0].at + hits[0].name.length), at: hits[0].at };
}

/**
 * Read an inquiry.
 *
 * `places` is the list of towns and parks worth matching -- pass the ones we
 * let in. `today` anchors every relative date and is never read off the clock.
 */
export function readWanted(
  text: string,
  opts: { places?: string[]; today?: Date } = {},
): Reading {
  const body = (text ?? "").replace(/\s+/g, " ").trim();
  const wanted: Wanted = {};
  const read: Partial<Read> = {};
  const declined: { field: string; because: string }[] = [];

  if (!body) return { wanted, read, declined };

  // A sentence about the household is a sentence about a protected class, and
  // the numbers in it are not bedrooms. The whole message is held back rather
  // than the sentence, because "me and my 3 kids need a 3 bedroom" reads the
  // same number twice and there is no way to tell which one the regex found.
  // The note is written whenever the message describes the household, whether
  // or not a bedroom count was found in it. Not for completeness: the hazard
  // is a person reading the thread and helpfully typing the 3 from "3 kids"
  // into the bedrooms box, and the blank is what invites them to. Saying "we
  // do not record that" is the whole point of saying anything.
  const bed = bedrooms(body);
  const household = HOUSEHOLD.test(body);
  if (household) {
    declined.push({
      field: "bedrooms_min",
      because: "the message describes the household, and a number of people is not a number of bedrooms",
    });
  }
  if (bed && household) {
    /* held back on purpose; the note above says why */
  } else if (bed) {
    wanted.bedroomsMin = bed.n;
    read.bedroomsMin = { from: bed.from, at: bed.at };
  }

  const cap = ceiling(body);
  if (cap) { wanted.priceCeiling = cap.n; read.priceCeiling = { from: cap.from, at: cap.at }; }

  if (ASSISTANCE.test(body)) {
    declined.push({
      field: "has_pets",
      because: "an assistance animal is not a pet, and whether somebody has one is not ours to keep",
    });
  } else {
    const p = pets(body);
    if (p) { wanted.hasPets = p.yes; read.hasPets = { from: p.from, at: p.at }; }
  }

  const when = moveIn(body, opts.today ?? new Date());
  if (when) { wanted.moveInFrom = when.on; read.moveInFrom = { from: when.from, at: when.at }; }

  const where = area(body, opts.places ?? []);
  if (where) { wanted.area = where.name; read.area = { from: where.from, at: where.at }; }

  return { wanted, read, declined };
}

/**
 * Merge a second reading into what is already on file.
 *
 * A caller who rings back about the move-in date has not withdrawn the three
 * bedrooms they asked for the first time. So nothing already stated is ever
 * cleared by a later message that is silent about it -- the bug being avoided
 * is the one where the second call empties the record.
 */
export function mergeWanted(
  had: Wanted & { read?: Partial<Read> },
  now: Reading,
): { wanted: Wanted; read: Partial<Read> } {
  const wanted: Wanted = { ...had };
  const read: Partial<Read> = { ...(had.read ?? {}) };
  delete (wanted as { read?: unknown }).read;

  for (const k of ["bedroomsMin", "priceCeiling", "area", "hasPets", "moveInFrom"] as const) {
    const v = now.wanted[k];
    if (v === undefined || v === null) continue;
    (wanted as Record<string, unknown>)[k] = v;
    read[k] = now.read[k];
  }
  return { wanted, read };
}
