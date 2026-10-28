/**
 * The documents as a Word file.
 *
 * A recorded document does not carry a website address and a timestamp in
 * its margin, and the browser's print dialog puts them there unless
 * somebody clears a tick box they will not remember to clear. There is no
 * CSS for it -- it is deliberately outside the page's reach -- so the only
 * way to hand over a file with nothing in the margin but the margin is to
 * make the file ourselves rather than asking the browser to.
 *
 * Word, not PDF, because the owner asked for Word and because Word's own
 * Save as PDF produces exactly the document with nothing added. It is also
 * what gets edited at a closing when a date moves.
 *
 * The prose comes from `papers.ts` by way of `docparse.ts`. Nothing here
 * writes a sentence of a contract.
 */
import type { Block, Run } from "./docparse";
import { readPack } from "./docparse";
import { pack, type Terms, type Home } from "./papers";

/** Twips: Word's unit, 1/20 of a point, so an inch is 1440. */
const INCH = 1440;

export async function packDocx(
  terms: Terms, homes: Home[], which: "both" | "purchase" | "lease",
  /** Which documents carry our signature; absent means all of them. */
  signs?: (key: string) => boolean,
): Promise<Blob> {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
    Table, TableRow, TableCell, WidthType, BorderStyle, convertInchesToTwip } = d;

  const blocks = readPack(pack(terms, homes, which, signs));

  /* A <br> becomes a break rather than a run of its own, and the empty
     pieces either side of it are dropped -- Word renders them as nothing
     but they make the file unreadable and the breaks hard to assert on. */
  const runs = (rs: Run[]) => rs.flatMap((r) =>
    r.text.split("\n").flatMap((piece, i) => [
      ...(i ? [new TextRun({ break: 1 })] : []),
      ...(piece ? [new TextRun({ text: piece, bold: r.bold })] : []),
    ]));

  const body: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  let pending: Block[] = [];
  /** Whether the block just placed was our signature. */
  let inked = false;

  /** A run of table rows becomes one table; everything else is a paragraph. */
  const flushRows = () => {
    if (!pending.length) return;
    const rows = pending as Extract<Block, { kind: "row" }>[];
    body.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((r) => new TableRow({
        children: r.cells.map((c) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: c.replace(/\s+/g, " ").trim(),
                                     bold: r.head, size: 20 })],
          })],
        })),
      })),
    }));
    pending = [];
  };

  for (const b of blocks) {
    if (b.kind === "row") { pending.push(b); continue; }
    flushRows();
    switch (b.kind) {
      case "h1":
        // The document's own title: centred, bold, a size up.
        body.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 160 },
          children: b.runs.map((r) => new TextRun({
            text: r.text, bold: true, size: 28 })),
        }));
        break;
      case "h2":
        body.push(new Paragraph({
          spacing: { before: 200, after: 80 },
          children: b.runs.map((r) => new TextRun({
            text: r.text, bold: true, size: 24 })),
        }));
        break;
      case "spaced":
        body.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          children: b.runs.map((r) => new TextRun({ text: r.text, bold: false })),
        }));
        break;
      case "ink":
        /* Our signature, above the line rather than through it. 150 x 45
           points is about two inches by six-tenths: a signature, not a
           banner. docx wants the bytes, so the data URL is unpacked. */
        body.push(new Paragraph({
          spacing: { before: 260, after: 0 },
          children: [new d.ImageRun({
            type: "png",
            data: Uint8Array.from(
              Buffer.from(b.src.replace(/^data:image\/png;base64,/, ""), "base64")),
            transformation: { width: 150, height: 45 },
          })],
        }));
        break;
      case "rule":
        /* The line somebody signs on. A bottom border on an empty
           paragraph, because an underscore run is a row of underscores
           that wraps and a drawing object is not editable in Word. */
        body.push(new Paragraph({
          spacing: { before: inked ? 20 : 320, after: 40 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6,
                              color: "000000", space: 1 } },
          children: [new TextRun("")],
        }));
        break;
      case "break":
        body.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      default: {
        /* Prose is justified, the way the printed document is. A name
           under a signature line is not prose: justifying it spread
           "Larabee Homes LLC" across six inches with the words at either
           edge, which is what a contract looks like when nobody read it.
           A paragraph that carries a line break is a block of short
           lines, so it is set flush left. */
        const broken = b.runs.some((r) => r.text.includes("\n"));
        body.push(new Paragraph({
          alignment: (b.align === "left" || broken)
            ? AlignmentType.LEFT : AlignmentType.BOTH,
          spacing: { after: 140, line: 300 },
          children: runs(b.runs),
        }));
        break;
      }
    }
  }
  flushRows();

  const doc = new Document({
    /* NO HEADER AND NO FOOTER. That is the whole point of this file, and
       it is the default -- stated here so that adding one later is a
       deliberate act rather than something somebody does by reflex. */
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
          margin: { top: INCH, bottom: INCH, left: INCH, right: INCH },
        },
      },
      children: body,
    }],
  });

  return Packer.toBlob(doc);
}

/** What the file is called when it lands in somebody's Downloads. */
export function docxName(
  buyer: string, which: "both" | "purchase" | "lease",
): string {
  const what = which === "purchase" ? "Purchase Agreement"
    : which === "lease" ? "Park Land Lease"
    : "Purchase Agreement and Park Land Lease";
  const who = (buyer || "Unnamed").replace(/[^\w\s&'-]+/g, "").trim();
  return `${what} - ${who}.docx`;
}
