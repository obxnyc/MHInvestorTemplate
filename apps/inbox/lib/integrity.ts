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

/** The text to the owner when somebody's hours went on the record without
 *  him pressing anything: his phone did it, his lead did it, or the office
 *  entered it. Each is fine and each is worth knowing -- the lead's above all,
 *  since "Jose would benefit from his guys getting more hours". */
export type OnBehalf =
  | { how: "auto"; name: string; site: string; at: string }
  | { how: "lead"; name: string; by: string; site: string | null; at: string;
      /** How far the presser's phone was from the job; null when unknown. */
      byMetres: number | null; byNoFix: boolean; out?: boolean }
  | { how: "office"; name: string; by: string; day: string; from: string; to: string };

export function onBehalfText(e: OnBehalf, link: string): string {
  switch (e.how) {
    case "auto":
      return `Auto: ${e.name} arrived at ${e.site} and his phone clocked him in, ${e.at}. ${link}`;
    case "lead": {
      const where = e.byNoFix ? `${e.by}'s phone had no location`
        : e.byMetres === null ? `${e.by}'s phone could not be checked against the job`
        : e.byMetres > 300 ? `${e.by} was ${mi(e.byMetres)} from the job`
        : `${e.by} was at the job`;
      return `${e.by} clocked ${e.name} ${e.out ? "out" : "in"}${e.site ? ` at ${e.site}` : ""}, ${e.at} (${where}). ${link}`;
    }
    case "office":
      return `${e.by} entered hours for ${e.name}: ${e.day}, ${e.from} to ${e.to}. ${link}`;
  }
}
