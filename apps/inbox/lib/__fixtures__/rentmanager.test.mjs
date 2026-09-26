/** Finding Rent Manager: which hostname, which token header, and what each
 *  failure means. Run: node lib/__fixtures__/rentmanager.test.mjs
 *
 *  Tested against a pretend Rent Manager on localhost, because the real one
 *  cannot be reached from a build machine and because the cases worth testing
 *  -- a module nobody licensed, a token header from an older version, a real
 *  server refusing a real credential -- are ones you would not want to
 *  reproduce against a live account anyway. */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import http from "http";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "rentmanager.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Re-imported per case: the module remembers which address worked, which is
 *  the behaviour wanted in production and the opposite of it in a test. */
const fresh = () => import("data:text/javascript," + encodeURIComponent(js)
  + "#" + Math.random());

const checks = [];
const t = (n, got, want) =>
  checks.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);

const TOKEN = "tok_abcdefghijklmnop";

function pretendRentManager({ mode = "ok", header = "X-RM12Api-ApiToken" } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/Authentication/AuthorizeUser") {
      if (mode === "404") { res.writeHead(404); return res.end("Not Found"); }
      let body = "";
      req.on("data", (d) => (body += d));
      return req.on("end", () => {
        const j = JSON.parse(body);
        if (j.Username !== "api-integration" || j.Password !== "s3cret") {
          res.writeHead(401);
          return res.end("Invalid username or password.");
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(`"${TOKEN}"`);
      });
    }
    if (req.headers[header.toLowerCase()] !== TOKEN) {
      res.writeHead(401); return res.end("bad token");
    }
    if (url.pathname === "/Properties") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(
        [{ PropertyID: 7, Name: "Placeholder Park", ShortName: "PlacePark" }]));
    }
    if (url.pathname === "/Payments") {
      res.writeHead(403); return res.end("Module not licensed");
    }
    res.writeHead(404); res.end("no such endpoint");
  });
}

const listen = (s) =>
  new Promise((r) => s.listen(0, "127.0.0.1", () => r(s.address().port)));

process.env.RENTMANAGER_COMPANY = "example";
process.env.RENTMANAGER_USERNAME = "api-integration";
process.env.RENTMANAGER_PASSWORD = "s3cret";

{
  const rm = await fresh();
  t("candidate hosts, documented one first", rm.candidateBases("example"), [
    "https://example.api.rentmanager.com",
    "https://example.rmx.rentmanager.com/api",
    "https://example.rmx.rentmanager.com",
    "https://example.rentmanager.com/api",
  ]);
}

{
  const s = pretendRentManager(); const port = await listen(s);
  process.env.RENTMANAGER_BASE_URL = `http://127.0.0.1:${port}`;
  const rm = await fresh();
  const auth = await rm.rmAuthorize(true);
  t("signs in", auth.ok, true);
  t("finds the v12 token header", auth.session.header, "X-RM12Api-ApiToken");

  const props = await rm.rmGet("/Properties?pagesize=1", auth.session);
  t("reads a record", [props.ok, props.count], [true, 1]);
  t("reports its field names", props.shape, ["PropertyID", "Name", "ShortName"]);

  const pay = await rm.rmGet("/Payments?pagesize=1", auth.session);
  t("an unlicensed module is an answer, not a crash", [pay.ok, pay.status], [false, 403]);

  t("the session is reused", (await rm.rmAuthorize()).cached, true);
  s.close();
}

{
  const s = pretendRentManager({ header: "X-RM11Api-ApiToken" });
  process.env.RENTMANAGER_BASE_URL = `http://127.0.0.1:${await listen(s)}`;
  const rm = await fresh();
  const auth = await rm.rmAuthorize(true);
  t("falls back to an older token header", auth.session.header, "X-RM11Api-ApiToken");
  s.close();
}

{
  const s = pretendRentManager();
  process.env.RENTMANAGER_BASE_URL = `http://127.0.0.1:${await listen(s)}`;
  process.env.RENTMANAGER_PASSWORD = "wrong";
  const rm = await fresh();
  const auth = await rm.rmAuthorize(true);
  t("a wrong password is refused, with their words",
    [auth.ok, auth.attempts[0].status, auth.attempts[0].detail],
    [false, 401, "Invalid username or password."]);
  s.close();
  process.env.RENTMANAGER_PASSWORD = "s3cret";
}

{
  const s = pretendRentManager({ mode: "404" });
  process.env.RENTMANAGER_BASE_URL = `http://127.0.0.1:${await listen(s)}`;
  const rm = await fresh();
  const auth = await rm.rmAuthorize(true);
  t("a server with no API at that address", [auth.ok, auth.attempts[0].status], [false, 404]);
  s.close();
}

{
  delete process.env.RENTMANAGER_USERNAME;
  const rm = await fresh();
  t("no credentials means not configured", rm.rmConfigured(), false);
  process.env.RENTMANAGER_USERNAME = "api-integration";
}

let bad = 0;
for (const [name, ok, got, want] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}
console.log(bad ? `\n${bad} failed` : `\n${checks.length} passed`);
process.exit(bad ? 1 : 0);
