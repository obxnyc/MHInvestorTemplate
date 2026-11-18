// The app's half of 072: areas a person is not shown, private conversations'
// notifications, the watch alert, the record page -- and the address
// suggestions that replaced Google's.
//
// record-check.mjs proves the database refuses what it should. This proves
// the app does not hand round what the database would refuse: the server's
// own key skips every row policy, so each place that uses it has to ask.
//
//   node lib/__fixtures__/privacy-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = async (f) => {
  const out = join(tmpdir(), `privacy-${f.replace(/\W/g, "_")}-${process.pid}.mjs`);
  writeFileSync(out, ts.transpileModule(readFileSync(join(here, f), "utf8"),
    { compilerOptions: { target: 99, module: 99 } }).outputText);
  return import(out);
};
const src = (f) => readFileSync(join(here, f), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const t = (name, fn) => {
  let ok = false, why = "";
  try { ok = Boolean(fn()); } catch (e) { why = ` (threw: ${e.message})`; }
  results.push(`${ok ? "  ok " : "FAIL"}  ${name}${why}`);
};

const A = await load("lib/areas.ts");
const P = await load("lib/parcel.ts");

// --- areas ---
t("Friday pay is the pay area", () => A.areaOf("/pay") === "pay");
t("but a word that starts the same is not", () => A.areaOf("/payments") === null);
t("an area's API is in the area", () => A.areaOf("/api/distributions/summary") === "distributions");
t("timesheets and crew wages go with pay", () =>
  A.areaOf("/timesheets") === "pay" && A.areaOf("/crew") === "pay");
t("the clock itself is not hidden", () => A.areaOf("/clock") === null && A.areaOf("/api/clock/in") === null);
t("a hidden link is hidden", () => A.hiddenHref("/owners", ["investors"]) && !A.hiddenHref("/owners", []));

const proxy = src("proxy.ts");
t("the proxy asks about areas before it lets a request through", () => {
  const i = proxy.indexOf("const area = areaOf(path)");
  return i > 0 && i < proxy.lastIndexOf("return response;")
    && /hidden\.includes\(area\)/.test(proxy.slice(i, i + 900));
});
t("an area API is refused, not served", () => /status: 403/.test(proxy.slice(proxy.indexOf("const area = areaOf(path)"))));

const header = src("components/AppHeader.tsx");
t("the header leaves out what is hidden", () => /hiddenHref\(u\.href, hidden\)/.test(header));
t("and offers the record only to whoever reads everything", () =>
  /readsAll \? \[\{ href: "\/record"/.test(header));

const people = src("app/api/people/[id]/route.ts");
t("only an admin changes what somebody can see", () =>
  people.indexOf('me?.role !== "admin"') < people.indexOf("hidden_areas: [...new Set"));
t("and only to names the app knows", () => /hidden_areas\.every\(isArea\)/.test(people));

// --- private conversations ---
const push = src("lib/push.ts");
t("every push about a conversation is filtered by who may see it", () => {
  const body = push.slice(push.indexOf("export async function pushToStaff"));
  const filter = body.indexOf("mayHear(db, payload.conversationId");
  return filter > 0 && filter < body.indexOf(".from(\"push_subscriptions\")");
});
t("a private conversation's news reaches its people and the owner only", () =>
  /new Set\(\[\.\.\.only, \.\.\.\(readers/.test(push) && /eq\("reads_all_dms", true\)/.test(push));
const note = src("app/api/conversations/[id]/note/route.ts");
t("a mention says which conversation it is about", () => /conversationId: id/.test(note));

const priv = src("app/api/conversations/[id]/private/route.ts");
t("privacy is only changed on a conversation the person can see", () => {
  const post = priv.slice(priv.indexOf("export async function POST"));
  return post.indexOf("await visible(id)") > 0
    && post.indexOf("await visible(id)") < post.indexOf(".update({ private_to");
});
t("and nobody locks themselves out", () => /next\.push\(me\.id\)/.test(priv));
t("a maintenance conversation is refused before anything is written", () => {
  const post = priv.slice(priv.indexOf("export async function POST"));
  const stop = post.indexOf('convo.category === "maintenance"');
  return stop > 0 && stop < post.indexOf(".update({ private_to");
});
t("visibility is read as the person, not the server", () =>
  /async function visible[\s\S]{0,200}supabaseServer\(\)/.test(priv));

// --- the watch alert and the record ---
const alert = src("app/api/watch/alert/route.ts");
t("the alert route checks the key before anything else", () => {
  const post = alert.slice(alert.indexOf("export async function POST"));
  return post.indexOf("cronKeyOk(req") > 0 && post.indexOf("cronKeyOk(req") < post.indexOf("req.json()");
});
t("an alert is claimed before it is sent, so it goes once", () =>
  alert.indexOf('.is("alerted_at", null)') > 0
  && alert.indexOf('.is("alerted_at", null)') < alert.indexOf("pushToStaff("));
const record = src("app/(app)/record/page.tsx");
t("the record page sends anybody else away before reading", () =>
  record.indexOf('redirect("/home")') > 0
  && record.indexOf('redirect("/home")') < record.indexOf('.from("message_record")'));
const watch = src("app/api/watch/route.ts");
t("the watch-list is changed as the person, so the owner-only policy decides", () =>
  !/supabaseAdmin/.test(watch) && /supabaseServer\(\)/.test(watch));

// --- suggestions ---
t("what is typed becomes a number and a street", () =>
  P.suggestWhere("218 Buena Vista Rd") === "upper(siteadd) LIKE '%218 BUENA VISTA%'");
t("a quote typed into the box goes nowhere near the query", () =>
  !/'.*'.*'/.test(P.suggestWhere("218 O'Brien'); drop table x; --") ?? "")
  && (P.suggestWhere("218 O'Brien") ?? "").split("'").length === 3);
t("too little to ask about is not asked", () => P.suggestWhere("2") === null && P.suggestWhere("Buena") === null);
t("the county's address reads like an address", () =>
  P.prettyAddress("00218 BUENA VISTA RD", "MURFREESBORO") === "218 Buena Vista Rd, Murfreesboro, NC");
t("a street and town are found with commas", () => {
  const s = P.streetOf("101 Buena Vista Rd, Murfreesboro, NC 27855");
  return s.number === 101 && s.street === "BUENA VISTA" && s.city === "MURFREESBORO";
});
t("and without them, as Serenity was typed", () => {
  const s = P.streetOf("101 Buena vista rd Murfreesboro NC 27855");
  return s.number === 101 && s.street === "BUENA VISTA" && s.city === "MURFREESBORO";
});
// A one-word street, where "the first two words that are not a road type"
// and "the words before the road type" give different answers. On Serenity's
// two-word street they agree, and a fault there passed unnoticed.
t("a one-word street does not borrow the town's name", () => {
  const s = P.streetOf("101 Oak Rd Murfreesboro NC 27855");
  return s.street === "OAK" && s.city === "MURFREESBORO";
});
// Choosing a suggested parcel has its own route. Its first version was
// written over the existing parcel route -- the one the "Get the property
// line" box posts a parcel number to -- and the type checker had nothing to
// say, because both were a POST returning JSON.
t("the parcel-number lookup is still where the park screen expects it", () =>
  /appIdFrom/.test(src("app/api/properties/[id]/parcel/route.ts")));
t("and choosing a suggestion goes to its own route", () =>
  /\/parcel-choice`/.test(src("components/ParkScreen.tsx"))
  && /byParcelNumber/.test(src("app/api/properties/[id]/parcel-choice/route.ts")));
const places = src("app/api/places/route.ts");
t("with no Google key the box asks the state, not nobody", () =>
  /if \(!key \|\| \(id && id\.startsWith\("nc:"\)\)\)/.test(places) && /await suggest\(q\)/.test(places));

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("FAIL")).length;
console.log(bad ? `\n${bad} failed` : "\nprivacy holds");
process.exit(bad ? 1 : 0);
