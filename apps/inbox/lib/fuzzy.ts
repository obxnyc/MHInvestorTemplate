/**
 * Finding a thing when you cannot spell it and do not know where it lives.
 *
 * The point of the search bar is somebody who does not know which screen to
 * click. So "northsde", "cross crk", "3114", "colgate" and "timesheet" all
 * have to land somewhere sensible, and the one answer that is never
 * acceptable is an empty box with no explanation -- that is the screen
 * telling somebody their park does not exist.
 *
 * TIERS, NOT ONE SCORE. A match on the start of a name and a match two edits
 * away are different kinds of answer, and sorting them by one number puts
 * "Cross Creek" below "Crescent" for the query "cross" as soon as the
 * arithmetic is tuned for typos. So the tier decides the order and the
 * distance only breaks ties inside a tier.
 *
 * AND A TYPO IS NOT A SUBSTRING. "northsde" contains no useful substring of
 * "1140 Northside Rd" -- it has to be the edit distance that catches it, and
 * only on the words, because measuring it against the whole string lets a
 * long name absorb any query at all.
 */

export type Hit<T> = {
  item: T;
  score: number;
  /** Which rule matched, for the "did you mean" line and for the harness. */
  how: "exact" | "prefix" | "word" | "contains" | "initials" | "typo";
};

const fold = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s#]/g, " ").replace(/\s+/g, " ").trim();

const words = (s: string) => fold(s).split(" ").filter(Boolean);

/**
 * Edit distance, with a ceiling.
 *
 * Bounded because the answer "more than two edits away" is the only thing
 * this is asked, and computing 14 to find out is work nobody reads. The
 * early exit also stops a long name being compared character by character
 * against every row on every keystroke.
 */
export function editsWithin(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  if (a === b) return 0;

  // Damerau, not plain Levenshtein: a transposition costs ONE, not two.
  // "teh" for "the" and "recieve" for "receive" are the commonest typos
  // there are, and at two edits each they fall outside the slack for every
  // word short enough for the slack to matter.
  let twoBack: number[] | null = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && twoBack
          && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1);
      }
      row.push(v);
      if (v < best) best = v;
    }
    // An optimisation, not a guard: the bound below returns the same answer
    // without it. It is here so a long name is not compared character by
    // character against every row on every keystroke, and no check can tell
    // the two versions apart because there is nothing to tell.
    if (best > max) return null;
    twoBack = prev;
    prev = row;
  }
  const d = prev[b.length];
  return d <= max ? d : null;
}

/** How wrong a word of this length is allowed to be. One edit is a slip; two
 *  is a slip in a long word; three is a different word. */
export const slack = (n: number) => (n <= 3 ? 0 : n <= 5 ? 1 : 2);

/**
 * Is this part of a query a believable attempt at this word?
 *
 * Two different mistakes, and only one of them is a typo.
 *
 * A TYPO is a slip: a letter wrong, doubled or dropped. Edit distance is
 * exactly the right measure and the slack is small, because "lot" and "lit"
 * are both words and a matcher that joins them is worse than one that does
 * not.
 *
 * AN ABBREVIATION is letters deliberately left out: "crk" for "creek", "mgmt"
 * for "management", "nthsd" for "northside". That is three or four edits away
 * and no amount of slack reaches it without also joining everything else. It
 * is a SUBSEQUENCE -- every letter present, in order -- and the two guards
 * that keep it honest are the shared first letter, because nobody abbreviates
 * by changing the first letter, and a floor of three, because two letters in
 * order are inside almost every word in the language.
 */
function nearWord(part: string, word: string): number | null {
  const d = editsWithin(part, word, slack(Math.max(part.length, word.length)));
  if (d !== null) return d;

  if (part.length < 3 || part[0] !== word[0] || part.length >= word.length) return null;
  let i = 0;
  for (const ch of word) if (ch === part[i]) i++;
  // Ranked below any real typo match, because dropping four letters is a
  // bigger claim about what somebody meant than mistyping one.
  return i === part.length ? 3 : null;
}

/** "ccmhp" for "Cross Creek Mobile Home Park".
 *
 *  The two-letter floor is belt and braces rather than a live rule: a single
 *  letter can only be the first initial of a name that starts with it, and
 *  the prefix tier above catches that first, so no fixture can tell this
 *  line's presence from its absence. It stays because the day somebody
 *  reorders the tiers it stops being dead. */
function initials(q: string, text: string): boolean {
  if (q.length < 2) return false;
  const first = words(text).map((w) => w[0]).join("");
  return first.startsWith(q);
}

/**
 * Score one candidate, or null when it does not match at all.
 *
 * The tiers are a hundred apart so nothing inside a tier can ever outrank
 * something in the tier above it, however long the name.
 */
export function score(query: string, text: string): Hit<string> | null {
  const q = fold(query);
  const t = fold(text);
  if (!q || !t) return null;

  const shorter = (n: number) => Math.max(0, 40 - n);   // a tie-break, never a tier

  if (q === t) return { item: text, score: 600, how: "exact" };
  if (t.startsWith(q)) return { item: text, score: 500 + shorter(t.length), how: "prefix" };

  const ws = words(t);
  if (ws.some((w) => w.startsWith(q))) {
    return { item: text, score: 400 + shorter(t.length), how: "word" };
  }
  if (initials(q, text)) return { item: text, score: 350, how: "initials" };
  if (t.includes(q)) return { item: text, score: 300 + shorter(t.length), how: "contains" };

  // The typo tier. Measured word by word: against the whole string, a long
  // name has enough characters to absorb any query, so "1140 Northside Road
  // Mobile Home Community" would match "timesheet".
  let best: number | null = null;
  for (const w of ws) {
    const d = nearWord(q, w);
    if (d !== null && (best === null || d < best)) best = d;
  }
  // And against the query as a whole phrase, so "cross crk" finds
  // "Cross Creek" -- two words each one edit out, which word-by-word scoring
  // on its own would never join up.
  const qs = words(query);
  if (qs.length > 1 && best === null) {
    // Every part has to land somewhere, and the worst of them sets the
    // score -- "cross crk" is as good as its weaker half, not its stronger.
    let worst = 0;
    const every = qs.every((part) => {
      let d: number | null = null;
      for (const w of ws) {
        const n = nearWord(part, w);
        if (n !== null && (d === null || n < d)) d = n;
      }
      if (d === null) return false;
      worst = Math.max(worst, d);
      return true;
    });
    if (every) best = worst;
  }

  return best === null ? null : { item: text, score: 200 - best * 10, how: "typo" };
}

export type Candidate<T> = { item: T; text: string; also?: string[] };

/**
 * Rank a list.
 *
 * `also` is the other words a thing can be found by -- a lot's park name, a
 * page's synonyms ("hours", "payroll" and "clock" all mean the timesheet) --
 * scored separately and kept at its own best, so a thing is never promoted
 * for matching two of its own aliases.
 */
export function rank<T>(query: string, list: Candidate<T>[], limit = 8): Hit<T>[] {
  const out: Hit<T>[] = [];
  for (const c of list) {
    let best: Hit<string> | null = score(query, c.text);
    for (const alt of c.also ?? []) {
      const s = score(query, alt);
      // An alias is a weaker way to be found than your own name, or a lot
      // numbered 12 outranks the park called 12th Street for "12".
      if (s && (best === null || s.score - 25 > best.score)) {
        best = { ...s, score: s.score - 25 };
      }
    }
    if (best) out.push({ item: c.item, score: best.score, how: best.how });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The nearest thing, for "nothing matched — did you mean …".
 *
 * Deliberately looser than `rank`: this runs only when nothing matched at
 * all, so the cost of a wrong guess is a suggestion somebody ignores, and
 * the cost of no guess is a person who thinks their park is missing.
 */
export function didYouMean(query: string, list: { text: string }[]): string | null {
  const q = fold(query);
  if (q.length < 3) return null;
  let best: { text: string; d: number } | null = null;
  for (const c of list) {
    for (const w of words(c.text)) {
      const d = editsWithin(q, w, 3);
      if (d !== null && (!best || d < best.d)) best = { text: c.text, d };
    }
  }
  return best?.text ?? null;
}
