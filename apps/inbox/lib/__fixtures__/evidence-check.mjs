/**
 * The whole of a job, from the videos that start it to the invoice.
 *
 * "My employee sent two videos of the debris, I sent them to Jackson, he
 * does the work, he sends a photo it's done, and the invoice gets logged
 * against the property." Almost all of that existed: the vendor's own
 * page, the photo the database insists on before a job closes, the
 * invoice with a file. One link was missing -- `reported_photos` could
 * only ever be filled by a tenant TEXTING a picture, so a job raised by
 * hand had no way to carry one, and the videos went out through somebody's
 * phone where nothing stays attached to the property.
 *
 *     node lib/__fixtures__/evidence-check.mjs
 *
 * Source rules, because the chain crosses four routes and two of them are
 * reached by a token rather than by a session.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

const attach = bare(read("app/api/jobs/[id]/attach/route.ts"));
const newjob = bare(read("components/NewJob.tsx"));
const board = bare(read("app/api/jobs/route.ts"));
const vendor = bare(read("app/jobs/[token]/page.tsx"));
const done = bare(read("app/api/jobs/link/[token]/complete/route.ts"));
const invoice = bare(read("app/api/jobs/link/[token]/invoice/route.ts"));
const types = read("lib/attachments.ts");

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- 1. the videos get onto the job -----------------------------------

t("a job can be given files directly", () => /work_orders/.test(attach)
  && /reported_photos/.test(attach));
t("and video is a thing we keep",
  () => /"video\/mp4"/.test(types) && /"video\/quicktime"/.test(types));
/* APPENDED, NOT REPLACED. Two people adding a photograph at the same
   moment must not lose one, and a replace is how that happens quietly. */
t("files are added to what is already there", () => {
  const at = attach.indexOf("update({ reported_photos");
  if (at < 0) return false;
  return /\[\.\.\.now, \.\.\.added\]/.test(attach.slice(at - 200, at + 120));
});
t("and it re-reads the job before appending, rather than trusting what it"
  + " read at the start",
  () => {
    const first = attach.indexOf('select("id, reported_photos")');
    const again = attach.indexOf('select("reported_photos")');
    return first >= 0 && again > first;
  });
/* A FILE TOO BIG IS NAMED IN MEGABYTES. "Too large" sends somebody to try
   the same video again; a phone video is routinely over the limit. */
t("a file that is too big says how big it is and what the limit is",
  () => /Math\.round\(file\.size \/ 1e6\)/.test(attach)
     && /MAX_KEEP_BYTES \/ 1e6/.test(attach));
/* BOTH HALVES OF A PARTIAL UPLOAD. Four videos where one was refused is
   neither a success nor a failure, and reporting it as either loses the
   one that did not go. */
t("some going and some not is reported as both",
  () => /added: added\.length/.test(attach) && /refused,/.test(attach));

// ---- 2. the form that raises the job ----------------------------------

t("the new-job form takes photos and video",
  () => /type="file"/.test(newjob) && /video\/\*/.test(newjob));
/* AFTER THE JOB EXISTS, because the files are stored under its id. */
t("and uploads them after the job is made, not with it", () => {
  const made = newjob.indexOf('fetch("/api/jobs"');
  const sent = newjob.indexOf("/attach");
  return made >= 0 && sent > made;
});
/* THE JOB IS OPEN EITHER WAY. Closing the form on a half-done upload is
   how somebody finds out next week that the vendor never saw the video. */
/* ASKED ON THE BRANCH, not on the words. "The job is open" appears in
   the catch below as well, so a rule that greps the file passed while
   the refused branch was saying something else entirely -- and would
   have passed just as happily if that branch closed the form. */
t("a failed upload leaves the form open", () => {
  const at = newjob.indexOf("if (refused.length) {");
  if (at < 0) throw new Error("the refused branch was not found");
  const shut = newjob.indexOf("\n        }", at);
  const branch = newjob.slice(at, shut < 0 ? at + 600 : shut);
  if (/onClose\(\)/.test(branch)) {
    throw new Error("it closes the form, so nobody sees what did not go");
  }
  return /setSaid\(/.test(branch) && /onMade\(\)/.test(branch);
});
t("and says which files did not go",
  () => /refused\.join\("; "\)/.test(newjob));

// ---- 3. whoever goes can see them -------------------------------------

t("the vendor's own page shows what was sent with the job",
  () => /reported_photos/.test(vendor) && /signMedia/.test(vendor));
t("and the office can see how much is attached",
  () => /reported_photos/.test(board) && /evidence:/.test(board));
/* COUNTED, NOT SIGNED. Five hundred jobs on this screen and signing every
   picture would be five hundred round trips for something nobody clicked. */
t("counted rather than fetched, because the board lists five hundred jobs",
  () => /before\.length/.test(board) && !/signMedia/.test(board));
/* AND THE COLUMN IS ASKED FOR TOLERANTLY. It arrives in a later
   migration, and a column that is not there takes the whole select with
   it -- which on this screen is every job in the business. */
t("the board still draws on a database without those columns", () => {
  const at = board.indexOf("reported_photos");
  return at >= 0 && /if \(got\.error\) got = await askJobs\(BASE\)/.test(board);
});

// ---- 4. and the way back ----------------------------------------------

t("a job will not close without a photo or a reason",
  () => /Add a photo of the finished work/.test(done));
t("the invoice takes an amount and a file",
  () => /parseMoney/.test(invoice) && /invoices\//.test(invoice));
/* ONE VENDOR'S TOKEN CANNOT INVOICE ANOTHER VENDOR'S WORK -- the thing a
   link with no password has to get right. */
t("and a token cannot invoice somebody else's job",
  () => /that invoice isn't on this job/.test(invoice));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("evidence goes out with the job and comes back with the invoice");
