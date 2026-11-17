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
  opted_out_at?: string | null;
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
export function gmailComposeUrl(to: string, subject: string, body: string, bcc?: string[]) {
  const u = new URL("https://mail.google.com/mail/");
  u.searchParams.set("view", "cm"); u.searchParams.set("fs", "1");
  u.searchParams.set("to", to); u.searchParams.set("su", subject); u.searchParams.set("body", body);
  if (bcc?.length) u.searchParams.set("bcc", bcc.join(","));
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

/* ------------------------------------------------------------ Blasts (073)
   One message, many brokers. Personalised per person when the app sends it;
   "there" when it goes out as one Gmail BCC, because one email cannot say
   two names. */

export type Audience = {
  kind: "all" | "commercial" | "residential";
  stages: string[];          // empty: every stage except Cold
  state: string;             // "" for every state
  starredOnly: boolean;
};
export const EVERYONE: Audience = { kind: "all", stages: [], state: "", starredOnly: false };

export type BlastBroker = Pick<Broker, "id" | "name" | "kind" | "stage" | "state" | "starred" | "email"> & { opted_out_at?: string | null };

/** Who a blast reaches, and who it leaves out and why -- the screen says
 *  the second half out loud, because "23 brokers" means nothing if nobody
 *  can see the 14 it skipped. */
export function pickAudience<T extends BlastBroker>(all: T[], a: Audience) {
  const match = all.filter((b) =>
    (a.kind === "all" || b.kind === a.kind) &&
    (a.stages.length ? a.stages.includes(b.stage) : b.stage !== "cold") &&
    (!a.state || (b.state ?? "") === a.state) &&
    (!a.starredOnly || b.starred));
  const out = { to: [] as T[], noEmail: 0, optedOut: 0 };
  const seen = new Set<string>();
  for (const b of match) {
    if (b.opted_out_at) { out.optedOut++; continue; }
    const e = (b.email ?? "").trim().toLowerCase();
    if (!e) { out.noEmail++; continue; }
    if (seen.has(e)) continue;          // two people sharing an inbox get one
    seen.add(e); out.to.push(b);
  }
  return out;
}

export const BLAST_TEMPLATES: { key: string; label: string; subject: string; body: string }[] = [
  {
    key: "radar", label: "Anything on your radar?",
    subject: "Anything on your radar? Still buying mobile home parks",
    body: `Hi {first},

Checking in -- we're still actively buying mobile home parks in North Carolina, Sanford and east especially, and we're happy to look at anything: on market, coming soon, or an owner who's just starting to think about it.

Parks that need work are welcome. Park-owned homes, vacant lots, deferred maintenance, private utilities -- we run our own maintenance crews and we've done it before.

Anything on your radar? Even a maybe is worth a call.`,
  },
  {
    key: "buybox", label: "What we buy (buy box)",
    subject: "What we're buying right now -- mobile home parks, NC",
    body: `Hi {first},

A quick update on what we're buying, in case something fits:

- Mobile home parks, [10-150] lots
- North Carolina first, then South Carolina and Georgia
- Value-add welcome: park-owned homes, vacancy, deferred maintenance, private water or septic
- [Price range]
- [How we close: cash / bank / seller finance, and how fast]

If you have something, or know an owner who might sell, I'd love to hear about it.`,
  },
  {
    key: "closed", label: "Just closed, want more",
    subject: "Just closed another park -- looking for the next one",
    body: `Hi {first},

We just closed on [park, town] and we're looking for the next one.

If you have a park listed, coming to market, or an owner who might sell quietly, we can move quickly and we close what we sign.

Thanks -- and thanks to everyone who has sent us deals.`,
  },
];

/** The part every blast ends with: who it is from, where they are, and how
 *  to stop getting them. Commercial email must carry a postal address and a
 *  way out; a broker who asks to come off a list and stays on it is a
 *  broker who stops sending deals. */
export function blastFooter(signature: string | null, mailingAddress: string | null) {
  return [
    signature?.trim() || null,
    mailingAddress?.trim() ? `\n--\n${mailingAddress.trim()}` : null,
    `If you'd rather not get these, reply "remove" and I'll take you off the list.`,
  ].filter(Boolean).join("\n");
}

export function personalize(body: string, b: { name: string } | null) {
  const f = b ? first(b.name) : "there";
  return body.replace(/\{first\}/g, f);
}

export const hasBrackets = (s: string) => /\[[^\]\n]{1,60}\]/.test(s);
