/**
 * Transferring a call by text, from the phone that is on it.
 *
 * Once a call is connected the keypad no longer reaches the app -- Twilio
 * bridges the two phones and listens to neither -- so a cell phone cannot
 * press a key to transfer. It can send a text. Whoever is on a call texts the
 * office line "transfer Samantha" or "transfer leasing", and the caller moves.
 * Works from any phone on the list, app or no app.
 *
 * Pure, so it can be tested without a database.
 */

export type Target = { personId: string } | { routeKey: string };

/** "transfer samantha", "xfer leasing". Not a bare "t": a staff text that
 *  starts "T-Mobile says..." is a message, not an instruction. */
const COMMAND = /^\s*(?:transfer|xfer)\b\s*(.*)$/i;

/** Words a person might text for a team, mapped to the route that rings it. */
const TEAMS: [RegExp, string][] = [
  [/^(leas|rent)/i, "rent"],
  [/^(sale|buy)/i, "buy"],
  [/^(emerg|on.?call)/i, "emergency"],
  [/^(sell|offer|invest)/i, "seller"],
  [/^(vend|contract)/i, "vendor"],
  [/^(pay|rent pay)/i, "payments"],
  [/^(office|front|desk|team|every)/i, "general"],
];

export function parseTransfer(body: string): string | null {
  const m = COMMAND.exec(body ?? "");
  return m ? m[1].trim() : null;
}

/** Who or what "samantha" / "leasing" means. A person's first name, or the
 *  start of it, wins over a team; two people matching is not a guess. */
export function resolveTarget(
  word: string, people: { id: string; name: string }[],
): { target: Target; label: string } | { error: string } {
  const w = word.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (!w) return { error: "Say who to: \"transfer Samantha\" or \"transfer leasing\"." };
  const hits = people.filter((p) =>
    p.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(w))
    || p.name.toLowerCase().startsWith(w));
  if (hits.length === 1) return { target: { personId: hits[0].id }, label: hits[0].name };
  if (hits.length > 1) return { error: `"${word}" could be ${hits.map((h) => h.name).join(" or ")}. Text the full name.` };
  const team = TEAMS.find(([re]) => re.test(w));
  if (team) return { target: { routeKey: team[1] }, label: team[1] };
  return { error: `Nobody called "${word}" on the phone list. Try a first name, or "leasing", "office", "sellers".` };
}
