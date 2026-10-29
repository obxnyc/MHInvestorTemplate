/**
 * The documents as a PDF this application made.
 *
 * The browser's print dialog writes the date and the page's address into
 * the margin of every page unless somebody clears a tick box, and that
 * margin is deliberately outside CSS's reach. A document that gets
 * recorded cannot carry either, and "remember to clear the tick box" is
 * not a property of a document -- it is a thing somebody has to do right
 * every single time on whatever machine they happen to be at.
 *
 * So the PDF is built here, from the same blocks the Word file is built
 * from, which are read from the same HTML `papers.ts` emits. One copy of
 * the prose, three ways out of it.
 *
 * The definition is a plain object on purpose: it is the whole of what
 * the file will be, and a harness can read it without a browser.
 */
import { readPack, type Block, type Run } from "./docparse";
import { pack, type Terms, type Home } from "./papers";

/** Points. Letter is 612 wide; an inch of margin each side leaves this. */
const INCH = 72;
const TEXT_WIDTH = 612 - INCH * 2;

type Piece = Record<string, unknown>;

/** Every run bold, whatever the markup said. */
const bolden = (rs: { text: string; bold: boolean }[]) =>
  rs.map((r) => ({ ...r, bold: true }));

/**
 * Runs, with anything that is really one word made one run.
 *
 * pdfmake lays each run out as its own inline and breaks it into words at
 * its own edges, so two runs that are not separated by a space still get
 * one when the line is justified: the date ends a bold run and the comma
 * after it begins a plain one, and a contract came out reading
 * "the 2nd day of September, 2025 , by". A space before a comma is a
 * small thing that makes a document look like nobody read it.
 *
 * So where one run ends mid-word and the next begins mid-word, the first
 * word of the second is moved onto the end of the first and takes its
 * styling -- which for the case this exists for means a bold comma after
 * a bold date, and that is what it should have been anyway.
 */
/**
 * Words pdfmake would pull apart.
 *
 * It finds the places a line MAY break -- at a slash, at a hyphen -- and
 * then, justifying, stretches every one of them whether or not there is a
 * space there. So "and/or" prints as "and/ or", "3bd/2ba" as "3bd/ 2ba",
 * and a figure as "$341.22/ yr". Marked `noWrap`, a word is one thing
 * again and nothing is stretched inside it.
 *
 * Only short ones: a long token that cannot break has to go somewhere,
 * and off the right-hand edge is where.
 */
const WHOLE = /[/\u2010\u2011-]/;
const unbreakable = (word: string) => WHOLE.test(word) && word.length <= 24;

const asText = (rs: Run[]) => {
  const out: { text: string; bold: boolean; noWrap?: boolean }[] = [];
  for (const r of rs) {
    const prev = out[out.length - 1];
    let text = r.text;
    if (prev && !/\s$/.test(prev.text) && text && !/^\s/.test(text)) {
      const stuck = (text.match(/^\S+/) ?? [""])[0];
      prev.text += stuck;
      text = text.slice(stuck.length);
    }
    if (!text) continue;
    /* Split on the spaces, keeping them, so the pieces still read as one
       sentence; only the words that would be pulled apart are lifted out
       into their own inline. */
    let run = "";
    for (const piece of text.split(/(\s+)/)) {
      if (piece && unbreakable(piece)) {
        if (run) { out.push({ text: run, bold: r.bold === true }); run = ""; }
        out.push({ text: piece, bold: r.bold === true, noWrap: true });
      } else {
        run += piece;
      }
    }
    if (run) out.push({ text: run, bold: r.bold === true });
  }
  return out;
};

export function buildPdfDef(
  terms: Terms, homes: Home[], which: "both" | "purchase" | "lease",
  /** Which documents carry our signature; absent means all of them. */
  signs?: (key: string) => boolean,
): Record<string, unknown> {
  const blocks = readPack(pack(terms, homes, which, signs));
  const content: Piece[] = [];
  /** Set by a page break and worn by whatever comes next. */
  let breakNext = false;
  const push = (piece: Piece) => {
    if (breakNext) { piece.pageBreak = "before"; breakNext = false; }
    content.push(piece);
  };

  /** Whether the block just before was our signature, so the line under
   *  it sits against it rather than a paragraph's distance below. */
  let inked = false;
  let rows: Extract<Block, { kind: "row" }>[] = [];
  const flushRows = () => {
    if (!rows.length) return;
    /* A year is two characters and a balance is nine, so equal columns
       put "1" in the middle of two inches of nothing. The first column
       is given what it needs and the rest share what is left. */
    const widths = rows[0].cells.map((_, i) => (i === 0 ? "auto" : "*"));
    push({
      table: {
        headerRows: rows[0].head ? 1 : 0,
        widths,
        body: rows.map((r) => r.cells.map((c, i) => ({
          text: c.replace(/\s+/g, " ").trim(),
          bold: r.head === true,
          /* Money reads down a column, so it is set against the right
             edge; the year it belongs to stays against the left. */
          alignment: i === 0 ? "left" : "right",
        }))),
      },
      /* A hairline under every row and nothing else: the heavy rule the
         default draws under the header belongs on a web page, not in a
         schedule attached to a contract. */
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[];
          headerRows: number } }) => (i === 0 || i === node.table.body.length
          ? 0 : (i === node.table.headerRows ? 0.7 : 0.3)),
        vLineWidth: () => 0,
        hLineColor: () => "#444444",
        paddingTop: () => 2.5,
        paddingBottom: () => 2.5,
        paddingLeft: (i: number) => (i === 0 ? 0 : 8),
        paddingRight: () => 0,
      },
      fontSize: 9.5,
      margin: [0, 6, 0, 12],
    });
    rows = [];
  };

  for (const b of blocks) {
    if (b.kind === "row") { rows.push(b); continue; }
    flushRows();
    switch (b.kind) {
      /* BOLD GOES ON THE RUNS, not on the block. pdfmake lets an inline
         override what the block says and `asText` writes `bold: false`
         on every run that was not bold in the markup -- so a heading
         asking for bold at the block level came out in plain text, while
         the same heading in the Word file, where it is set per run, came
         out right. */
      case "h1":
        push({ text: bolden(asText(b.runs)), fontSize: 14,
               alignment: "center", margin: [0, 6, 0, 10] });
        break;
      case "h2":
        push({ text: bolden(asText(b.runs)), fontSize: 12,
               margin: [0, 12, 0, 4] });
        break;
      case "spaced":
        push({ text: asText(b.runs), alignment: "center",
               margin: [0, 6, 0, 6] });
        break;
      case "ink":
        /* Above the line, not through it. Sized in points: 150 x 45 is
           about two inches by six-tenths, which is a signature rather
           than a banner across the page. The aspect is left to fit
           inside that box so a wide scrawl is not stretched tall. */
        push({ image: b.src, fit: [150, 45], margin: [0, 14, 0, 0] });
        break;
      case "rule":
        /* The line somebody signs on. Drawn rather than typed, because a
           run of underscores wraps at the margin and breaks across a
           page as readily as any other text. */
        push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: TEXT_WIDTH, y2: 0,
                          lineWidth: 0.8 }],
               margin: [0, inked ? 2 : 22, 0, 3] });
        break;
      case "break":
        breakNext = true;
        break;
      default: {
        /* Prose is justified. A paragraph carrying a line break is a
           block of short lines -- the name and date under a signature --
           and justifying those spreads three words across six inches. */
        const broken = b.runs.some((r) => r.text.includes("\n"));
        const runs = b.strong ? bolden(asText(b.runs)) : asText(b.runs);
        push({ text: runs,
               alignment: (b.align === "left" || broken) ? "left" : "justify",
               lineHeight: 1.25, margin: [0, 0, 0, 7] });
      }
    }
    /* Set after the block is placed, so the rule that follows a
       signature reads it as "the thing before me was ink" rather than
       asking about itself. */
    inked = b.kind === "ink";
  }
  flushRows();

  return {
    /* NO header AND NO footer. pdfmake draws one only when given one, and
       it is given neither -- said here so that adding one is a deliberate
       act. Likewise no `info.Title`: a PDF viewer puts the title in its
       window, not on the paper, but there is no reason to carry the
       page's address anywhere in a file that gets recorded. */
    pageSize: "LETTER",
    pageMargins: [INCH, INCH, INCH, INCH],
    defaultStyle: { font: SERIF, fontSize: 12 },
    content,
  };
}

/**
 * The face the documents are set in.
 *
 * Tinos, which is metric-compatible with Times New Roman -- so the PDF
 * and the Word file, which asks for Times New Roman by name, break their
 * lines in the same places and are the same document rather than two
 * documents that resemble each other.
 *
 * EMBEDDED rather than one of the fourteen faces every reader already
 * has, which is what this used to use. Those are WinAnsi-encoded, and a
 * non-breaking hyphen is not in WinAnsi: "month‑to‑month" printed as
 * "month to montha basis", with the words overlapping where a glyph with
 * no advance had been. Worse, replacing it with a plain hyphen made
 * pdfmake treat it as somewhere a line may break, and justification then
 * stretched the gap -- "a purchase- money security interest".
 *
 * Subset to Latin-1 and the punctuation a contract uses, which is
 * seventeen kilobytes a face rather than five hundred.
 */
export const SERIF = "Tinos";

export const FONT_FILES = {
  normal: "tinos-regular.ttf",
  bold: "tinos-bold.ttf",
} as const;

/** What pdfmake is told the family is made of. */
export const FONTS = {
  [SERIF]: {
    normal: FONT_FILES.normal,
    bold: FONT_FILES.bold,
    /* The documents have no italics in them. Pointed at the upright
       faces rather than left out, because pdfmake throws on a style it
       was not given and a missing italic would be a PDF that fails to
       build rather than one that looks slightly wrong. */
    italics: FONT_FILES.normal,
    bolditalics: FONT_FILES.bold,
  },
};

/**
 * The font files, for a browser.
 *
 * pdfkit reads them off disk in Node and out of a virtual file system in
 * a tab, and throws inside its own worker when they are not there -- a
 * button that does nothing, with no error anywhere.
 */
export async function serifFiles(): Promise<Record<string, string>> {
  const vfs: Record<string, string> = {};
  await Promise.all(Object.values(FONT_FILES).map(async (file) => {
    const res = await fetch(`/fonts/${file}`);
    if (!res.ok) {
      throw new Error(`The ${file} typeface could not be read (${res.status}).`
        + " The PDF cannot be set without it.");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let raw = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    vfs[file] = btoa(raw);
  }));
  return vfs;
}

export function pdfName(
  buyer: string, which: "both" | "purchase" | "lease",
): string {
  const what = which === "purchase" ? "Purchase Agreement"
    : which === "lease" ? "Park Land Lease"
    : "Purchase Agreement and Park Land Lease";
  const who = (buyer || "Unnamed").replace(/[^\w\s&'-]+/g, "").trim();
  return `${what} - ${who}.pdf`;
}
