/** The wording, lifted out of the .docx the owner supplied.
 *
 *  `papers-check.mjs` compares every fixed sentence in `papers.ts` against
 *  the document it came from, character for character. It cannot read a
 *  .docx, and a .docx is not a thing anybody can diff in a pull request --
 *  so the words are extracted to a .txt beside it, and THAT is what the
 *  check reads and what review sees.
 *
 *  The .docx stays as the thing the owner actually sent. The .txt is
 *  derived from it and must never be edited by hand: run this instead.
 *
 *      node docs/papers/extract.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

/** Word stores the text as XML inside a zip; unzip -p is enough to read it. */
const words = (file) => {
  const xml = execFileSync("unzip", ["-p", join(here, file), "word/document.xml"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return xml
    /* A paragraph break is a line break, and a tab is a tab: both carry
       meaning in a numbered contract and both vanish with the tags. */
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim() + "\n";
};

let wrote = 0;
for (const f of readdirSync(here).filter((f) => f.endsWith(".docx")).sort()) {
  const out = f.replace(/\.docx$/, ".txt");
  writeFileSync(join(here, out), words(f));
  console.log(`  ${f} → ${out}`);
  wrote++;
}
console.log(wrote ? `\n${wrote} extracted.` : "no .docx here.");
