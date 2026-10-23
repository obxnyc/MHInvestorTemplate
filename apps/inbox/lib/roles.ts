/**
 * Who works here, in one place.
 *
 * This list was hardcoded in six: four API routes, the people screen's
 * labels, the sign-in keypad's roster and the header's own type. Adding
 * `crew` to the database enum in migration 038 therefore changed nothing a
 * person could see -- the role existed and no screen would set it, which is
 * the quietest kind of half-shipped there is.
 *
 * So the list lives here, and `roles.test.mjs` checks it against the enum in
 * the migrations rather than trusting either. The same arrangement the fence
 * radii have with the property kinds, and for the same reason: two lists that
 * must agree and no one place that says so will drift, and the drift is
 * invisible until somebody cannot be given a job.
 */

export const ROLES = ["admin", "office", "tech", "shower", "crew", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  office: "Office",
  tech: "Maintenance",
  shower: "Showings",
  crew: "Crew",
  viewer: "Read only",
};

/**
 * The sentence beside each role on the pickers.
 *
 * Here rather than in the markup because it was in the markup twice -- the
 * invite form and the add form -- and both lists stopped at `shower`. Two
 * copies of a list is how a role gets added to four files and missed in the
 * two that decide whether anybody can ever be given it.
 */
export const ROLE_BLURB: Record<Role, string> = {
  office: "the inbox, leasing, tenants",
  admin: "everything, including filings and the audit trail",
  tech: "work orders assigned to them",
  shower: "prospects and viewings",
  crew: "hourly on site — clocks in and out, nothing else",
  viewer: "can look at everything and change nothing",
};

/** What to call a role on screen.
 *
 *  Takes a plain string, because a row out of the database is typed `string`
 *  and the point of this function is the case where it is a role nobody has
 *  taught the app about yet -- a value added to the enum by a migration that
 *  shipped ahead of the code. Showing the raw word beats showing nothing.
 */
export const labelOf = (role: string): string =>
  (ROLE_LABEL as Record<string, string>)[role] ?? role;

/**
 * Staff who are out at a property rather than at a desk.
 *
 * What this decides: who appears on the sign-in keypad, who gets a four-digit
 * PIN instead of a password, and who is grouped as field staff on the people
 * screen. Crew belong here -- a labourer has a phone and a glove, not an
 * email address and a laptop.
 */
export const FIELD: Role[] = ["tech", "shower", "crew"];

export const isField = (v: unknown): boolean =>
  isRole(v) && FIELD.includes(v);

export const isRole = (v: unknown): v is Role =>
  typeof v === "string" && (ROLES as readonly string[]).includes(v);

/**
 * The desk.
 *
 * Who the office is, for "notify whoever is on" and "who may change this".
 * Written out by hand in `push.ts` and the autoclose cron before this, which
 * is the same drift in a smaller place: the day a fifth role joins the desk,
 * one of the two gets it and the other does not, and nobody finds out until
 * somebody stops being told about something.
 */
export const DESK: Role[] = ["admin", "office"];

export const isDesk = (v: unknown): boolean => isRole(v) && DESK.includes(v as Role);

/** Roles whose whole use of this application is the clock.
 *
 *  Crew have no business in the shared inbox: it carries tenants' messages,
 *  and somebody who is here to say they have started work does not need to
 *  read them. */
export const CLOCK_ONLY: Role[] = ["crew"];

export const isClockOnly = (v: unknown): boolean =>
  isRole(v) && CLOCK_ONLY.includes(v);

/**
 * A guest who can only look.
 *
 * Reads every screen an office account can and is refused every write, in the
 * proxy, by HTTP method -- not by hiding buttons. A hidden button is a
 * suggestion: the route behind it is still a URL and a fetch away, and
 * somebody poking round a live system is precisely who finds that out.
 *
 * Deliberately NOT in DESK: that list decides who is treated as office staff,
 * and a viewer is a visitor. Not in FIELD either -- no PIN, no keypad.
 */
export const isViewer = (v: unknown): boolean => v === "viewer";

/**
 * May this person LOOK at the office's screens?
 *
 * Desk staff, and a read-only guest. Separate from `isDesk` on purpose: that
 * one answers "is this somebody who works here", which decides things like
 * who a job can be assigned to, and a visitor is not that.
 *
 * The four screens that asked `role !== "admin" && role !== "office"` each
 * asked it in their own words, which is how a role gets added and missed in
 * the places that decide whether anybody can ever see it -- the same reason
 * ROLE_BLURB exists in this file rather than in two forms.
 *
 * Nothing about writing is decided here. That is refused in the proxy, by
 * method, for every route at once.
 */
export const canSeeOffice = (role: unknown): boolean =>
  isDesk(role) || isViewer(role);
