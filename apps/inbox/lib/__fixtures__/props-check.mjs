/** The properties screen: reaching one, and adding one.
 *
 *  A hundred and fourteen properties, and the only way to any of them
 *  was the scrollbar -- with "Add a property" as the very last element
 *  on the page, so adding one began by scrolling past every property
 *  you already own.
 *
 *  And one this caught by being looked at rather than read: the page
 *  header was given the class `prophead`, which has been the property
 *  CARD's header button since the screen was written. Redefining it put
 *  baseline alignment and wrapping onto all hundred and fourteen cards,
 *  and on a phone every park name came apart onto one word per line.
 *  Fourth time a class name has been borrowed in this stylesheet.
 *
 *      node apps/inbox/lib/__fixtures__/props-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const board = readFileSync(join(app, "components", "PropertyBoard.tsx"), "utf8");
const css = readFileSync(join(app, "app", "globals.css"), "utf8");

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    checks.push([name, false,
      String(e.message ?? e).replace(/\s+/g, " ").slice(0, 160)]);
  }
};

/** The balanced {...} at a marker, so a window cannot run into the next. */
function blockAt(src, marker, from = 0) {
  const at = src.indexOf(marker, from);
  if (at < 0) return "";
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

// ---- adding one does not start with scrolling ------------------------
/* Asked by POSITION. "Is there an Add a property button" was true the
   whole time the fault existed -- there was one, at the bottom. */
const addBtn = board.indexOf("Add a property");
const list = board.indexOf("{groups.map(");
t("there is a list and a way to add", () => addBtn > -1 && list > -1);
t("and adding one comes before the hundred and fourteen cards", () =>
  addBtn < list);

/* The FORM too, not just the button. Filling it in under the whole list
   meant scrolling back up to see whether it had worked. */
const form = board.indexOf("<AddProperty");
t("the form opens where the button is", () => form > -1 && form < list);
/* One control that OPENS the form, counted by the call rather than by
   the words -- the form carries its own "Add a property" heading, so
   matching the text found two and called a correct screen broken. */
t("and there is only one of each, not one at each end", () =>
  (board.match(/<AddProperty/g) ?? []).length === 1
  && (board.match(/setAdding\(true\)/g) ?? []).length === 1);

// ---- finding one -----------------------------------------------------
t("there is a search box", () => /className="propfind"/.test(board));
t("and it decides what the list shows", () => {
  const f = blockAt(board, "const found = useMemo(");
  return /properties\.filter/.test(f) && /find\.trim\(\)/.test(f);
});
/* "3107" is how somebody asks for a park they cannot name. A search
   that cannot answer that sends them back to the scrollbar. */
t("it searches the lot labels, not only the property", () => {
  const f = blockAt(board, "const found = useMemo(");
  return /p\.units\.some/.test(f)
    && ["p.name", "p.address", "p.owner", "p.code"].every((k) => f.includes(k));
});
/* The groups must read the FILTERED list. Grouping off the raw list is
   the Unread tab again: a control that looks like a filter and is not. */
t("grouping groups what the search left", () => {
  const g = board.slice(board.indexOf("const groups:"),
    board.indexOf("const totals ="));
  return /\[\[null, found\]\]/.test(g) && /of found\b/.test(g)
    && !/of properties\b/.test(g);
});
/* A list silently showing eleven of a hundred and fourteen is a list
   somebody reads as the whole of what they own. */
t("and the screen says how many the search left", () =>
  /found\.length\} of \{properties\.length\} match/.test(
    board.replace(/\s+/g, " ").replace(/`/g, "")) || /of \$\{properties\.length\} match/
    .test(board));

// ---- the class the page header borrowed ------------------------------
/* `.prophead` is the CARD's header button. The page header must not be
   it, or every card inherits the page title's layout. */
t("the card header keeps its own class", () =>
  (board.match(/className="prophead"/g) ?? []).length === 1);
t("and the page header has a different one", () =>
  /className="proptop"/.test(board) && /^\.proptop\{/m.test(css));
t("which the stylesheet does not confuse with the card", () => {
  /* Both are defined; the point is that they are two names, and that
     the page-header rule is not also written against `.prophead`. */
  const pageRule = blockAt(css, ".proptop{");
  const cardRule = blockAt(css, ".prophead{");
  return pageRule.length > 10 && cardRule.length > 10
    && pageRule !== cardRule;
});

/* And the phone layout the collision was hiding. A bare `1fr` or a bare
   `flex:1` will not shrink below the longest unbroken word, which is
   how "1140 Northside Road Mobile Home Community" burst its card. */
t("the card has a layout for a phone", () => {
  const at = css.indexOf("@media (max-width: 560px)");
  const block = at < 0 ? "" : blockAt(css, "{", at);
  return /\.prophead\{display:grid/.test(block)
    && /grid-template-areas/.test(block);
});
/* COMMENTS STRIPPED FIRST, and anchored on the declaration. The rule
   above carries a comment explaining why `minmax(0,1fr)` is needed, and
   the first version of this check matched that sentence -- so deleting
   the declaration left the explanation behind and the guard passed on
   the fault. Same lesson as anchoring on the call rather than the
   words, which cost a round in inside-check. */
t("and its name column is allowed to shrink", () => {
  const at = css.indexOf("@media (max-width: 560px)");
  const bare = (at < 0 ? "" : blockAt(css, "{", at))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return /grid-template-columns:[^;]*minmax\(\s*0\s*,\s*1fr\s*\)/.test(bare)
    && /\.propname\{[^}]*min-width:\s*0/.test(bare);
});

let bad = 0;
for (const [name, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("a property is findable, and adding one does not begin with a scroll");
