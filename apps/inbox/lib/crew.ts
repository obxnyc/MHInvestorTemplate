/**
 * The office's two questions about the crew, as arithmetic.
 *
 *   - Where is everybody who is on the clock, right now?
 *   - What goes to payroll for this week?
 *
 * Pure functions over rows already read, with `now` as a parameter, so both
 * answers can be checked without a database or a clock.
 */

import { shiftHours, breakMinutesOf, dayOf, RULES, type Rules, type Shift } from "./shift";

/* ------------------------------------------------------------- where now */

export type Ping = {
  shiftId: string; at: string;
  lat: number; lng: number; accuracy: number | null;
  fence: string | null; metres: number | null;
};

export type OpenShift = Shift & {
  name: string;
  startLat: number | null; startLng: number | null; startAcc: number | null;
  startFence: string | null;
};

export type Site = { id: string; name: string; lat: number | null; lng: number | null };

export type Whereabouts = {
  shiftId: string;
  staffId: string;
  name: string;
  startedAt: string;
  site: { id: string; name: string } | null;
  /** Where the dot goes, and how we know. Null when the phone never said. */
  at: { lat: number; lng: number; accuracy: number | null } | null;
  /** "ping" is the last position sent while on the clock; "clock-in" is
   *  where they were when they started and nothing since. They are different
   *  claims about how current the dot is, so the screen says which. */
  from: "ping" | "clock-in" | null;
  /** When that position was taken. */
  seenAt: string | null;
  /** inside / outside / unsure, as read when the position was taken. */
  fence: string | null;
  metres: number | null;
  /** Open past the point anybody works: a shift somebody forgot to close,
   *  not somebody still on site at midnight. */
  abandoned: boolean;
  /** No position newer than this many minutes. A phone that stopped
   *  pinging is a phone that was closed or put away, and a dot from two
   *  hours ago drawn like a dot from two minutes ago is a lie. */
  quietMinutes: number | null;
};

/** Everybody on the clock, with the newest thing we know about where. */
export function whereNow(
  open: OpenShift[], pings: Ping[], sites: Site[], now: Date, rules: Rules = RULES,
): Whereabouts[] {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return open
    .filter((s) => !s.endedAt)
    .map((s) => {
      // The NEWEST ping for this shift, whatever order they came back in.
      const mine = pings.filter((p) => p.shiftId === s.id)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const last = mine[0] ?? null;
      const site = s.propertyId ? byId.get(s.propertyId) ?? null : null;

      const fromStart = s.startLat !== null && s.startLng !== null;
      const at = last
        ? { lat: last.lat, lng: last.lng, accuracy: last.accuracy }
        : fromStart ? { lat: s.startLat as number, lng: s.startLng as number, accuracy: s.startAcc }
        : null;
      const seenAt = last ? last.at : fromStart ? s.startedAt : null;

      const openHours = (now.getTime() - Date.parse(s.startedAt)) / 3_600_000;
      return {
        shiftId: s.id,
        staffId: s.staffId,
        name: s.name,
        startedAt: s.startedAt,
        site: site ? { id: site.id, name: site.name } : null,
        at,
        from: last ? "ping" : fromStart ? "clock-in" : null,
        seenAt,
        fence: last ? last.fence : s.startFence,
        metres: last ? last.metres : null,
        abandoned: openHours >= rules.abandonedAfter,
        quietMinutes: seenAt
          ? Math.max(0, Math.round((now.getTime() - Date.parse(seenAt)) / 60_000))
          : null,
      } satisfies Whereabouts;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* --------------------------------------------------------------- payroll */

export type PayShift = Shift & {
  name: string;
  siteName: string | null;
  siteAddress: string | null;
  propertyFrom: string | null;
  startFence: string | null;
  endFence: string | null;
  /** Closed by the clock because nobody clocked out. */
  autoOut?: boolean;
};

const FENCE_SAID: Record<string, string> = {
  inside: "On site", outside: "Off site", unsure: "Could not tell",
};

/**
 * A spreadsheet cell that starts with = + - @ is a formula to Excel and to
 * Google Sheets, and names and addresses here are typed by people. Prefixing
 * a quote is the standard defence and costs nothing on a real name.
 */
export function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** yyyy-mm-dd hh:mm in the reader's own clock. */
function local(iso: string | null, offsetMinutes: number): string {
  if (!iso) return "";
  const t = new Date(Date.parse(iso) - offsetMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} `
    + `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export const PAYROLL_COLUMNS = [
  "Employee", "Date", "Job site", "Site address", "Clock in", "Clock out",
  "Break minutes", "Hours", "Clock-in location", "Clock-out location",
  "Site set by", "Signed off by employee", "Status",
] as const;

/**
 * One row per shift, then one total row per person.
 *
 * A SHIFT STILL OPEN HAS NO HOURS IN THIS FILE. It is listed, so the
 * payroll run can see it exists, with its status saying why the hours cell
 * is empty -- but a number for it would be a guess at an end time, and a
 * guess that goes to payroll is a wage paid on a guess. The person's total
 * counts only finished shifts, and says how many it left out.
 */
export function payrollCsv(
  shifts: PayShift[], now: Date,
  opts: { offsetMinutes?: number; rules?: Rules } = {},
): string {
  const off = opts.offsetMinutes ?? 0;
  const rules = opts.rules ?? RULES;
  const lines: string[] = [PAYROLL_COLUMNS.join(",")];

  const sorted = [...shifts].sort((a, b) =>
    a.name.localeCompare(b.name) || Date.parse(a.startedAt) - Date.parse(b.startedAt));

  const totals = new Map<string, { name: string; hours: number; open: number }>();

  for (const s of sorted) {
    const h = shiftHours(s, rules);
    const hoursOpen = (now.getTime() - Date.parse(s.startedAt)) / 3_600_000;
    const status = s.endedAt && s.autoOut ? "Clocked out automatically — check the end time"
      : s.endedAt ? "Finished"
      : hoursOpen >= rules.abandonedAfter ? "Not clocked out — needs fixing"
      : "Still on the clock";

    const tot = totals.get(s.staffId) ?? { name: s.name, hours: 0, open: 0 };
    if (h === null) tot.open += 1; else tot.hours += h;
    totals.set(s.staffId, tot);

    lines.push([
      s.name,
      dayOf(s, off),
      s.siteName ?? "Not set",
      s.siteAddress ?? "",
      local(s.startedAt, off),
      local(s.endedAt, off),
      breakMinutesOf(s),
      h === null ? "" : h.toFixed(2),
      FENCE_SAID[s.startFence ?? ""] ?? "",
      s.endedAt ? FENCE_SAID[s.endFence ?? ""] ?? "" : "",
      s.propertyFrom === "fence" ? "Phone location"
        : s.propertyFrom === "chosen" ? "Picked by employee" : "",
      s.signedOffAt ? "Yes" : "No",
      status,
    ].map(cell).join(","));
  }

  if (totals.size) lines.push("");
  for (const [, t] of [...totals].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    lines.push([
      t.name, "", "TOTAL", "", "", "", "", t.hours.toFixed(2), "", "", "", "",
      t.open ? `${t.open} shift${t.open === 1 ? "" : "s"} not finished — not counted` : "",
    ].map(cell).join(","));
  }

  // CRLF, which is what RFC 4180 says and what Excel on Windows expects.
  return lines.join("\r\n") + "\r\n";
}

/** Hours by site for a set of shifts, named, biggest first. Untagged hours
 *  are their own line and are never spread across the others. */
export function hoursBySite(
  shifts: Shift[], sites: Site[], rules: Rules = RULES,
): { id: string | null; name: string; hours: number; people: number }[] {
  const names = new Map(sites.map((s) => [s.id, s.name]));
  const acc = new Map<string | null, { hours: number; people: Set<string> }>();
  for (const s of shifts) {
    const h = shiftHours(s, rules);
    if (h === null) continue;
    const k = s.propertyId ?? null;
    const a = acc.get(k) ?? { hours: 0, people: new Set<string>() };
    a.hours += h; a.people.add(s.staffId);
    acc.set(k, a);
  }
  return [...acc].map(([id, a]) => ({
    id,
    name: id === null ? "No site recorded" : names.get(id) ?? "Unknown site",
    hours: Math.round(a.hours * 100) / 100,
    people: a.people.size,
  })).sort((a, b) =>
    // The untagged line last: it is the prompt to go and fix, not a site.
    (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || b.hours - a.hours);
}
