/**
 * A lead delivered by Zillow's Lead API, straight to us.
 *
 * Zillow's notification EMAIL hides the renter behind a relay address and
 * gives no phone (see parseZillow in parse-email.ts). The Lead API -- an
 * HTTP POST to our endpoint the moment the lead is made -- carries the real
 * name, email and phone, and most of what the prequalify form asks besides:
 * income, credit range, move date, bedrooms, pets. So a lead that arrives
 * this way can be answered by text inside a minute, which an emailed one
 * cannot.
 *
 * Field names are Zillow's, from "ZILLOW RENTALS Lead Delivery API Guide",
 * 11 Dec 2024. The body is application/x-www-form-urlencoded. Fields Zillow
 * leaves out are simply absent, so every one is optional here.
 *
 * Nothing in this file talks to the database. It turns the form into the
 * Intake the rest of the pipeline already understands, plus the answers the
 * renter gave Zillow, so the same form can be tested without a server.
 */
import type { Intake } from "./intake";

export type ZillowAnswers = {
  incomeYearly: number | null;
  creditMin: number | null;
  creditMax: number | null;
  movingDate: string | null;       // YYYY-MM-DD
  moveInTimeframe: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  pets: string[];                  // "dog (Lab, 50 lb)"
  smoker: boolean | null;
  employment: string | null;
  leadType: "question" | "tourRequest" | "applicationRequest" | string | null;
};

export type ZillowLead = {
  intake: Intake;
  answers: ZillowAnswers;
  /** The listing as Zillow describes it, for finding the lot. */
  listing: { id: string | null; street: string | null; unit: string | null;
             city: string | null; state: string | null; zip: string | null };
};

const s = (f: URLSearchParams, k: string): string | null => {
  const v = f.get(k);
  return v === null ? null : v.trim() || null;
};

const n = (f: URLSearchParams, k: string): number | null => {
  const v = s(f, k);
  if (v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function json<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** 20261201 -> 2026-12-01; anything else is not a date. */
function ymd(v: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const TIMEFRAME: Record<string, string> = {
  asap: "as soon as possible", week: "within a week", twoWeeks: "within two weeks",
  month: "within a month", twoMonths: "within two months", flexible: "flexible",
};

const LEAD_TYPE: Record<string, string> = {
  question: "Zillow question", tourRequest: "Zillow tour request",
  applicationRequest: "Zillow application request",
};

/** 2026-12-01 -> "December 1, 2026": read by a person, and by readWanted,
 *  which knows month names and slashes but not ISO dates. */
const spoken = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US",
  { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

export function parseZillowLead(form: URLSearchParams, digest: string): ZillowLead {
  const listing = {
    id: s(form, "listingId"),
    street: s(form, "listingStreet"),
    unit: s(form, "listingUnit"),
    city: s(form, "listingCity"),
    state: s(form, "listingState"),
    zip: s(form, "listingPostalCode"),
  };

  const credit = json<{ creditScoreMin?: number; creditScoreMax?: number }>(s(form, "creditScoreRangeJson"));
  const petList = json<{ type?: string; breed?: string; weightPounds?: number }[]>(s(form, "petDetailsJson")) ?? [];
  const pets = petList.map((p) => {
    const bits = [p.breed, p.weightPounds ? `${p.weightPounds} lb` : null].filter(Boolean);
    return `${p.type ?? "pet"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  });
  const smokerRaw = s(form, "smoker");

  const answers: ZillowAnswers = {
    incomeYearly: n(form, "incomeYearly"),
    creditMin: typeof credit?.creditScoreMin === "number" ? credit.creditScoreMin : null,
    creditMax: typeof credit?.creditScoreMax === "number" ? credit.creditScoreMax : null,
    movingDate: ymd(s(form, "movingDate")),
    moveInTimeframe: s(form, "moveInTimeframe"),
    bedrooms: n(form, "numBedroomsSought"),
    bathrooms: n(form, "numBathroomsSought"),
    pets,
    smoker: smokerRaw === null ? null : smokerRaw === "true",
    employment: [s(form, "employmentStatus"), s(form, "jobTitle"), s(form, "employer")]
      .filter(Boolean).join(", ") || null,
    leadType: s(form, "leadType"),
  };

  const place = [listing.street, listing.unit && `Unit ${listing.unit}`, listing.city]
    .filter(Boolean).join(", ") || null;
  const message = s(form, "message") ?? s(form, "introduction");
  const kind = LEAD_TYPE[answers.leadType ?? ""] ?? "Zillow lead";

  /* Written as sentences, because the same text feeds the inquiry reader
     (readWanted), which picks bedrooms, a price and a move-in date out of
     prose -- and because a person opening the thread reads it. */
  const facts = [
    answers.bedrooms !== null && `Looking for ${answers.bedrooms === 0 ? "a studio" : `${answers.bedrooms} bedrooms`}.`,
    answers.movingDate && `Moving in ${spoken(answers.movingDate)}.`,
    !answers.movingDate && answers.moveInTimeframe
      && `Moving ${TIMEFRAME[answers.moveInTimeframe] ?? answers.moveInTimeframe}.`,
    answers.pets.length ? `Pets: ${answers.pets.join("; ")}.` : null,
    answers.incomeYearly !== null && `Told Zillow: income ${money(answers.incomeYearly)} a year`
      + ` (${money(answers.incomeYearly / 12)} a month).`,
    answers.creditMin !== null && `Told Zillow: credit score ${answers.creditMin}`
      + `${answers.creditMax !== null && answers.creditMax !== answers.creditMin ? `–${answers.creditMax}` : ""}.`,
    answers.employment && `Work: ${answers.employment}.`,
    answers.smoker === true && "Smoker.",
  ].filter(Boolean) as string[];

  const summary = [place && `${kind} — ${place}`, message].filter(Boolean).join(" · ")
    || kind;

  const raw = [
    `${kind}${place ? ` for ${place}` : ""}.`,
    message && `"${message}"`,
    facts.join(" "),
    "— Delivered by Zillow's lead API, with the renter's own phone and email.",
  ].filter(Boolean).join("\n\n");

  return {
    intake: {
      source: "zillow",
      name: s(form, "name"),
      phone: s(form, "phone"),
      email: s(form, "email"),
      unitHint: place,
      summary,
      raw,
      category: "prospect",
      /* Zillow sends no lead id. The same POST redelivered after a failure
         is byte-for-byte the same body, so its digest is the id: a retry is
         recognised as the lead already on file, not a second lead. */
      externalId: `zillow-api:${digest}`,
    },
    answers,
    listing,
  };
}
