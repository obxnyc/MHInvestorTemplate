/** Brokers and realtors, and the buyer's pitch to them (migration 071).
 *
 *  Shared by the routes and the screen so the two cannot disagree about what
 *  a stage is called or how an email is put together. Pure: no database. */

export const BROKER_STAGES: [string, string][] = [
  ["new", "Not contacted"], ["emailed", "Emailed"], ["replied", "Replied"],
  ["on_list", "On their list"], ["sending_deals", "Sending deals"], ["cold", "Cold"],
];
export const BROKER_TOUCHES = ["email", "call", "text", "meeting", "note", "deal"] as const;

export type Broker = {
  id: string; name: string; firm: string | null; kind: "commercial" | "residential";
  parks_listed: number | null; phone: string | null; email: string | null;
  city: string | null; state: string | null; covers: string | null; evidence: string | null;
  source_url: string | null; stage: string; starred: boolean; next_touch: string | null;
  notes: string | null; created_at: string; updated_at: string;
};

export const STARTER_PITCH = {
  commercial:
`Hi {first},

I buy mobile home parks in North Carolina and I'd like to be on your buyer list for any park you take to market, on or off market.

Who we are: Larabee Homes owns and runs manufactured housing communities in eastern North Carolina, with our own office, leasing and maintenance crews. [Add: number of parks / lots owned, how long, your best value-add result.]

What I buy: parks of [10-150] lots, Sanford and east, including ones that need work -- park-owned homes, vacant lots, deferred maintenance, private utilities. [Add: price range.]

How I close: [cash / bank / seller finance], [N]-day close, no retrades.

{evidence_line}Could you add me to your list? Happy to talk any time.

(If you'd rather I didn't write again, just reply and say so.)`,
  residential:
`Hi {first},

I buy mobile home parks in North Carolina, and I'm reaching out to a few agents in {area} in case one ever crosses your desk -- a park, a few acres with several homes on it, an owner thinking about selling.

We're Larabee Homes: we own and run manufactured housing communities in eastern North Carolina with our own maintenance crews. [Add: number of parks / lots owned.] We close quickly and we're easy to work with, and we pay a full commission on anything you bring us.

{evidence_line}If you ever hear of one, I'd love a call. Thanks!

(If you'd rather I didn't write again, just reply and say so.)`,
};

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The email for one broker: the saved pitch (or the starter for their kind),
 *  with their name, area and the listing that shows they do parks filled in.
 *  Placeholders with nothing to fill are taken out with their line, never
 *  left as "{area}" in somebody's inbox. */
export type Pitch = { pitch: string | null; pitch_residential: string | null; signature: string | null };

export function composeEmail(b: Broker, p: Pitch) {
  const saved = b.kind === "residential" ? p.pitch_residential : p.pitch;
  const signature = p.signature;
  const body0 = saved?.trim() ? saved : STARTER_PITCH[b.kind];
  const evidence = b.evidence?.replace(/^residential[:;,\s-]*/i, "").trim();
  const area = b.city || b.covers || "your area";
  const evidenceLine = evidence
    ? `I saw your work on ${evidence.replace(/\.$/, "")} -- exactly the kind of property I'm after.\n\n`
    : "";
  let body = body0
    .replace(/\{first\}/g, first(b.name))
    .replace(/\{firm\}/g, b.firm ?? "your firm")
    .replace(/\{area\}/g, area)
    .replace(/\{evidence_line\}/g, evidenceLine);
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  if (signature?.trim()) body += `\n\n${signature.trim()}`;
  const subject = b.kind === "commercial"
    ? "Mobile home park buyer -- please add me to your list"
    : `Buying mobile home parks around ${b.city || "eastern NC"}`;
  return { subject, body };
}

/** Gmail's own compose window, filled in. Nothing is sent from here: the
 *  person reads it and presses Send in Gmail. */
export function gmailComposeUrl(to: string, subject: string, body: string) {
  const u = new URL("https://mail.google.com/mail/");
  u.searchParams.set("view", "cm"); u.searchParams.set("fs", "1");
  u.searchParams.set("to", to); u.searchParams.set("su", subject); u.searchParams.set("body", body);
  return u.toString();
}

/** A CSV line with quotes, as spreadsheets write them. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...rest] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
