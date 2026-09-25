/**
 * What to ask before somebody drives out there.
 *
 * Every trade has a handful of questions it will ring back and ask, and every
 * one of those calls is half a day lost: the plumber arrives, asks where the
 * shut-off is, nobody knows, and he leaves again. The questions are not
 * difficult -- they are just not in the head of whoever happens to pick up the
 * thread at eight in the morning.
 *
 * So they are written down, they appear on the thread they apply to, and
 * tapping one drops it in the box to be edited rather than sending it. Nothing
 * here is sent automatically: a tenant who has already said the water is off
 * should not then be asked whether the water is off.
 *
 * ON THE PROSPECT SET, READ THIS FIRST.
 *
 * Every question in it maps to a published letting criterion, and that is not
 * a style choice. Asking a prospective tenant anything that invites a
 * protected-class answer -- children, marital status, disability, religion,
 * national origin, where somebody is "from" -- is a fair-housing problem
 * whether or not the answer is ever used, because the file then shows you knew.
 * The application form in this system was built to the same rule. Occupancy is
 * asked as "how many people", never "how many children".
 *
 * Military service is asked for the opposite reason: it is what triggers the
 * protections a service member is owed under the SCRA, and not knowing is how
 * those get missed.
 */

export type Prompt = {
  key: string;
  /** Dropped into the composer as-is, so it reads as a person wrote it. */
  ask: string;
  /** Some are for whoever is reading, not for the tenant. */
  staffOnly?: boolean;
};

export type PromptSet = { title: string; prompts: Prompt[] };

/** Asked on every maintenance thread, whatever the trade: these are the ones
 *  that decide whether the visit can happen at all. */
const ACCESS: Prompt[] = [
  { key: "access", ask: "What times work for someone to come out, and will anyone be home?" },
  { key: "dog", ask: "Is there a dog or anything else we should tell them about before they arrive?" },
  { key: "photo", ask: "Can you send a photo of it? It saves a trip." },
  { key: "lot", ask: "Can you confirm the address and lot number for me?" },
];

const TRADE: Record<string, PromptSet> = {
  plumbing: {
    title: "Plumbing",
    prompts: [
      { key: "running", ask: "Is water still running or leaking right now?" },
      { key: "shutoff", ask: "Have you been able to turn the water off at the shut-off? Do you know where it is?" },
      { key: "clean", ask: "Is it clean water or is it coming back up from a drain?" },
      { key: "fixture", ask: "Which one is it — kitchen sink, bathroom sink, tub, toilet, or the washer?" },
      { key: "wet", ask: "Is anything getting wet that shouldn't — floors, ceiling, or under the home?" },
      { key: "rest", ask: "Do you still have water everywhere else in the house?" },
    ],
  },
  hvac: {
    title: "HVAC",
    prompts: [
      { key: "blowing", ask: "Is it blowing air at all, and is the air warm or cold?" },
      { key: "thermostat", ask: "What is the thermostat set to, and what temperature is it reading?" },
      { key: "filter", ask: "When was the filter last changed?" },
      { key: "outdoor", ask: "Is the unit outside running? Any ice on it?" },
      { key: "breaker", ask: "Can you check whether the breaker for the heat/air has tripped?" },
      { key: "serviced", ask: "Check when this unit was last serviced before dispatching.", staffOnly: true },
    ],
  },
  electrical: {
    title: "Electrical",
    prompts: [
      { key: "scope", ask: "Is it one outlet, one room, or the whole home?" },
      { key: "breaker", ask: "Has a breaker tripped? If you reset it, does it trip again straight away?" },
      { key: "burning", ask: "Any burning smell, scorch marks, or buzzing? Tell me now if so." },
      { key: "alarms", ask: "Are your smoke alarms working?" },
      { key: "load", ask: "Is anything big plugged in on that circuit — a heater or a window unit?" },
      { key: "urgent", ask: "Burning smell, scorching or sparks is same-day. Do not schedule it out.", staffOnly: true },
    ],
  },
  pest: {
    title: "Pest",
    prompts: [
      { key: "what", ask: "What are you seeing, and which rooms?" },
      { key: "howmany", ask: "Roughly how many, and are you seeing them daily?" },
      { key: "started", ask: "When did you first notice them?" },
      { key: "moisture", ask: "Any leaks or damp under the sinks? That is usually what brings them in." },
      { key: "before", ask: "Has the home been treated for this before?" },
      { key: "pets", ask: "Any pets in the home? It changes what they can use." },
    ],
  },
  crawl: {
    title: "Under the home",
    prompts: [
      { key: "water", ask: "Is there standing water underneath?" },
      { key: "skirting", ask: "Is the skirting damaged or open anywhere?" },
      { key: "floors", ask: "Are any floors soft, sagging, or cold underfoot?" },
      { key: "smell", ask: "Any damp or musty smell inside the home?" },
      { key: "animals", ask: "Any sign of animals getting underneath?" },
      { key: "barrier", ask: "Ask whether the vapour barrier is torn — it changes the quote.", staffOnly: true },
    ],
  },
  appliance: {
    title: "Appliance",
    prompts: [
      { key: "which", ask: "Which appliance is it, and can you send a photo of the model number?" },
      { key: "ours", ask: "Is that one ours or your own?" },
      { key: "does", ask: "What does it do, or not do, when you try to use it?" },
      { key: "code", ask: "Is there an error code showing on it?" },
    ],
  },
  roofing: {
    title: "Roof",
    prompts: [
      { key: "inside", ask: "Is water coming inside? Which room, and is it still dripping?" },
      { key: "when", ask: "Does it only happen when it rains, or all the time?" },
      { key: "ceiling", ask: "Any staining or sagging on the ceiling?" },
      { key: "contain", ask: "Can you put a bucket under it and move anything that might get damaged?" },
    ],
  },
};

/**
 * Which trade this sounds like.
 *
 * Keywords, not a model call: it runs on every render of every thread, it has
 * to be the same answer twice, and being wrong here is cheap -- the worst case
 * is a strip of questions somebody ignores. The general set is always there
 * underneath, so a miss costs nothing.
 */
export function tradeOf(text: string): string | null {
  const t = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  if (has("crawl", "under the home", "under my home", "skirting", "vapor barrier",
          "vapour barrier", "underpinning")) return "crawl";
  if (has("roach", "ant", "mice", "mouse", "rat", "bug", "spider", "termite",
          "bed bug", "pest", "wasp", "hornet")) return "pest";
  if (has("roof", "shingle", "ceiling leak", "leaking from the ceiling")) return "roofing";
  if (has("ac ", "a/c", "air condition", "heat pump", "furnace", "hvac", "thermostat",
          "no heat", "not cooling", "not heating", "blowing hot", "blowing cold"))
    return "hvac";
  if (has("breaker", "outlet", "socket", "light switch", "no power", "sparks",
          "electric", "wiring", "smoke alarm", "smoke detector")) return "electrical";
  if (has("water heater", "leak", "toilet", "sink", "drain", "clog", "pipe",
          "faucet", "tub", "shower", "sewer", "septic", "no water", "running water"))
    return "plumbing";
  if (has("fridge", "refrigerator", "stove", "oven", "range", "dishwasher",
          "washer", "dryer", "microwave", "appliance")) return "appliance";
  return null;
}

/** What we do not know about somebody who wants to rent from us. */
const PROSPECT: PromptSet = {
  title: "What we still need",
  prompts: [
    { key: "credit", ask: "Roughly where does your credit sit? A ballpark is fine." },
    { key: "income", ask: "What is the total monthly household income before tax?" },
    { key: "military", ask: "Is anyone in the household active-duty military? It changes what we owe you, so it is worth knowing." },
    { key: "pets", ask: "Any pets? What kind, and how many?" },
    { key: "when", ask: "When are you looking to move in?" },
    { key: "people", ask: "How many people would be living there?" },
    { key: "history", ask: "Have you ever been evicted or had to break a lease?" },
    { key: "assistance", ask: "Do you have a voucher or any rental assistance? It changes how we work out the income." },
  ],
};

const COLLECTIONS: PromptSet = {
  title: "Worth asking",
  prompts: [
    { key: "when", ask: "When do you expect to be able to pay it?" },
    { key: "part", ask: "Can you pay part of it now and the rest on a date we agree?" },
    { key: "changed", ask: "Has something changed — hours cut, a job ending?" },
    { key: "record", ask: "Get any arrangement in writing in this thread before agreeing to it.", staffOnly: true },
  ],
};

/**
 * The strips to show on a thread, most specific first.
 *
 * `text` is whatever the conversation is about -- the subject and the last
 * thing said is plenty for the keyword pass.
 */
export function promptsFor(category: string, text: string): PromptSet[] {
  if (category === "maintenance") {
    const trade = tradeOf(text);
    const sets: PromptSet[] = [];
    if (trade && TRADE[trade]) sets.push(TRADE[trade]);
    sets.push({ title: "Before anyone drives out", prompts: ACCESS });
    return sets;
  }
  if (category === "prospect") return [PROSPECT];
  if (category === "collections") return [COLLECTIONS];
  return [];
}
