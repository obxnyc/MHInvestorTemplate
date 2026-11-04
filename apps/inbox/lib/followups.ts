/**
 * The follow-ups a leasing enquiry earns, and the reasons not to send them.
 *
 * Pure. Which touches to plan, when, whether one is still worth sending at
 * the moment it comes due, and what it says. The sending lives in
 * pipeline.ts; everything that decides lives here, so it can be tested
 * without a phone line.
 *
 * The rule the whole file is built round is the one NURTURE.md ends on: the
 * interesting logic is in what you refuse to send. A follow-up is planned
 * the moment its reason arises and then asked AGAIN when it comes due --
 * because "you have not answered the questions yet" is a lie to somebody who
 * answered them an hour ago, and a reminder for a showing that was cancelled
 * is how a prospect drives to an empty lot.
 */

export type Stage =
  | "new" | "invited" | "prequalified" | "review" | "declined"
  | "booked" | "shown" | "no_show" | "applied";

export const STAGES: { key: Stage; said: string }[] = [
  { key: "new", said: "Just arrived" },
  { key: "invited", said: "Sent the questions" },
  { key: "review", said: "Needs a look" },
  { key: "prequalified", said: "Prequalified" },
  { key: "declined", said: "Did not meet criteria" },
  { key: "booked", said: "Showing booked" },
  { key: "shown", said: "Shown" },
  { key: "no_show", said: "Did not come" },
  { key: "applied", said: "Applied" },
];

export type Kind =
  | "invite_nudge_1" | "invite_nudge_2"
  | "book_nudge_1" | "book_nudge_2"
  | "showing_day_before" | "showing_soon"
  | "after_showing"
  | "still_looking";

const H = 3600_000;
const D = 24 * H;

/** What each event plans, as offsets from the moment it happened (or, for a
 *  showing, from when it starts). */
export function planFor(
  event: "invited" | "prequalified" | "booked",
  at: Date,
  now: Date = new Date(),
): { kind: Kind; due: Date }[] {
  const t = at.getTime();
  const plan: { kind: Kind; due: Date }[] =
    event === "invited" ? [
      { kind: "invite_nudge_1", due: new Date(t + 1 * D) },
      { kind: "invite_nudge_2", due: new Date(t + 3 * D) },
      // NURTURE.md: ask how it ended rather than guessing from silence.
      { kind: "still_looking", due: new Date(t + 14 * D) },
    ]
    : event === "prequalified" ? [
      { kind: "book_nudge_1", due: new Date(t + 1 * D) },
      { kind: "book_nudge_2", due: new Date(t + 3 * D) },
    ]
    : [
      { kind: "showing_day_before", due: new Date(t - 1 * D) },
      { kind: "showing_soon", due: new Date(t - 2 * H) },
      { kind: "after_showing", due: new Date(t + 3 * H) },
    ];
  // A reminder whose moment has already gone is not sent late -- a showing
  // booked for this afternoon does not get a "see you tomorrow" text. The
  // booking confirmation covers it.
  return plan.filter((p) => p.due.getTime() > now.getTime() + 5 * 60000);
}

/** Kinds that only make sense against one showing. */
export const SHOWING_KINDS = new Set<Kind>(["showing_day_before", "showing_soon", "after_showing"]);

export type State = {
  stage: Stage;
  outcome: string;               // inquiries.outcome; anything but 'open' is closed
  optedOut: boolean;             // said STOP, or the like, on the channel in question
  showingStatus?: string | null; // for the showing kinds
  hasUpcomingShowing?: boolean;
};

/**
 * Should this go out now? Answered at send time, never at plan time.
 *
 * Every refusal names its reason, because a follow-up that silently did not
 * go is indistinguishable from one that went and was ignored.
 */
export function stillDue(kind: Kind, s: State): { send: true } | { send: false; reason: string } {
  if (s.outcome !== "open") return { send: false, reason: `inquiry closed (${s.outcome})` };
  if (s.optedOut) return { send: false, reason: "they asked not to be contacted" };

  switch (kind) {
    case "invite_nudge_1":
    case "invite_nudge_2":
      return s.stage === "invited" || s.stage === "new"
        ? { send: true } : { send: false, reason: `already past the questions (${s.stage})` };
    case "book_nudge_1":
    case "book_nudge_2":
      return s.stage === "prequalified"
        ? { send: true } : { send: false, reason: `no longer waiting to book (${s.stage})` };
    case "showing_day_before":
    case "showing_soon":
      return s.showingStatus === "booked" || s.showingStatus === "confirmed"
        ? { send: true } : { send: false, reason: `showing is ${s.showingStatus ?? "gone"}` };
    case "after_showing":
      // Not after a no-show the office has already marked: they got the
      // rebooking message at that moment, and "hope you liked it" to
      // somebody who did not come reads as nobody paying attention.
      return s.showingStatus === "booked" || s.showingStatus === "confirmed"
          || s.showingStatus === "shown"
        ? { send: true } : { send: false, reason: `showing is ${s.showingStatus ?? "gone"}` };
    case "still_looking":
      return ["booked", "shown", "applied"].includes(s.stage) || s.hasUpcomingShowing
        ? { send: false, reason: `still in play (${s.stage})` } : { send: true };
  }
}

/**
 * Quiet hours: 8am to 9pm where the person is.
 *
 * NURTURE.md: "a scheduled job at 6am is exactly how that gets violated. Put
 * the check in the send path." Returns null when now is fine, or the next
 * moment that is.
 */
export function quietUntil(now: Date, zone: string, from = 8, to = 21): Date | null {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "numeric", hourCycle: "h23",
  }).format(now));
  if (hour >= from && hour < to) return null;
  // Step forward a quarter-hour at a time; at most 11 hours, so at most 44
  // steps, and it needs no arithmetic that a clock change could break.
  let t = now.getTime();
  for (let i = 0; i < 60; i++) {
    t += 15 * 60000;
    const h = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hour: "numeric", hourCycle: "h23",
    }).format(new Date(t)));
    if (h >= from && h < to) return new Date(t);
  }
  return new Date(now.getTime() + 12 * H);
}

export type Words = {
  first: string | null;
  home: string;
  prescreenUrl?: string | null;
  bookUrl?: string | null;
  manageUrl?: string | null;
  applyUrl?: string | null;
  when?: string | null;
  address?: string | null;
};

const hi = (w: Words) => (w.first ? `Hi ${w.first}, ` : "Hi, ");

/**
 * What each one says. Short enough for one text where it matters, names the
 * business in the first clause, and always carries the one link that moves
 * them on -- a follow-up that asks somebody to do work without handing them
 * the means is a follow-up that gets ignored.
 */
export function words(kind: Kind | "invite" | "booked" | "no_show" | "cancelled", w: Words):
  { subject: string; text: string } {
  switch (kind) {
    case "invite":
      return {
        subject: `Next step for ${w.home}`,
        text: `${hi(w)}thanks for asking about ${w.home} — this is Larabee Homes. `
          + `We ask everyone the same few prescreening questions before a showing. `
          + `It takes about two minutes, there is no credit check, and if you meet our `
          + `criteria you can pick a showing time straight away: ${w.prescreenUrl}`,
      };
    case "invite_nudge_1":
      return {
        subject: `Still interested in ${w.home}?`,
        text: `${hi(w)}Larabee Homes here. ${w.home} is still available. `
          + `The two-minute questions are the only thing between you and a showing time: `
          + `${w.prescreenUrl}`,
      };
    case "invite_nudge_2":
      return {
        subject: `Last note about ${w.home}`,
        text: `${hi(w)}Larabee Homes, last note from us about ${w.home}. If you'd still like `
          + `to see it, start here: ${w.prescreenUrl} — and if your plans changed, no problem.`,
      };
    case "book_nudge_1":
      return {
        subject: `Pick a time to see ${w.home}`,
        text: `${hi(w)}Larabee Homes here — you're prequalified for ${w.home}. `
          + `Pick a showing time whenever suits you: ${w.bookUrl}`,
      };
    case "book_nudge_2":
      return {
        subject: `Your showing link for ${w.home}`,
        text: `${hi(w)}your prequalification for ${w.home} is still good. `
          + `Showing times: ${w.bookUrl} — Larabee Homes`,
      };
    case "booked":
      return {
        subject: `Showing confirmed — ${w.home}`,
        text: `Larabee Homes: your showing at ${w.home} is booked for ${w.when}.`
          + (w.address ? ` Address: ${w.address}.` : "")
          + ` Need to change it? ${w.manageUrl}`,
      };
    case "showing_day_before":
      return {
        subject: `Tomorrow: your showing at ${w.home}`,
        text: `Larabee Homes: reminder, your showing at ${w.home} is ${w.when}. `
          + `Reply YES to confirm, or change it here: ${w.manageUrl}`,
      };
    case "showing_soon":
      return {
        subject: `Soon: your showing at ${w.home}`,
        text: `Larabee Homes: see you at ${w.when} for ${w.home}`
          + (w.address ? `, ${w.address}` : "")
          + `. Running late or can't make it? ${w.manageUrl}`,
      };
    case "after_showing":
      return {
        subject: `Thanks for looking at ${w.home}`,
        text: `${hi(w)}thanks for seeing ${w.home} with Larabee Homes. `
          + (w.applyUrl
            ? `If you'd like it, the application is here: ${w.applyUrl}. `
            : `If you'd like it, reply and we'll send the application. `)
          + `Couldn't make it? Pick another time: ${w.manageUrl}`,
      };
    case "no_show":
      return {
        subject: `We missed you at ${w.home}`,
        text: `${hi(w)}Larabee Homes — we missed you at ${w.home}. `
          + `Things come up. Pick another time here: ${w.bookUrl}`,
      };
    case "cancelled":
      return {
        subject: `Showing cancelled — ${w.home}`,
        text: `Larabee Homes: your showing at ${w.home} is cancelled. `
          + `Want another time? ${w.bookUrl}`,
      };
    case "still_looking":
      return {
        subject: `Did you find a place?`,
        text: `${hi(w)}Larabee Homes here — you asked about ${w.home} a couple of weeks back. `
          + `Did you find somewhere? A one-word reply helps us a lot, and if you're still `
          + `looking we can tell you what's coming open.`,
      };
  }
}

/** The first word of a name, for "Hi Dana". Nothing if it does not look like
 *  a name -- "Hi 4pbz7k" is worse than "Hi". */
export function firstName(full: string | null | undefined): string | null {
  const w = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{1,30}$/.test(w) ? w[0].toUpperCase() + w.slice(1) : null;
}

/** Is this inbound text a yes to "reply YES to confirm"? Strict on purpose:
 *  "yes but can we move it" is not a confirmation. */
export function saysYes(body: string): boolean {
  return /^\s*(y|yes|yep|yeah|yes!|confirm|confirmed|ok|okay|👍)\s*[.!]*\s*$/i.test(body);
}
