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
const asText = (rs: Run[]) => {
  const out: { text: string; bold: boolean }[] = [];
  for (const r of rs) {
    const prev = out[out.length - 1];
    let text = r.text;
    if (prev && !/\s$/.test(prev.text) && text && !/^\s/.test(text)) {
      const stuck = (text.match(/^\S+/) ?? [""])[0];
      prev.text += stuck;
      text = text.slice(stuck.length);
    }
    if (text) out.push({ text, bold: r.bold === true });
  }
  return out;
};

export function buildPdfDef(
  terms: Terms, homes: Home[], which: "both" | "purchase" | "lease",
): Record<string, unknown> {
  const blocks = readPack(pack(terms, homes, which));
  const content: Piece[] = [];
  /** Set by a page break and worn by whatever comes next. */
  let breakNext = false;
  const push = (piece: Piece) => {
    if (breakNext) { piece.pageBreak = "before"; breakNext = false; }
    content.push(piece);
  };

  let rows: Extract<Block, { kind: "row" }>[] = [];
  const flushRows = () => {
    if (!rows.length) return;
    const widths = rows[0].cells.map(() => "*");
    push({
      table: {
        headerRows: rows[0].head ? 1 : 0,
        widths,
        body: rows.map((r) => r.cells.map((c) => ({
          text: c.replace(/\s+/g, " ").trim(), bold: r.head === true,
        }))),
      },
      layout: "lightHorizontalLines",
      fontSize: 9,
      margin: [0, 4, 0, 10],
    });
    rows = [];
  };

  for (const b of blocks) {
    if (b.kind === "row") { rows.push(b); continue; }
    flushRows();
    switch (b.kind) {
      case "h1":
        push({ text: asText(b.runs), bold: true, fontSize: 14,
               alignment: "center", margin: [0, 6, 0, 10] });
        break;
      case "h2":
        push({ text: asText(b.runs), bold: true, fontSize: 12,
               margin: [0, 10, 0, 4] });
        break;
      case "spaced":
        push({ text: asText(b.runs), alignment: "center",
               margin: [0, 6, 0, 6] });
        break;
      case "rule":
        /* The line somebody signs on. Drawn rather than typed, because a
           run of underscores wraps at the margin and breaks across a
           page as readily as any other text. */
        push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: TEXT_WIDTH, y2: 0,
                          lineWidth: 0.8 }],
               margin: [0, 22, 0, 3] });
        break;
      case "break":
        breakNext = true;
        break;
      default: {
        /* Prose is justified. A paragraph carrying a line break is a
           block of short lines -- the name and date under a signature --
           and justifying those spreads three words across six inches. */
        const broken = b.runs.some((r) => r.text.includes("\n"));
        push({ text: asText(b.runs),
               alignment: (b.align === "left" || broken) ? "left" : "justify",
               lineHeight: 1.25, margin: [0, 0, 0, 7] });
      }
    }
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
    defaultStyle: { font: "Times", fontSize: 12 },
    content,
  };
}

/** The four faces of the one standard family: no font file to embed. */
export const TIMES = {
  Times: {
    normal: "Times-Roman", bold: "Times-Bold",
    italics: "Times-Italic", bolditalics: "Times-BoldItalic",
  },
};

export const FACES = ["Times-Roman", "Times-Bold", "Times-Italic",
  "Times-BoldItalic"] as const;

/**
 * The widths pdfkit needs to lay the text out.
 *
 * Nothing is embedded in the PDF -- Times is one of the fourteen faces
 * every reader already has -- but something has to know how wide the
 * letters are before it can break a line or justify a paragraph. In Node
 * pdfkit reads that off disk; in a browser it looks in a virtual file
 * system and throws "File 'data/Times-Roman.afm' not found" if it is not
 * there, which is what a silent download that never arrives looks like
 * from the outside.
 *
 * Fetched rather than bundled: a quarter of a megabyte of metrics has no
 * business in a JavaScript bundle, and these never change.
 */
export async function timesMetrics(): Promise<Record<string, string>> {
  const vfs: Record<string, string> = {};
  await Promise.all(FACES.map(async (face) => {
    const res = await fetch(`/afm/${face}.afm`);
    if (!res.ok) {
      throw new Error(`The metrics for ${face} could not be read`
        + ` (${res.status}). The PDF cannot be laid out without them.`);
    }
    vfs[`data/${face}.afm`] = await res.text();
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
