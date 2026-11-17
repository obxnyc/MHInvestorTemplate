/**
 * Rent collections: the rules, as pure functions.
 *
 * No imports, so `collections-check.mjs` runs every one of them without a
 * database, Rent Manager or a clock. The fetching is `collections-pull.ts`;
 * the screen is `CollectionsBoard.tsx`.
 *
 * THE POLICY IS RIGID AND THE SCREEN SAYS SO. Rent is due on the 1st and
 * late after the 5th. On the 6th the late notice AND the 10-day demand go
 * out together (the owner, 17 November 2026), and the late fee is added in
 * Rent Manager. Once the ten days have run, the eviction is filed. Every
 * step has a date it is due by, and a step not taken by its date is
 * OVERDUE -- on screen, in red, with the name of whoever was meant to do it.
 *
 * A PROMISE NEVER STOPS THE PROCESS. It changes who we worry about, not
 * what we do. A tenant who has arranged to pay before the eviction would
 * play out -- or who has paid a significant part and named a day for the
 * rest -- is "arranged". The filing still happens on its day.
 *
 * PAYMENTS ARE READ OFF THE BALANCE. This app keeps no rent ledger; Rent
 * Manager does. A payment is a fall in the balance between two readings,
 * which is why the balance is read every hour: a payment and the 1st's new
 * charge landing between the same two readings would hide each other, and
 * the closer the readings the rarer that is. The screen says where the
 * number came from.
 */

/* ------------------------------------------------------------------ stages */

export const STAGES = ["current", "late", "filed", "judgment", "writ", "out"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  current: "Not behind",
  late: "Late notice + 10-day demand",
  filed: "Eviction filed",
  judgment: "Judgment for possession",
  writ: "Writ of possession",
  out: "Out of the home",
};

/** Short form for a pill in a list. */
export const STAGE_SHORT: Record<Stage, string> = {
  current: "Current",
  late: "Demand served",
  filed: "Filed",
  judgment: "Judgment",
  writ: "Writ",
  out: "Out",
};

export const isStage = (v: unknown): v is Stage =>
  typeof v === "string" && (STAGES as readonly string[]).includes(v);

export const stageIndex = (s: Stage) => STAGES.indexOf(s);

/* ------------------------------------------------------------------ policy */

export type Policy = {
  /** Day of the month rent is due. */
  dueDay: number;
  /** Late AFTER this day: 5 means the 6th is the first late day. */
  lateAfterDay: number;
  /** The demand gives this many days to pay. File on the day after they run out. */
  demandDays: number;
  /** Rough days from filing to the court date, until a real date is typed. */
  courtDaysEst: number;
  /** Days a judgment can be appealed before the writ can be asked for. */
  appealDays: number;
  /** Rough days from the writ to the sheriff's lock-out. */
  writDaysEst: number;
  /** A payment of at least this percent of what was owed counts as significant. */
  significantPct: number;
  /** Days without hearing from somebody behind before they count as silent. */
  quietDays: number;
};

export const DEFAULT_POLICY: Policy = {
  dueDay: 1,
  lateAfterDay: 5,
  demandDays: 10,
  courtDaysEst: 10,
  appealDays: 10,
  writDaysEst: 5,
  significantPct: 50,
  quietDays: 3,
};

/* ------------------------------------------------------------------ dates */

/** YYYY-MM-DD plus n days. Calendar arithmetic in UTC, so no daylight
 *  saving hour ever moves a date. */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The given day of the month that `day` falls in. */
export function dayOfMonth(day: string, d: number): string {
  return `${day.slice(0, 8)}${pad(d)}`;
}

/** The first late day of the month `day` falls in: the 6th. */
export const lateDayOf = (day: string, p: Policy) => dayOfMonth(day, p.lateAfterDay + 1);

/** The 1st of the month after `day`. */
export function nextDueDay(day: string, p: Policy): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(p.dueDay)}`;
}

/** "Mon Nov 16". */
export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ the account */

export type Account = {
  rmTenantId: number;
  name: string;
  balanceCents: number;
  oldestCharge: string | null;
  stage: Stage;
  /** When the current stage was reached, YYYY-MM-DD. */
  stageOn: string | null;
  /** The court date, once the summons gives one. */
  courtOn: string | null;
};

/**
 * Where somebody ought to be today, from the balance and the calendar.
 *
 * Only ever moves FORWARD from `current` to `late`: the late notice and the
 * demand are what the 6th means, so anybody still owing on the 6th is at
 * that step whether or not anybody pressed a button. Later steps are
 * things a person does -- filing, a judgment -- and are never inferred.
 *
 * Paid in full puts anybody back to current, from any stage short of out.
 * A case already filed is then a case somebody has to dismiss, and
 * `paidDuring` says so.
 */
export function settle(
  a: Account, today: string, p: Policy,
): { stage: Stage; stageOn: string | null; paidDuring: Stage | null; movedTo: Stage | null } {
  const owes = a.balanceCents >= 100;
  if (!owes) {
    if (a.stage === "current" || a.stage === "out") {
      return { stage: a.stage, stageOn: a.stageOn, paidDuring: null, movedTo: null };
    }
    return { stage: "current", stageOn: today, paidDuring: a.stage, movedTo: "current" };
  }
  if (a.stage === "current" && today >= lateDayOf(today, p)) {
    // Late on THIS month's 6th, or -- for somebody carrying a balance from
    // an older month -- the 6th they were first late on is in the past, and
    // the step was due then.
    const since = a.oldestCharge && a.oldestCharge < dayOfMonth(today, 1)
      ? lateDayOf(a.oldestCharge, p) : lateDayOf(today, p);
    return { stage: "late", stageOn: since, paidDuring: null, movedTo: "late" };
  }
  if (a.stage === "current" && a.oldestCharge && a.oldestCharge < dayOfMonth(today, 1)) {
    // Before the 6th, but owing from a month already past: that month's
    // 6th has come and gone.
    return { stage: "late", stageOn: lateDayOf(a.oldestCharge, p), paidDuring: null, movedTo: "late" };
  }
  return { stage: a.stage, stageOn: a.stageOn, paidDuring: null, movedTo: null };
}

/* ------------------------------------------------------------------ the next step */

export type Step = {
  /** What has to happen, in the words somebody would say. */
  label: string;
  /** The day it is due by. */
  due: string;
  /** Days past due, 0 when not yet. */
  overdue: number;
  /** The stage taking the step moves to, when it is a stage. */
  to: Stage | null;
};

/** The day the demand runs out and the eviction can be filed. */
export const fileOn = (servedOn: string, p: Policy) => addDays(servedOn, p.demandDays + 1);

export function nextStep(a: Account, today: string, p: Policy): Step | null {
  const on = a.stageOn ?? today;
  const mk = (label: string, due: string, to: Stage | null): Step =>
    ({ label, due, overdue: Math.max(0, daysFrom(due, today)), to });
  switch (a.stage) {
    case "current":
      if (a.balanceCents < 100) return null;
      return mk("Send the late notice and 10-day demand", lateDayOf(today, p), "late");
    case "late":
      return mk("File the eviction", fileOn(on, p), "filed");
    case "filed":
      return a.courtOn
        ? mk("Go to court", a.courtOn, "judgment")
        : mk("Enter the court date from the summons", addDays(on, 2), null);
    case "judgment":
      return mk("Ask for the writ of possession", addDays(on, p.appealDays + 1), "writ");
    case "writ":
      return mk("Sheriff's lock-out", addDays(on, p.writDaysEst), "out");
    case "out":
      return null;
  }
}

/**
 * When the process, run on time from where it stands, would put somebody
 * out. A promise due before this day is an arrangement; one due after it
 * is a hope.
 */
export function playsOutBy(a: Account, today: string, p: Policy): string {
  const on = a.stageOn ?? today;
  const fromFiling = (filed: string, court: string | null) => {
    const courtDay = court ?? addDays(filed, p.courtDaysEst);
    return addDays(courtDay, p.appealDays + 1 + p.writDaysEst);
  };
  switch (a.stage) {
    case "current": {
      const served = today >= lateDayOf(today, p) ? today : lateDayOf(today, p);
      return fromFiling(fileOn(served, p), null);
    }
    case "late": return fromFiling(fileOn(on, p), null);
    case "filed": return fromFiling(on, a.courtOn);
    case "judgment": return addDays(on, p.appealDays + 1 + p.writDaysEst);
    case "writ": return addDays(on, p.writDaysEst);
    case "out": return on;
  }
}

/* ------------------------------------------------------------------ payments */

export type Reading = { at: string; cents: number };

/**
 * What was paid since an instant, read off the balance: every FALL between
 * consecutive readings after it, starting from the balance as it stood
 * then. A rise is a new charge and is not a payment going backwards.
 */
export function paidSince(startCents: number, readings: Reading[], since: string): number {
  let prev = startCents;
  let paid = 0;
  for (const r of [...readings].filter((r) => r.at > since).sort((a, b) => a.at.localeCompare(b.at))) {
    if (r.cents < prev) paid += prev - r.cents;
    prev = r.cents;
  }
  return paid;
}

/* ------------------------------------------------------------------ promises */

export type PromiseStatus = "open" | "kept" | "broken" | "cancelled";

export type PayPromise = {
  id: string;
  amountCents: number;
  dueOn: string;
  /** When it was made, ISO. */
  madeAt: string;
  /** The balance at that moment. */
  balanceAtCents: number;
  /** Paid at the time, as part of the arrangement. */
  paidNowCents: number;
  status: PromiseStatus;
};

/** A dollar short of the promise is still the promise kept: a $400 promise
 *  paid as $399.50 after a card fee is not a broken one. */
export const KEPT_SLACK = 100;

/**
 * Where a promise stands. Kept the moment enough has been paid; broken the
 * day AFTER its day passes without it -- a promise due today is still
 * open at 11pm, because the money can still come.
 *
 * A promise somebody cancelled stays cancelled. Kept and broken are
 * re-read from the money each time: a payment that lands late turns a
 * broken promise into a kept one, and says so, rather than leaving a
 * tenant marked as having broken their word when they paid.
 */
export function judge(
  pr: PayPromise, readings: Reading[], today: string,
): { status: PromiseStatus; paidCents: number } {
  if (pr.status === "cancelled") return { status: "cancelled", paidCents: 0 };
  const paid = paidSince(pr.balanceAtCents, readings, pr.madeAt);
  if (paid + KEPT_SLACK >= pr.amountCents) return { status: "kept", paidCents: paid };
  if (today > pr.dueOn) return { status: "broken", paidCents: paid };
  return { status: "open", paidCents: paid };
}

/* ------------------------------------------------------------------ who to worry about */

export type Standing =
  | "paid"        // nothing owed
  | "arranged"    // a promise before it plays out, or a significant payment and a date
  | "broken"      // the last promise was broken and nothing replaced it
  | "talking"     // heard from lately, nothing arranged
  | "silent";     // nothing heard

export const STANDING_LABEL: Record<Standing, string> = {
  paid: "Paid up",
  arranged: "Arranged",
  broken: "Promise broken",
  talking: "Talking, nothing arranged",
  silent: "No contact",
};

export const WORRY: Standing[] = ["broken", "silent"];

export type Judged = PayPromise & { judged: PromiseStatus; paidCents: number };

export function standing(
  a: Account, promises: Judged[], lastHeard: string | null, today: string, p: Policy,
  /** Paid since the account went late, read off the balance. */
  paidSinceLate: number,
): { standing: Standing; why: string } {
  if (a.balanceCents < 100) return { standing: "paid", why: "Nothing owed." };

  const open = promises.filter((x) => x.judged === "open")
    .sort((x, y) => x.dueOn.localeCompare(y.dueOn));
  const outBy = playsOutBy(a, today, p);
  const owedAtLate = a.balanceCents + paidSinceLate;
  const significant = owedAtLate > 0 && paidSinceLate * 100 >= owedAtLate * p.significantPct;

  if (open.length) {
    const first = open[0];
    if (first.dueOn <= outBy) {
      return { standing: "arranged", why: `Promised by ${shortDay(first.dueOn)}, before it would play out (${shortDay(outBy)}).` };
    }
    if (significant) {
      return { standing: "arranged", why: `Paid ${Math.round(paidSinceLate * 100 / owedAtLate)}% and promised the rest by ${shortDay(first.dueOn)}.` };
    }
  }

  const sorted = [...promises].sort((x, y) => y.madeAt.localeCompare(x.madeAt));
  const latest = sorted.find((x) => x.judged !== "cancelled");
  if (latest && latest.judged === "broken" && !open.length) {
    return { standing: "broken", why: `Promised by ${shortDay(latest.dueOn)} and it did not come.` };
  }

  if (open.length) {
    // A promise past the lock-out is not an arrangement: by then the
    // process has finished.
    return { standing: "talking", why: `Promised by ${shortDay(open[0].dueOn)}, which is after it would play out (${shortDay(outBy)}).` };
  }
  if (lastHeard && daysFrom(lastHeard.slice(0, 10), today) <= p.quietDays) {
    return { standing: "talking", why: "Heard from lately, nothing arranged yet." };
  }
  return {
    standing: "silent",
    why: lastHeard ? `Nothing heard since ${shortDay(lastHeard.slice(0, 10))}.` : "Nothing heard from them.",
  };
}

/* ------------------------------------------------------------------ expected money */

/** What is expected on each day, from open promises: the owner's "when do
 *  I expect payments to come in". Only the part not yet paid. */
export function expected(
  promises: (Judged & { rmTenantId: number; name: string })[],
  from: string, days: number,
): { day: string; cents: number; who: { name: string; cents: number; rmTenantId: number }[] }[] {
  const out = [] as { day: string; cents: number; who: { name: string; cents: number; rmTenantId: number }[] }[];
  for (let i = 0; i < days; i++) out.push({ day: addDays(from, i), cents: 0, who: [] });
  for (const pr of promises) {
    if (pr.judged !== "open") continue;
    const left = Math.max(0, pr.amountCents - pr.paidCents);
    if (!left) continue;
    // An open promise whose day is before `from` cannot be open (it would
    // be broken), but a stale one is shown on the first day rather than lost.
    const i = Math.max(0, daysFrom(from, pr.dueOn));
    if (i >= days) continue;
    out[i].cents += left;
    out[i].who.push({ name: pr.name, cents: left, rmTenantId: pr.rmTenantId });
  }
  return out;
}

/* ------------------------------------------------------------------ reminder texts */

export const REMINDERS = [
  "before_due",     // three days before the 1st, to everybody
  "due_today",      // the 1st, to anybody whose rent has not come in
  "last_day",       // the 5th: late after today
  "late",           // the 6th: late notice, fee, demand
  "promise_eve",    // the day before a promised payment
  "promise_missed", // the day after a promise was broken
] as const;
export type Reminder = (typeof REMINDERS)[number];

export const REMINDER_LABEL: Record<Reminder, string> = {
  before_due: "3 days before rent is due",
  due_today: "Rent due today",
  last_day: "Last day before late",
  late: "Late notice + 10-day demand",
  promise_eve: "Day before a promised payment",
  promise_missed: "Promised payment missed",
};

export type Person = {
  rmTenantId: number;
  name: string;
  /** Present when the shared line can text them. */
  phone: string | null;
  balanceCents: number;
  rentCents: number | null;
  lateFeeCents: number | null;
  /** Rent Manager's word for the tenancy. Only current tenants get texts. */
  status: string | null;
};

export type Draft = { rmTenantId: number; name: string; kind: Reminder; key: string; body: string };

export const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

export const dollars = (c: number) =>
  "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Is this somebody we still text about rent? Rent Manager's status word,
 *  read loosely: "Current", "Notice" (given notice, still there) yes;
 *  "Past", "Former", "Evicted" no. An unknown status is texted -- an extra
 *  reminder beats a missing one. */
export function stillHere(status: string | null): boolean {
  if (!status) return true;
  return !/past|former|moved|evict|closed|inactive/i.test(status);
}

export function wording(kind: Reminder, p: Person, day: string, policy: Policy, extra?: { promise?: PayPromise }): string {
  const hi = `Hi ${first(p.name)}, this is Larabee Homes.`;
  const tail = "Reply here or call this number if you need to talk to us.";
  switch (kind) {
    case "before_due": {
      const due = nextDueDay(day, policy);
      return `${hi} A friendly reminder that ${monthName(due)} rent${p.rentCents ? ` of ${dollars(p.rentCents)}` : ""} is due on the ${ordinal(policy.dueDay)}. Thank you!`;
    }
    case "due_today":
      return `${hi} Rent is due today. Your balance is ${dollars(p.balanceCents)}. Rent is late after the ${ordinal(policy.lateAfterDay)}. ${tail}`;
    case "last_day":
      return `${hi} Today is the last day to pay rent before it is late. Your balance is ${dollars(p.balanceCents)}.${p.lateFeeCents ? ` A late fee of ${dollars(p.lateFeeCents)} is added after today.` : " A late fee is added after today."} ${tail}`;
    case "late":
      return `${hi} Your rent is now late and a late fee has been added. Your balance is ${dollars(p.balanceCents)}. A late notice and 10-day demand for payment have been issued. Please pay right away. ${tail}`;
    case "promise_eve": {
      const pr = extra?.promise;
      return `${hi} A reminder that you arranged to pay ${pr ? dollars(pr.amountCents) : "your payment"} ${pr ? `on ${shortDay(pr.dueOn)}` : "tomorrow"}. Thank you. ${tail}`;
    }
    case "promise_missed": {
      const pr = extra?.promise;
      return `${hi} We have not received the ${pr ? dollars(pr.amountCents) + " " : ""}payment you arranged for ${pr ? shortDay(pr.dueOn) : "yesterday"}. Your balance is ${dollars(p.balanceCents)} and the eviction process continues. ${tail}`;
    }
  }
}

/**
 * Which reminder texts are due today. Each has a KEY that names the person,
 * the kind and the occasion, so the ledger can refuse a second one: the
 * same text never goes twice, however many times this is asked.
 */
export function remindersDue(
  day: string, people: Person[], promises: (Judged & { rmTenantId: number })[],
  sent: Set<string>, enabled: Set<Reminder>, policy: Policy,
): Draft[] {
  const out: Draft[] = [];
  const dom = Number(day.slice(8, 10));
  const month = day.slice(0, 7);
  const before = addDays(nextDueDay(day, policy), -3);
  const add = (p: Person, kind: Reminder, occasion: string, extra?: { promise?: PayPromise }) => {
    if (!enabled.has(kind) || !p.phone || !stillHere(p.status)) return;
    const key = `${kind}:${p.rmTenantId}:${occasion}`;
    if (sent.has(key)) return;
    out.push({ rmTenantId: p.rmTenantId, name: p.name, kind, key, body: wording(kind, p, day, policy, extra) });
  };
  for (const p of people) {
    if (day === before) add(p, "before_due", nextDueDay(day, policy).slice(0, 7));
    if (dom === policy.dueDay && p.balanceCents >= 100) add(p, "due_today", month);
    if (dom === policy.lateAfterDay && p.balanceCents >= 100) add(p, "last_day", month);
    if (dom === policy.lateAfterDay + 1 && p.balanceCents >= 100) add(p, "late", month);
  }
  const byId = new Map(people.map((p) => [p.rmTenantId, p]));
  for (const pr of promises) {
    const p = byId.get(pr.rmTenantId);
    if (!p || p.balanceCents < 100) continue;
    if (pr.judged === "open" && addDays(pr.dueOn, -1) === day) add(p, "promise_eve", pr.id, { promise: pr });
    if (pr.judged === "broken" && addDays(pr.dueOn, 1) === day) add(p, "promise_missed", pr.id, { promise: pr });
  }
  return out;
}

/* ------------------------------------------------------------------ reading a promise out of words */

/**
 * "I can pay 400 on Friday" -> $400 on the coming Friday. A SUGGESTION,
 * never a record: the screen offers it with the words it was read from, and
 * somebody presses the button. Null when the words do not name both an
 * amount and a day, because half a promise filled in by a guess is the
 * dangerous kind.
 */
export function readPromise(text: string, today: string): { cents: number; dueOn: string; from: string } | null {
  const s = text.toLowerCase();
  if (!/\b(pay|paying|send|sending|bring|get you|have it|have the|drop)\b/.test(s)) return null;

  let cents: number | null = null;
  for (const m of s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?|(?<![\d/])(\d{1,3}(?:,\d{3})+|\d{2,5})(?:\.(\d{2}))?(?![\d/]|st|nd|rd|th)/g)) {
    const whole = (m[1] ?? m[3] ?? "").replace(/,/g, "");
    const frac = m[2] ?? m[4] ?? "00";
    const n = Number(whole);
    // A bare number under 20 is a day, an hour or a count, and a year is a
    // year: neither is money. ("$15" with the sign is money.)
    if (!m[1] && (n < 20 || (n >= 2020 && n <= 2035))) continue;
    cents = n * 100 + Number(frac);
    break;
  }
  if (!cents) return null;

  const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  let dueOn: string | null = null;
  const dm = new RegExp(`\\b(${dow.join("|")}|${dow.map((d) => d.slice(0, 3)).join("|")})\\b`).exec(s);
  if (/\btoday\b|\btonight\b/.test(s)) dueOn = today;
  else if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(s)) dueOn = addDays(today, 1);
  else if (dm) {
    const want = dow.findIndex((d) => d.startsWith(dm[1].slice(0, 3)));
    let n = (want - todayDow + 7) % 7;
    if (n === 0) n = 7;
    dueOn = addDays(today, n);
  } else {
    const md = /\b(\d{1,2})\/(\d{1,2})\b/.exec(s);
    const nth = /\b(?:on the |the )(\d{1,2})(?:st|nd|rd|th)\b/.exec(s);
    if (md) {
      const y = Number(today.slice(0, 4));
      let d = `${y}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
      if (d < today) d = `${y + 1}${d.slice(4)}`;
      if (!Number.isNaN(Date.parse(d))) dueOn = d;
    } else if (nth) {
      const n = Number(nth[1]);
      if (n >= 1 && n <= 31) {
        let d = dayOfMonth(today, n);
        if (d < today) d = dayOfMonth(nextDueDay(today, { ...DEFAULT_POLICY, dueDay: 1 }), n);
        dueOn = d;
      }
    }
  }
  if (!dueOn) return null;
  return { cents, dueOn, from: text.trim().slice(0, 200) };
}
