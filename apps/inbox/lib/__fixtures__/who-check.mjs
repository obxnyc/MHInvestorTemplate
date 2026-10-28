/** Turning "who submitted this" into a person.
 *
 *  A maintenance request arrived naming nobody. `/ServiceManagerIssues` hands
 *  an issue over with no tenant, no phone and no lot -- the Property, Unit
 *  and Tenant embeds all 404 on this account, measured. What IS on the record
 *  is `CreateWebUserID`, the Tenant Web Access account that filled the form
 *  in, and the reader was throwing it away.
 *
 *  WHICH ENDPOINT TURNS THAT KEY IS A HYPOTHESIS -- Express, no docs
 *  reachable, no credentials here. So this does not check that the guesses
 *  are right. It checks the thing that decides whether a wrong guess can be
 *  corrected in one round: that every attempt is reported, that a useless
 *  200 is not mistaken for success, and that an account which answers none of
 *  them is asked once rather than seven times per request.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
let js = ts.transpileModule(readFileSync(join(here, "..", "rm-issues.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
// The module pulls in Supabase and the Rent Manager sign-in; the lookup is
// pure HTTP against a session it is handed.
js = js.replace(/^import[\s\S]*?;$/gm, "");
// Both are already exported by the module; adding them again is a duplicate
// export and the whole thing refuses to load.
const mod = await import("data:text/javascript," + encodeURIComponent(js));

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 130)]); }
};
const ta = async (name, fn) => {
  try { said.push([name, Boolean(await fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 130)]); }
};

/** A stand-in Rent Manager that answers only the paths it is told to. */
const asked = [];
let answers = {};
const srv = createServer((req, res) => {
  asked.push(req.url);
  const hit = Object.entries(answers)
    .find(([frag]) => req.url.includes(frag));
  if (!hit) { res.writeHead(404); res.end("not found"); return; }
  const [, body] = hit;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const session = {
  base: `http://127.0.0.1:${srv.address().port}`,
  header: "X-RM12Api-ApiToken", token: "stub",
};

const TENANT = {
  Tenant: {
    Name: "Abel Moreno",
    Email: "abel@example.com",
    PhoneNumbers: [{ PhoneNumber: "(910) 555-0133" }],
    Unit: { Name: "51", Property: { Name: "1140 Northside" } },
  },
};

await ta("a web user id becomes a name, a number and a lot", async () => {
  mod.forgetWho(); asked.length = 0;
  answers = { "/TenantWebUsers/": TENANT };
  const who = await mod.whoSubmitted("4471", session);
  return who.tenant === "Abel Moreno" && who.phone === "(910) 555-0133"
    && who.email === "abel@example.com" && who.unit === "51"
    && who.property === "1140 Northside";
});

await ta("every path tried is reported, so a wrong guess names itself", async () => {
  mod.forgetWho();
  answers = { "/WebUsers/": TENANT };     // the second-choice shape
  const who = await mod.whoSubmitted("4471", session);
  return who.tenant === "Abel Moreno" && who.tried.length >= 2
    && who.tried.some((a) => a.status === 404)
    && who.tried.every((a) => typeof a.path === "string" && a.path.includes("4471"));
});

/* THE ONE THAT MATTERS MOST. An endpoint that exists and knows nothing about
   tenants returns 200 with something on it. Treating that as success would
   pin every later lookup to a path that never helps, and the failure would be
   permanent and silent. */
await ta("a 200 that names nobody is not mistaken for an answer", async () => {
  mod.forgetWho(); asked.length = 0;
  answers = {
    "/TenantWebUsers/": { WebUserID: 4471, LastLogin: "2026-10-26", IsActive: true },
    "/WebUsers/": TENANT,
  };
  const who = await mod.whoSubmitted("4471", session);
  return who.tenant === "Abel Moreno"
    && who.tried.some((a) => a.ok && /names a tenant/.test(a.detail ?? ""));
});

await ta("and the field names it DID see are reported, for the next guess",
  async () => {
    mod.forgetWho();
    answers = { "/TenantWebUsers/": TENANT };
    const who = await mod.whoSubmitted("4471", session);
    return Array.isArray(who.shape) && who.shape.includes("Tenant");
  });

/* Asking seven times per request, on an account that has never seen API
   traffic, is not a good way to behave. */
await ta("the one that worked is tried first next time", async () => {
  mod.forgetWho();
  answers = { "/WebUsers/": TENANT };
  await mod.whoSubmitted("4471", session);
  asked.length = 0;
  await mod.whoSubmitted("9999", session);
  return asked.length === 1 && asked[0].includes("/WebUsers/9999");
});

await ta("an account that answers none of them is asked once, not forever",
  async () => {
    mod.forgetWho();
    answers = {};
    const first = await mod.whoSubmitted("4471", session);
    const n = asked.length;
    asked.length = 0;
    const second = await mod.whoSubmitted("5555", session);
    return first.tried.length > 1 && n > 1
      && asked.length === 0 && second.tenant === null;
  });

await ta("nothing to look up is not a lookup", async () => {
  mod.forgetWho(); asked.length = 0;
  const who = await mod.whoSubmitted("", session);
  return asked.length === 0 && who.tenant === null;
});

srv.close();
for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log("a request says who sent it, or says what was tried");
