/** What has been sent, and what comes back signed.
 *
 *  Two faults, both of the shape this repo keeps finding: a thing that
 *  exists and cannot be reached, and a state reported by asking a
 *  narrower question than the one that matters.
 *
 *  The list of what had gone out lived INSIDE the send panel -- and that
 *  panel opens off a button disabled until homes are ticked, so on an
 *  investor whose pack had already gone there was no path to it at all.
 *  Two packs sat against ALDERCREST with nothing on any screen saying so.
 *
 *  And the signing link expired a fortnight after it was sent whether or
 *  not it had been signed, so the investor's only copy of their own
 *  executed contract stopped opening. The fortnight is the window to
 *  sign in, not a lease on the right to read what you signed.
 *
 *      node apps/inbox/lib/__fixtures__/vault-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    checks.push([name, false,
      String(e.message ?? e).replace(/\s+/g, " ").slice(0, 180)]);
  }
};

const screen = readFileSync(join(app, "components", "OwnerScreen.tsx"), "utf8");
const sign = readFileSync(
  join(app, "app", "api", "sign", "[token]", "route.ts"), "utf8");
const sent = readFileSync(
  join(app, "app", "api", "owners", "[id]", "sent", "route.ts"), "utf8");
const css = readFileSync(join(app, "app", "globals.css"), "utf8");

// ---- the list is reachable ------------------------------------------
/**
 * The balanced `{...}` starting at a marker.
 *
 * A fixed-length window past the marker reads on into whatever follows,
 * and the thing it is looking for is very often there -- which is how
 * "only for this investor's own packs" passed with the filter deleted,
 * having found the identical filter in the NEXT query down. Same family
 * as the sign-off anchor that matched the `.eq` in the block after it.
 */
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

/** Every `{papers && (` panel on the screen, whole. */
const paperPanels = (() => {
  const out = [];
  for (let i = screen.indexOf("{papers && ("); i >= 0;
       i = screen.indexOf("{papers && (", i + 1)) {
    out.push(blockAt(screen, "{papers && (", i));
  }
  return out;
})();

/* Cut the send panel out and look for the list INSIDE it. Asking whether
   the list exists at all is the question that was already true while the
   fault was there -- it existed, behind a door nobody could open. */
const panel = blockAt(screen, "{sending && (");

t("there is a send panel to look inside", () => panel.length > 200);
t("what has been sent is NOT buried in it", () => !/sentlist/.test(panel));
t("and is on the page in its own right", () => /className="sentlist"/.test(screen));

/* It must not be behind the sale-papers panel either, which is the same
   fault one door further out: that panel opens off a button, and a list
   you have to press something to see is a list nobody knows exists. */
t("there are sale-papers panels to look inside", () => paperPanels.length > 0);
t("nor behind any of them", () => paperPanels.every((b) => !/sentlist/.test(b)));

/* A signed pack has to be readable from the office, not merely reported
   as signed. Anchored on the href rather than on the words. */
const packPage = readFileSync(
  join(app, "app", "(app)", "owners", "[id]", "pack", "[req]", "page.tsx"),
  "utf8");

t("a pack that went out can be opened from the office", () =>
  /href=\{`\/owners\/\$\{ownerId\}\/pack\/\$\{r\.id\}`\}/.test(screen));

/* A PAGE AND NOT A FILE. The pack is a fragment that has always leaned
   on `.paper` in globals.css for its margins, its page breaks and its
   signature lines; handed over as a blob it arrives with no stylesheet
   and no charset, and sixteen contracts rendered as
   "SELLER:SignatureLarabee Homes LLC" with every curly quote mangled. */
t("and not handed over as a bare file", () => !/createObjectURL/.test(
  blockAt(screen, "{sent.length > 0 && (") || screen.slice(
    screen.indexOf('className="sentlist"') - 400,
    screen.indexOf('className="sentlist"') + 3000)));
t("it is rendered where the stylesheet is", () =>
  /className="paper\b[^"]*"/.test(packPage)
  && /dangerouslySetInnerHTML/.test(packPage));

/* Scoped to this owner AND this request, or an id lifted from another
   deal reads back somebody else's contract. */
t("only for this investor's own packs", () =>
  /\.eq\("owner_id", id\)\.eq\("id", req\)/.test(packPage));

/* Office screens only. A read-only guest may look; a tenant may not. */
t("and only by somebody who works here", () =>
  /canSeeOffice\(staff\.role\)/.test(packPage) && /redirect\("\/"\)/.test(packPage));

/* The office reads the document; it has no need of the key to the
   investor's own door, and a token on a page is a token in a screenshot. */
t("and the token is never put on the page", () => !/token/.test(packPage));

/* A select built by concatenation makes every field on the result an
   error rather than a column -- it typechecks as far as the query and
   fails on every read. In CLAUDE.md, and done again anyway. */
/* IT HAS TO READ AS SHEETS. The separators papers.ts puts between the
   documents drew as nothing on screen, so sixteen contracts arrived as
   one continuous roll of white -- "it should look more like a pdf". */
t("the pack is drawn as sheets, not as one roll", () =>
  /className="paper sheets"/.test(packPage));
/* OUTSIDE @media print. The print block carries a rule of the same name
   -- the one that takes the strip back off -- so asking the whole
   stylesheet whether `.paper.sheets .pagebreak` exists finds that one
   and passes while the screen draws nothing at all. Third time an anchor
   has found what it wanted in the next block down. */
const cssScreen = (() => {
  let out = "", depth = 0, keep = true;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@media print", i) && depth === 0) keep = false;
    if (css[i] === "{") depth++;
    else if (css[i] === "}") { depth--; if (depth === 0 && !keep) { keep = true; continue; } }
    if (keep) out += css[i];
  }
  return out;
})();

t("the screen rule exists, not just the print one", () =>
  /\.paper\.sheets \.pagebreak\{/.test(cssScreen));

/* And inside THAT rule, not anywhere in the stylesheet: `--sunk` is a
   common ground and asking the whole file whether it is used passes
   with the strip left transparent. */
t("and the strip is actually given a ground", () => {
  const rule = blockAt(cssScreen, ".paper.sheets .pagebreak{");
  return /background:var\(--[a-z-]+\)/.test(rule) && /box-shadow:inset/.test(rule);
});

/* AND NOT IN PRINT. A grey strip down the middle of a contract is worse
   than no strip at all, and `break-before:page` is what the separator is
   there for in the first place. */
t("the strip is taken off for printing", () => {
  const at = css.indexOf("@media print{");
  const block = at < 0 ? "" : css.slice(at, css.indexOf("}\n", css.indexOf(
    ".paper.sheets{box-shadow:none", at)) + 2);
  return /\.paper\.sheets \.pagebreak\{height:0/.test(block)
    && /background:none/.test(block);
});

/* The app's own header and the explanation above the document are not
   part of the document. */
t("the app's chrome is kept off the paper", () => {
  const head = packPage.slice(packPage.indexOf("<header"),
    packPage.indexOf("</header>"));
  return /className="parkhead noprint"/.test(head)
    && /className="dim noprint"/.test(packPage);
});

/* Chrome and Safari print the page's title and address into the margin,
   and there is no CSS for it -- so the title is the document's name for
   as long as the dialog is open, and is put back after. */
t("the print button names the document, not the session", () => {
  const btn = readFileSync(join(app, "components", "PrintThis.tsx"), "utf8");
  return /document\.title = name/.test(btn)
    && /document\.title = was/.test(btn)
    && /window\.print\(\)/.test(btn);
});

/* THE FIXTURE HAS TO BE ABLE TO TELL THE TWO APART. With a one-document
   pack, "reads as separate sheets" and "reads as one roll" are the same
   picture -- which is how this shipped looking like neither. */
t("the stand-in's pack has more than one document in it", () => {
  const stub = readFileSync(
    join(app, "lib", "__fixtures__", "stub-supabase.mjs"), "utf8");
  return /pagebreak/.test(stub)
    && (stub.match(/docFor\(/g) ?? []).length >= 3;
});

t("the select is one string literal", () =>
  /\.select\("[^"]*"\)/.test(packPage)
  && !/\.select\(\s*"[^"]*"\s*\+/.test(packPage));

// ---- the vault does not shut ----------------------------------------
const why = sign.slice(sign.indexOf("function why("),
  sign.indexOf("export async function GET"));

t("the gate on a link is there to read", () => /expires_at/.test(why));

/* THE ONE THAT MATTERS. Not "is there an expiry check" -- there was one,
   and it WAS the fault. The question is whether being signed exempts it. */
t("a signed pack never expires", () => {
  const line = (why.match(/if \([^)]*expires_at[^{]*\{/) ?? [""])[0];
  return /signed_at/.test(line);
});

/* And the rest of the gate still holds, or the fix has simply taken the
   door off its hinges. */
t("but a withdrawn one is still refused", () => /row\.voided_at/.test(why));
t("and an unsigned one still runs out", () =>
  /Date\.parse\(row\.expires_at\) < Date\.now\(\)/.test(why));

/* Once signed, the signed copy is what both sides read. Handing back the
   unsigned one shows somebody a blank line where their signature is. */
t("and the signed copy is what the link serves", () => {
  const get = sign.slice(sign.indexOf("export async function GET"),
    sign.indexOf("export async function POST"));
  return /row\.signed_pack \?\? row\.pack/.test(get);
});
t("the office is served the same way", () =>
  /signed_pack \?\? data\.pack/.test(packPage.replace(/\s+/g, " ")));

// ---- where it stands, on the list ----------------------------------
const board = readFileSync(join(app, "components", "OwnersBoard.tsx"), "utf8");
const ownersApi = readFileSync(
  join(app, "app", "api", "owners", "route.ts"), "utf8");
t("the list says where each investor's papers stand", () =>
  /className="ownerstands"/.test(board) && /r\.papers/.test(board));

/* A WITHDRAWN PACK IS NOT A STATE A DEAL IS IN. The first ALDERCREST
   pack went to the wrong address and was withdrawn five minutes later;
   it is newer than the live one and must not be what the list reports. */
t("a withdrawn pack is skipped, not reported", () => {
  const block = blockAt(ownersApi, "for (const r of (got.data ?? []) as Pack[]) {");
  return /r\.voided_at/.test(block) && /continue/.test(block);
});
t("and the newest that still counts is the one shown", () => {
  const block = blockAt(ownersApi, "for (const r of (got.data ?? []) as Pack[]) {");
  return /paper\.has\(r\.owner_id\)/.test(block)
    && /ascending: false/.test(ownersApi);
});

/* Signing could not be read, versus nothing having been sent. Drawing
   every investor as never sent anything is a sentence about the
   database written as though it were a fact about the business -- the
   same pair as `holdings`. */
t("not readable is told apart from nothing sent", () =>
  /papers,/.test(ownersApi) && /setPapers\(out\.papers !== false\)/.test(board)
  && /papers && r\.papers/.test(board));

/* THE ONE THE PICTURE NEARLY MISSED. `.pill` on its own has no ground,
   so "Signed" rendered identically to "Sent, not opened" -- the single
   distinction this line exists to make. Every tone the screen uses has
   to be a tone the stylesheet defines. */
t("every state is drawn differently from the others", () => {
  const tones = [...board.matchAll(/tone: "pill([^"]*)"/g)]
    .map((m) => m[1].trim());
  if (tones.length < 4) return false;
  return tones.every((mod) => mod === "" || css.includes(`.pill.${mod}{`));
});
/* And signed specifically is not the bare pill, which is what sent is. */
t("and signed is not drawn as the bare pill", () => {
  const signed = (board.match(/signed:\s*\{[^}]*tone: "([^"]*)"/) ?? [])[1];
  return !!signed && signed.trim() !== "pill";
});

let bad = 0;
for (const [name, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("what went out can be found, and what was signed keeps opening");
