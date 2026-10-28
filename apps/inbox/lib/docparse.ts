/**
 * The documents, as a list of things rather than as HTML.
 *
 * `papers.ts` is the generator's wording and emits HTML, because that is
 * what the generator emitted and nothing here rewrites a sentence of it.
 * A Word file is not HTML, so something has to read one and hand over the
 * other -- and it must be the SAME html, not a second copy of the prose:
 * two renderers each holding their own version of a contract is how one
 * of them quietly stops matching.
 *
 * Deliberately not a DOM parser. The markup is ours and is six tags wide,
 * and a tokenizer that runs in Node as well as in a browser is one the
 * harness can read the output of without a headless anything.
 */

export type Run = { text: string; bold?: boolean };

export type Block =
  | { kind: "h1"; runs: Run[] }
  | { kind: "h2"; runs: Run[] }
  | { kind: "p"; runs: Run[]; align?: "center" | "left" }
  | { kind: "spaced"; runs: Run[] }          // the W I T N E S S E T H line
  | { kind: "rule" }                          // a signature line
  | { kind: "row"; cells: string[]; head?: boolean }
  | { kind: "break" };                        // start a new page

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  mdash: "—", ndash: "–", hellip: "…",
};
const unescape = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body) => {
  if (body[0] === "#") {
    const n = body[1] === "x" || body[1] === "X"
      ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : all;
  }
  return ENTITIES[body.toLowerCase()] ?? all;
});

type Tag = { name: string; close: boolean; attrs: string };

/** Everything in the markup, in order: tags and the text between them. */
function* tokens(html: string): Generator<Tag | { text: string }> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { const t = html.slice(i); if (t) yield { text: t }; return; }
    if (lt > i) yield { text: html.slice(i, lt) };
    const gt = html.indexOf(">", lt);
    if (gt < 0) return;
    const body = html.slice(lt + 1, gt).trim();
    const close = body.startsWith("/");
    const bare = close ? body.slice(1) : body;
    const sp = bare.search(/\s/);
    yield {
      name: (sp < 0 ? bare : bare.slice(0, sp)).replace(/\/$/, "").toLowerCase(),
      close,
      attrs: sp < 0 ? "" : bare.slice(sp),
    };
    i = gt + 1;
  }
}

const classOf = (attrs: string) =>
  (attrs.match(/class\s*=\s*"([^"]*)"/) ?? [])[1] ?? "";

/**
 * Read a pack into blocks.
 *
 * `fill` spans and `b` tags are the document's own emphasis -- the figures
 * and the defined terms -- and they are the only bold in it, so both become
 * a bold run and nothing else does.
 */
export function readPack(html: string): Block[] {
  const out: Block[] = [];
  let runs: Run[] = [];
  let bold = 0;
  let where: null | "h1" | "h2" | "p" | "spaced" | "cell" = null;
  let align: "center" | "left" | undefined;
  let cells: string[] = [];
  let head = false;

  const flush = () => {
    /* Collapse runs of spaces but NOT the newlines a <br> puts in: this
       normalised them away, so the name and the date under a signature
       line arrived on one line with a space between them. */
    const kept = runs
      .map((r) => ({ ...r, text: r.text.replace(/[^\S\n]+/g, " ") }))
      .filter((r) => r.text);
    runs = [];
    if (!kept.length || !where) { where = null; align = undefined; return; }
    /* Whitespace between tags is markup, not prose -- and a newline in it
       is a line break the document never asked for, which showed up as a
       blank line under every signature. */
    kept[0].text = kept[0].text.replace(/^\s+/, "");
    kept[kept.length - 1].text = kept[kept.length - 1].text.replace(/\s+$/, "");
    const final = kept.filter((r) => r.text);
    if (final.length) {
      if (where === "h1") out.push({ kind: "h1", runs: final });
      else if (where === "h2") out.push({ kind: "h2", runs: final });
      else if (where === "spaced") out.push({ kind: "spaced", runs: final });
      else out.push({ kind: "p", runs: final, align });
    }
    where = null; align = undefined;
  };

  for (const tok of tokens(html)) {
    if ("text" in tok) {
      const text = unescape(tok.text);
      if (where === "cell") { cells[cells.length - 1] += text; continue; }
      /* Words loose in a div, with no paragraph open: the name under a
         signature line is written that way, and dropping it meant the
         documents came out with a line to sign on and nobody named under
         it. Whitespace between tags is markup and starts nothing. */
      if (!where) { if (!text.trim()) continue; where = "p"; }
      runs.push(bold ? { text, bold: true } : { text });
      continue;
    }
    const { name, close, attrs } = tok;
    if (name === "b" || name === "strong") { bold += close ? -1 : 1; if (bold < 0) bold = 0; continue; }
    if (name === "span") {
      if (!close && /fill/.test(classOf(attrs))) bold++;
      else if (close && bold) bold--;
      continue;
    }
    if (name === "br") { if (where) runs.push({ text: "\n" }); continue; }
    if (close) {
      if (name === "h2" || name === "h3" || name === "p") flush();
      else if (name === "td" || name === "th") where = null;
      else if (name === "tr") { out.push({ kind: "row", cells, head }); cells = []; head = false; }
      continue;
    }
    switch (name) {
      case "h2": flush(); where = "h1"; break;
      case "h3": flush(); where = "h2"; break;
      case "p":
        flush();
        where = /witness/.test(classOf(attrs)) ? "spaced" : "p";
        align = /fill/.test(classOf(attrs)) ? "left" : undefined;
        break;
      case "div": {
        const cls = classOf(attrs);
        if (/pagebreak/.test(cls)) { flush(); out.push({ kind: "break" }); }
        else if (/\bline\b/.test(cls)) { flush(); out.push({ kind: "rule" }); }
        else if (/sig-block/.test(cls)) flush();
        break;
      }
      case "tr": cells = []; head = false; break;
      case "th": head = true; cells.push(""); where = "cell"; break;
      case "td": cells.push(""); where = "cell"; break;
      default: break;
    }
  }
  flush();
  return out;
}
