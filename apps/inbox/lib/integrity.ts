/**
 * The clock-ins somebody should look at, and who is told.
 *
 * "It would need to get flagged to ME. Jose would benefit from his guys
 *  getting more hours ... hence he gets to monitor the hours so he also at
 *  the same time can't argue they got more hours than they did." The owner.
 *
 * So these go to whoever is ticked for integrity alerts on Crews & texts --
 * the owner -- as they happen, and not only into the crew lead's report. A
 * check the person being checked controls is not a check.
 *
 * Pure: what happened at the clock-in goes in, the reasons to look come out,
 * with the words for the text. Each reason is its own case so a rule cannot
 * hide behind another one.
 */

export type ClockInFacts = {
  name: string;
  site: string | null;
  /** How far the phone was from the chosen job, when that could be told. */
  farMetres: number | null;
  /** No position at all. */
  noFix: boolean;
  /** Photos were taken instead of a position. */
  photos: number;
  /** Other crew members who have clocked in on this same phone lately. */
  phoneUsedBy: string[];
  /** This man has clocked in before, and never on this phone. */
  newPhone: boolean;
};

export type Reason = "far" | "nofix" | "buddy-phone" | "new-phone";

export function reasons(f: ClockInFacts): Reason[] {
  const out: Reason[] = [];
  // Another man's phone is the buddy case itself, and outranks everything.
  if (f.phoneUsedBy.length) out.push("buddy-phone");
  else if (f.newPhone) out.push("new-phone");
  if (f.noFix) out.push("nofix");
  else if (f.farMetres !== null) out.push("far");
  return out;
}

const mi = (m: number) => {
  const miles = m / 1609.344;
  return miles < 0.2 ? `${Math.round(m * 3.28084 / 50) * 50} ft` : `${miles.toFixed(1)} mi`;
};

/** The text to the owner. One message, every reason in it. */
export function alertText(f: ClockInFacts, at: string, link: string): string | null {
  const rs = reasons(f);
  if (!rs.length) return null;
  const where = f.site ?? "no job chosen";
  const bits = rs.map((r) => {
    switch (r) {
      case "buddy-phone": return `on the same phone ${f.phoneUsedBy.join(", ")} uses`;
      case "new-phone": return "on a phone he has never used before";
      case "nofix": return f.photos ? "with no location (photos taken)" : "with no location";
      case "far": return `${mi(f.farMetres!)} from the job`;
    }
  });
  return `Check: ${f.name} clocked in at ${where}, ${at}, ${bits.join(" and ")}. ${link}`;
}

/** The text to the owner when the clock closed a shift nobody closed. */
export function forgotText(name: string, endedAt: string, link: string): string {
  return `Check: ${name} did not clock out; the clock closed his shift at ${endedAt}. ${link}`;
}
