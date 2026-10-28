/**
 * Reading the place out of a Tenant Web Access subject line, and remembering
 * what it turned out to be.
 *
 * Rent Manager puts the place in the SUBJECT, and the two real examples look
 * nothing alike:
 *
 *   New Issue Submitted from TWA: 114 Lisas Way, 114 Lisas Way
 *   New Issue Submitted from TWA: 1140 Northside #51, 1140 Northside Rd, Lot #51
 *
 * The first is a single house, named twice -- Rent Manager's property and its
 * unit happen to be the same string. The second is a park, a lot number, and
 * the park's street address. Both have to come out as "which property, which
 * lot", and neither can be had by splitting on a comma and hoping.
 *
 * WHAT THIS DOES NOT DO is decide which property in our own records it is.
 * That is a question about what we hold, and the answer is either a match
 * somebody confirms or a property somebody adds -- see `place_aliases` in
 * migration 045. Once confirmed it is remembered, because the next request
 * from that address will carry exactly the same string.
 */

/** A lot number written any of the ways Rent Manager writes one. */
const LOT = /(?:^|\s)(?:lot\s*)?#\s*([A-Za-z]?\d+[A-Za-z]?)\b|(?:^|\s)lot\s+([A-Za-z]?\d+[A-Za-z]?)\b/i;

/** The place, as much of it as the subject says. */
export type Hint = {
  /** What Rent Manager calls the property. */
  property: string | null;
  /** The lot or unit, where the subject carries one. */
  lot: string | null;
  /** A street address, where one of the parts looks like one. */
  address: string | null;
  /** The whole thing, normalised — the key an alias is stored under. */
  key: string;
};

/**
 * One spelling of a place, for looking it up again.
 *
 * Case, punctuation and runs of space go; the words stay in order. The
 * REPEAT goes too: "114 Lisas Way, 114 Lisas Way" and "114 Lisas Way" are the
 * same house, and a tenant whose property and unit carry the same name must
 * not need two aliases to be recognised.
 */
export function placeKey(raw: string): string {
  const flat = (raw ?? "")
    .toLowerCase()
    .replace(/[#,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  // A part repeated verbatim says nothing the first one did not.
  const parts = flat.split(" ");
  const half = parts.length / 2;
  if (Number.isInteger(half)
      && parts.slice(0, half).join(" ") === parts.slice(half).join(" ")) {
    return parts.slice(0, half).join(" ");
  }
  return flat;
}

const looksLikeStreet = (s: string) =>
  /\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|way|ct|court|cir|circle|blvd|hwy|highway|trl|trail|pkwy)\b\.?$/i
    .test(s.trim());

/** Read a TWA subject's place into its parts. */
export function readHint(raw: string | null | undefined): Hint {
  const text = (raw ?? "").trim();
  if (!text) return { property: null, lot: null, address: null, key: "" };

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);

  /* The lot, from wherever it appears. Taken from the LAST part that carries
     one: "1140 Northside #51, 1140 Northside Rd, Lot #51" says it twice, and
     the trailing "Lot #51" is the one written to be read. */
  let lot: string | null = null;
  for (const p of parts) {
    const m = LOT.exec(p);
    if (m) lot = (m[1] ?? m[2] ?? "").trim() || lot;
  }

  /* The property is the first part with any lot marking taken off it.
     "1140 Northside #51" is the property "1140 Northside", lot 51. */
  const property = (parts[0] ?? "")
    .replace(/(?:^|\s)(?:lot\s*)?#\s*[A-Za-z]?\d+[A-Za-z]?\b/i, "")
    .replace(/(?:^|\s)lot\s+[A-Za-z]?\d+[A-Za-z]?\b/i, "")
    .replace(/\s+/g, " ")
    .trim() || null;

  /* An address, if one of the parts reads like a street. Not the first part
     by default: on a park that one is the park's name. */
  const address = parts.find((p, i) => i > 0 && looksLikeStreet(p))
    ?? (parts.length === 1 && looksLikeStreet(parts[0]!) ? parts[0]! : null)
    ?? (parts[1] && looksLikeStreet(parts[1]) ? parts[1] : null)
    ?? null;

  return { property, lot, address, key: placeKey(text) };
}
