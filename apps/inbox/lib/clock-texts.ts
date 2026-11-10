/**
 * Texts about the clock: reminders to the crew, reports to whoever answers
 * for them.
 *
 * Six moments in a working day, each at a time of day in the company's own
 * time zone:
 *
 *   crew_morning   "time to clock in"            -> anybody not yet in
 *   lead_morning   who is in, and where          -> crew lead / office
 *   crew_lunch     "lunch is over, clock back in" -> on a break, or clocked out
 *                                                    after working the morning
 *   lead_lunch     who is not back from lunch     -> crew lead / office
 *   crew_evening   "here are your hours today"    -> everybody in the programme
 *   lead_recap     the day, person by person      -> crew lead / office
 *
 * Pure: `now`, the people, today's shifts and what has already been sent go
 * in; the texts that are due come out. Nothing here reads a clock or sends
 * anything, so every one of those decisions can be checked.
 *
 * THE TIME ZONE IS THE COMPANY'S, NOT THE SERVER'S. Vercel runs in UTC, and a
 * reminder scheduled for "8:45" in UTC goes out at 3:45 in the morning in
 * North Carolina in winter and 4:45 in summer. The slot is a wall-clock time
 * in `tz`, and daylight saving is Intl's problem, not ours.
 *
 * ONCE A DAY, EACH. The scheduler wakes every few minutes; a text is due from
 * its time until `GRACE` minutes after, and the ledger key -- kind, person,
 * day -- is what stops the second wake sending it again. The grace window is
 * what stops a scheduler that was down all morning sending "who clocked in at
 * 8:45" at four in the afternoon, which would be worse than not sending it.
 */

import { worked, RULES, type Rules, type Shift } from "./shift";

export const KINDS = [
  "crew_morning", "lead_morning", "crew_lunch", "lead_lunch", "crew_evening", "lead_recap",
] as const;
export type Kind = (typeof KINDS)[number];

export type Settings = {
  tz: string;
  /** "HH:MM" in `tz`, one per kind. A null slot is switched off. */
  at: Record<Kind, string | null>;
  /** Days texts go out, 0 = Sunday. */
  days: number[];
  /** Days that are worked SOMETIMES -- Jose's Saturdays. Nobody is reminded
   *  to clock in, and only the people who did clock in get a text or are
   *  in a report. A Saturday report that lists twelve men as "not clocked
   *  in" when three were asked to come is twelve lines of noise. */
  optionalDays: number[];
  /** "HH:MM": a shift nobody clocked out of is closed at this time. Null
   *  switches the catch off. */
  autoOut: string | null;
  /** The site's own address, for the link in the text. */
  base: string;
};

export const DEFAULTS: Omit<Settings, "base"> = {
  tz: "America/New_York",
  at: {
    crew_morning: "07:50",
    lead_morning: "08:45",
    crew_lunch: "13:00",
    lead_lunch: "13:15",
    crew_evening: "17:30",
    lead_recap: "21:00",
  },
  days: [1, 2, 3, 4, 5, 6],
  optionalDays: [6],
  autoOut: "18:00",
};

/** How long after its time a text may still go out. */
export const GRACE = 90;

export type Person = {
  id: string;
  name: string;
  phone: string | null;
  /** In the crew clock programme: reminded, and reported on. */
  onClock: boolean;
  /** Whose crew this person is on. */
  leadId: string | null;
  /** Gets every crew's reports, not just their own -- the office. */
  allReports: boolean;
  /** The language their texts are written in. English when not said. */
  lang?: Lang;
};

export type DayShift = Shift & {
  siteName: string | null; startFence: string | null;
  /** Closed by the clock rather than by the man. */
  autoOut?: boolean;
};

export type Text = {
  kind: Kind | "crew_autoout"; staffId: string; to: string; body: string; key: string;
};

/* ------------------------------------------------------------------ time */

export type Local = { day: string; minutes: number; dow: number };

/** The wall clock in `tz` at `when`. */
export function localOf(when: Date, tz: string): Local {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(when).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dow,
  };
}

const slotMinutes = (hhmm: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
};

/** Which kinds are due right now. */
export function dueKinds(
  now: Date, s: Pick<Settings, "tz" | "at" | "days"> & { optionalDays?: number[] },
): Kind[] {
  const l = localOf(now, s.tz);
  if (!s.days.includes(l.dow)) return [];
  // Nobody is told to come in on a day only some are asked to work.
  const optional = (s.optionalDays ?? []).includes(l.dow);
  return KINDS.filter((k) => {
    if (optional && k === "crew_morning") return false;
    const at = slotMinutes(s.at[k]);
    return at !== null && l.minutes >= at && l.minutes < at + GRACE;
  });
}

/** "7:52 AM" in `tz`. */
export function clockTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  });
}

export const hm = (h: number) => {
  const mins = Math.round(h * 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
};

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/* ----------------------------------------------------------- one person */

/** A marker, translated when written, so the set of sites is language-free. */
const NOT_SET = "\u0000not-set";

type Status = {
  person: Person;
  today: DayShift[];
  open: DayShift | null;
  onBreak: { since: string } | null;
  /** Worked earlier today, not working now. */
  clockedOutAt: string | null;
  hours: number;
  running: number;
  sites: string[];
  offSite: number;
};

function statusOf(p: Person, shifts: DayShift[], now: Date, rules: Rules): Status {
  const today = shifts.filter((s) => s.staffId === p.id)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const open = today.find((s) => !s.endedAt) ?? null;
  const br = open?.breaks?.find((b) => !b.endedAt) ?? null;
  const last = today.at(-1) ?? null;
  const w = worked(today, now, rules);
  return {
    person: p,
    today,
    open,
    onBreak: br ? { since: br.startedAt } : null,
    clockedOutAt: !open && last?.endedAt ? last.endedAt : null,
    hours: w.hours,
    running: w.running,
    // Each site once, in the order they were worked.
    sites: [...new Set(today.map((s) => s.siteName ?? NOT_SET))],
    offSite: today.filter((s) => s.startFence === "outside").length,
  };
}

/* ---------------------------------------------------------- the writing */

/*
 * EVERY TEXT IN BOTH LANGUAGES. Half the crew read Spanish first, and a
 * reminder somebody has to translate in his head at ten to eight is a
 * reminder that gets ignored. The language is the RECIPIENT'S: a crew lead
 * who reads Spanish gets his report in Spanish whatever his crew read.
 *
 * Site names, people's names and the link are never translated -- they are
 * names, and the office has to be able to read them back.
 */
export type Lang = "en" | "es";

const W = {
  en: {
    morning: (n: string, l: string) => `Good morning ${n}. Time to clock in: ${l}`,
    endBreak: (n: string, l: string) => `${n}, lunch is over. End your break and get back on the clock: ${l}`,
    backIn: (n: string, l: string) => `${n}, lunch is over. Clock back in: ${l}`,
    noHours: (n: string, l: string) =>
      `${n}, there are no hours on the clock for you today. If you worked, tell the office here: ${l}`,
    stillIn: (n: string, h: string, w: string, l: string) =>
      `${n}, you are still clocked in (${h} so far today at ${w}). Clock out when you finish: ${l}`,
    today: (n: string, h: string, w: string, l: string) =>
      `${n}, today you have ${h} at ${w}. If that is not right, fix it here: ${l}`,
    notSet: "site not set",
    offSite: " (off site)",
    mReport: (t: string) => `Clock-in report ${t}`,
    clockedIn: (k: number) => `Clocked in (${k}):`,
    leftAlready: (k: number) => `Already clocked out (${k}):`,
    outAt: (t: string) => `out at ${t}`,
    notIn: (k: number) => `Not clocked in (${k}):`,
    lReport: (t: string) => `After-lunch report ${t}`,
    notBack: (k: number) => `Not back from lunch (${k}):`,
    onBreak: (t: string) => `on break since ${t}`,
    clockedOut: (t: string) => `clocked out at ${t}`,
    working: (k: number) => `Working now: ${k}`,
    never: (names: string) => `Not clocked in at all today: ${names}`,
    recap: (d: string) => `Daily recap ${d}`,
    noneToday: "no hours",
    stillOpen: (t: string) => `STILL CLOCKED IN since ${t}`,
    autoNote: (t: string) => `did not clock out, closed by the clock at ${t}, check it`,
    autoOut: (n: string, t: string, h: string, l: string) =>
      `${n}, you did not clock out, so the clock closed your shift at ${t} (${h} today). `
      + `If you worked later or left earlier, fix it here: ${l}`,
    offSites: (k: number) => `${k} clock-in${k === 1 ? "" : "s"} off site`,
    total: (h: string) => `Total finished: ${h}`,
    details: (l: string) => `Details: ${l}`,
    locale: "en-US",
  },
  es: {
    morning: (n: string, l: string) => `Buenos días ${n}. Es hora de marcar entrada: ${l}`,
    endBreak: (n: string, l: string) =>
      `${n}, terminó el almuerzo. Termina tu descanso y vuelve a marcar: ${l}`,
    backIn: (n: string, l: string) => `${n}, terminó el almuerzo. Marca tu entrada otra vez: ${l}`,
    noHours: (n: string, l: string) =>
      `${n}, no tienes horas registradas hoy. Si trabajaste, avísale a la oficina aquí: ${l}`,
    stillIn: (n: string, h: string, w: string, l: string) =>
      `${n}, todavía estás marcado (${h} hasta ahora hoy en ${w}). Marca tu salida al terminar: ${l}`,
    today: (n: string, h: string, w: string, l: string) =>
      `${n}, hoy tienes ${h} horas en ${w}. Si no es correcto, corrígelo aquí: ${l}`,
    notSet: "sitio sin asignar",
    offSite: " (fuera del sitio)",
    mReport: (t: string) => `Reporte de entrada ${t}`,
    clockedIn: (k: number) => `Marcaron entrada (${k}):`,
    leftAlready: (k: number) => `Ya marcaron salida (${k}):`,
    outAt: (t: string) => `salió a las ${t}`,
    notIn: (k: number) => `No han marcado (${k}):`,
    lReport: (t: string) => `Reporte después del almuerzo ${t}`,
    notBack: (k: number) => `No han regresado del almuerzo (${k}):`,
    onBreak: (t: string) => `en descanso desde las ${t}`,
    clockedOut: (t: string) => `marcó salida a las ${t}`,
    working: (k: number) => `Trabajando ahora: ${k}`,
    never: (names: string) => `No marcaron nada hoy: ${names}`,
    recap: (d: string) => `Resumen del día ${d}`,
    noneToday: "sin horas",
    stillOpen: (t: string) => `TODAVÍA MARCADO desde las ${t}`,
    autoNote: (t: string) => `no marcó salida, el reloj la cerró a las ${t}, revísalo`,
    autoOut: (n: string, t: string, h: string, l: string) =>
      `${n}, no marcaste tu salida, así que el reloj cerró tu turno a las ${t} (${h} hoy). `
      + `Si trabajaste más tarde o saliste antes, corrígelo aquí: ${l}`,
    offSites: (k: number) => `${k} entrada${k === 1 ? "" : "s"} fuera del sitio`,
    total: (h: string) => `Total terminado: ${h}`,
    details: (l: string) => `Detalles: ${l}`,
    locale: "es-US",
  },
} as const;

/** "7:52 AM" in `tz`, in the reader's language. */
const timeIn = (iso: string, tz: string, lang: Lang) =>
  new Date(iso).toLocaleTimeString(W[lang].locale, { timeZone: tz, hour: "numeric", minute: "2-digit" });

function crewText(kind: Kind, st: Status, s: Settings): string | null {
  const w = W[st.person.lang ?? "en"];
  const link = `${s.base}/clock`;
  const n = first(st.person.name);
  const where = st.sites.map((x) => x === NOT_SET ? w.notSet : x).join(", ");
  if (kind === "crew_morning") {
    // Already in, or already been and gone: nothing to remind.
    if (st.today.length) return null;
    return w.morning(n, link);
  }
  if (kind === "crew_lunch") {
    if (st.onBreak) return w.endBreak(n, link);
    if (st.clockedOutAt) return w.backIn(n, link);
    return null;
  }
  if (kind === "crew_evening") {
    if (!st.today.length) return w.noHours(n, link);
    if (st.open) return w.stillIn(n, hm(st.hours + st.running), where, link);
    return w.today(n, hm(st.hours), where, link);
  }
  return null;
}

const line = (bits: string[]) => bits.filter(Boolean).join("\n");

function leadText(
  kind: Kind, crew: Status[], s: Settings, now: Date, office: boolean, lang: Lang,
): string | null {
  if (!crew.length) return null;
  const w = W[lang];
  const tz = s.tz;
  const t = (iso: string) => timeIn(iso, tz, lang);
  const at = t(now.toISOString());
  const tail = office ? `\n${w.details(`${s.base}/timesheets`)}` : "";
  const site = (x: string | null) => x ?? w.notSet;

  if (kind === "lead_morning") {
    const inNow = crew.filter((c) => c.open);
    const left = crew.filter((c) => !c.open && c.today.length);
    const notIn = crew.filter((c) => !c.today.length);
    return line([
      w.mReport(at),
      w.clockedIn(inNow.length),
      ...inNow.map((c) => `• ${c.person.name} – ${site(c.open!.siteName)}, `
        + `${t(c.open!.startedAt)}${c.open!.startFence === "outside" ? w.offSite : ""}`),
      left.length ? w.leftAlready(left.length) : "",
      ...left.map((c) => `• ${c.person.name} – ${w.outAt(t(c.clockedOutAt!))}`),
      w.notIn(notIn.length),
      ...notIn.map((c) => `• ${c.person.name}`),
    ]) + tail;
  }

  if (kind === "lead_lunch") {
    const away = crew.filter((c) => c.onBreak || c.clockedOutAt);
    const working = crew.filter((c) => c.open && !c.onBreak);
    const never = crew.filter((c) => !c.today.length);
    return line([
      w.lReport(at),
      w.notBack(away.length),
      ...away.map((c) => `• ${c.person.name} – ${c.onBreak
        ? w.onBreak(t(c.onBreak.since)) : w.clockedOut(t(c.clockedOutAt!))}`),
      w.working(working.length),
      never.length ? w.never(never.map((c) => c.person.name).join(", ")) : "",
    ]) + tail;
  }

  if (kind === "lead_recap") {
    const total = crew.reduce((a, c) => a + c.hours, 0);
    const day = new Date(now).toLocaleDateString(w.locale, {
      timeZone: tz, weekday: "short", month: "short", day: "numeric",
    });
    return line([
      w.recap(day),
      ...crew.map((c) => {
        if (!c.today.length) return `• ${c.person.name} – ${w.noneToday}`;
        const bits = [`• ${c.person.name} ${hm(c.hours)} – ${c.sites.map((x) => x === NOT_SET ? w.notSet : x).join(", ")}`];
        if (c.open) bits.push(` – ${w.stillOpen(t(c.open.startedAt))}`);
        const auto = c.today.filter((x) => x.autoOut && x.endedAt).at(-1);
        if (auto) bits.push(` – ${w.autoNote(t(auto.endedAt!))}`);
        if (c.offSite) bits.push(` – ${w.offSites(c.offSite)}`);
        return bits.join("");
      }),
      w.total(hm(total)),
    ]) + tail;
  }
  return null;
}

/* ------------------------------------------------------------ the plan */

/**
 * Every text due now that has not gone yet.
 *
 * `sent` holds the ledger keys already used today. Who is on whose crew:
 * a lead gets a report about the people whose `leadId` is them; anybody
 * with `allReports` gets one about everybody in the programme.
 */
export function plan(
  now: Date, settings: Settings, people: Person[], shifts: DayShift[],
  sent: Set<string>, rules: Rules = RULES,
): Text[] {
  const kinds = dueKinds(now, settings);
  if (!kinds.length) return [];
  const { day, dow } = localOf(now, settings.tz);

  const everyone = people.filter((p) => p.onClock)
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = new Map(everyone.map((p) => [p.id, statusOf(p, shifts, now, rules)]));
  // On a day only some are asked to work, the crew IS whoever came. Nobody
  // else is texted, and nobody else is a line in a report.
  const optional = (settings.optionalDays ?? []).includes(dow);
  const crew = optional ? everyone.filter((p) => status.get(p.id)!.today.length) : everyone;

  const out: Text[] = [];
  const push = (kind: Kind, p: Person, body: string | null) => {
    if (!body || !p.phone) return;
    const key = `${kind}:${p.id}:${day}`;
    if (sent.has(key)) return;
    out.push({ kind, staffId: p.id, to: p.phone, body, key });
  };

  for (const kind of kinds) {
    if (kind.startsWith("crew_")) {
      for (const p of crew) push(kind, p, crewText(kind, status.get(p.id)!, settings));
      continue;
    }
    for (const r of people) {
      const theirs = r.allReports ? crew : crew.filter((c) => c.leadId === r.id);
      push(kind, r, leadText(kind, theirs.map((c) => status.get(c.id)!), settings, now,
                             r.allReports, r.lang ?? "en"));
    }
  }
  return out;
}

/* ------------------------------------------------------- the auto clock-out
 *
 * "Guys that don't clock out need to get clocked out." A shift left open
 * runs all night, and the old answer -- flag it, add no hours, wait for
 * somebody -- leaves a man unpaid for a day he worked until the office
 * notices. So the clock closes it, and SAYS it did, everywhere it matters.
 *
 * WHEN IT ENDS is the whole question, because either wrong answer is
 * somebody's money. The end is the clock-out time (six by default) on the
 * day the shift began -- unless the phone says he was still at it later: a
 * position sent, or a break taken, after six. Then it ends at the last of
 * those, because that is the last moment anything says he was working.
 *
 * WHO IS LEFT ALONE: anybody whose phone is still pinging. The clock screen
 * is open and sending its position every ten minutes; that is a man still
 * working, and closing his shift under him is the clock arguing with him.
 * Once it has gone quiet for half an hour, it closes at the last ping.
 *
 * A shift begun AFTER the clock-out time -- an evening job -- is closed at
 * its start plus the daily cap, not at a six o'clock that was before it.
 */

export type OpenForAuto = {
  id: string; staffId: string; startedAt: string;
  breaks: { startedAt: string; endedAt: string | null }[];
  /** The newest position the phone sent on this shift, if any. */
  lastPing: string | null;
};

export const QUIET_MINUTES = 30;

export type AutoOut = {
  shiftId: string; staffId: string; endedAt: string;
  /** End the open break at `endedAt` too. Only ever the break that began
   *  after the clock-out time and is the reason the end moved. */
  closeBreak: boolean;
};

/** Midnight-relative minutes in `tz` -> the instant, on the local day of `ref`. */
function atLocal(ref: Date, minutes: number, tz: string): Date {
  // Start from the reference instant, step to the wanted wall-clock time, and
  // correct once for any offset change between the two (a DST night).
  const l = localOf(ref, tz);
  let t = ref.getTime() + (minutes - l.minutes) * 60_000;
  const l2 = localOf(new Date(t), tz);
  if (l2.minutes !== minutes && l2.day === l.day) t += (minutes - l2.minutes) * 60_000;
  return new Date(t - (t % 60_000));
}

export function autoOuts(
  open: OpenForAuto[], now: Date,
  s: Pick<Settings, "tz" | "autoOut">, rules: Rules = RULES,
): AutoOut[] {
  const cut = slotMinutes(s.autoOut);
  if (cut === null) return [];
  const out: AutoOut[] = [];

  for (const sh of open) {
    const start = new Date(sh.startedAt);
    let end = atLocal(start, cut, s.tz);
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + rules.dailyCap * 3_600_000);
    }
    if (now.getTime() < end.getTime()) continue;

    // Still pinging: still working. Leave him be.
    const ping = sh.lastPing ? Date.parse(sh.lastPing) : null;
    if (ping !== null && now.getTime() - ping < QUIET_MINUTES * 60_000) continue;

    // The last thing that says he was on the clock, if it is after the cut.
    const evidence = [ping, ...sh.breaks.flatMap((b) => [
      Date.parse(b.startedAt), b.endedAt ? Date.parse(b.endedAt) : null,
    ])].filter((x): x is number => x !== null && Number.isFinite(x) && x <= now.getTime());
    let latest = Math.max(end.getTime(), ...evidence);
    // On a break that never ended, and that break is the last sign of work:
    // he stopped when it began. A break must end after it starts, so both
    // end a minute on -- and that minute is break, deducted, so the hours
    // paid still stop exactly when the break began. Nothing is deleted.
    const stuck = sh.breaks.find((b) => !b.endedAt);
    const closeBreak = !!stuck && Date.parse(stuck.startedAt) >= latest;
    if (closeBreak) latest = Date.parse(stuck!.startedAt) + 60_000;

    // Any OTHER open break -- lunch at noon, never ended -- is left open.
    // Closing it at six would deduct six hours of "lunch" nobody measured,
    // and a break with no end is never deducted. The recap says "check it".
    out.push({ shiftId: sh.id, staffId: sh.staffId, endedAt: new Date(latest).toISOString(),
               closeBreak });
  }
  return out;
}

/** The text to the man whose shift the clock closed. */
export function autoOutText(
  p: Person, endedAt: string, hours: number, s: Pick<Settings, "tz" | "base">,
): string {
  const lang = p.lang ?? "en";
  return W[lang].autoOut(first(p.name), timeIn(endedAt, s.tz, lang), hm(hours), `${s.base}/clock`);
}
