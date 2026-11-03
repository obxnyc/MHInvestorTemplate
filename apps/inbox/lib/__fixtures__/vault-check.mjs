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
   as signed. Anchored on the call rather than on the words. */
t("a pack that went out can be opened from the office", () =>
  /fetch\(`\/api\/owners\/\$\{ownerId\}\/sent\?pack=/.test(screen));
t("and the route answers that question", () =>
  /searchParams\.get\("pack"\)/.test(sent));

/* The `if (wants) { ... }` and not a fixed slice after it: the list
   query further down carries the identical owner filter, so a window
   that overran found it there and the check passed with the filter
   deleted from the branch it is about. */
const packBlock = blockAt(sent, "if (wants) {");

t("the pack branch is there to read", () =>
  packBlock.length > 100 && /searchParams|wants/.test(packBlock)
  && !/order\("sent_at"/.test(packBlock));

/* Scoped to this owner, or an id lifted from another deal reads back
   somebody else's contract. */
t("only for this investor's own packs", () =>
  /\.eq\("owner_id", id\)/.test(packBlock) && /\.eq\("id", wants\)/.test(packBlock));

/* The office reads the document; it has no need of the key to the
   investor's own door, and a token on a page is a token in a screenshot. */
t("and the token is never handed to the office", () => !/token/.test(packBlock));

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
  /signed_pack \?\? data\.pack/.test(sent.replace(/\s+/g, " ")));

let bad = 0;
for (const [name, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("what went out can be found, and what was signed keeps opening");
