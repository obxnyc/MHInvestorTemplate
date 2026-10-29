/**
 * Putting the investor's mark on the document they were sent.
 *
 * The pack is frozen as HTML the moment it is sent, and that frozen copy
 * is the document of record: regenerating it at signing time would mean a
 * change to this codebase could change what somebody had already agreed
 * to, which is the one thing a contract may not do.
 *
 * So signing is a substitution on that exact text, into slots that were
 * marked when it was frozen. Deterministic, and it cannot invent a place
 * to put a signature that the sender did not put there.
 */

/** The slots, as `papers.ts` writes them. */
const SLOT = /<span class="signslot" data-for="([a-z]+)">[\s\S]*?<\/span>/g;
const DATE = /<span class="dateslot" data-for="([a-z]+)">[\s\S]*?<\/span>/g;

export type Counter = {
  /** Their signature, a PNG as a data URL. */
  png: string;
  /** The day they signed, yyyy-mm-dd. */
  on: string;
};

const stamp = (iso: string): string => {
  const [y, m, d] = (iso || "").split("-");
  return (y && m && d) ? `${m}/${d}/${y}` : "__________________";
};

/** How many places this document is waiting to be signed in. */
export function slotsIn(html: string): number {
  return (html.match(SLOT) ?? []).length;
}

/**
 * The signed document.
 *
 * Every slot is filled, because a pack signed in some places and not
 * others is not a thing anybody asked for -- the signer is agreeing to
 * the pack, and the pack is what they were sent.
 */
export function countersign(html: string, by: Counter): string {
  const img = `<img class="sigink" src="${by.png}" alt="Signature">`;
  return html
    .replace(SLOT, img)
    .replace(DATE, stamp(by.on));
}
