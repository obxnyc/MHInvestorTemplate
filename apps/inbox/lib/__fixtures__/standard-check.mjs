/** The terms we always use.
 *
 *  Six investors in a row get the same late fee, the same grace period,
 *  the same notice period and the same lease, and until now each of them
 *  was re-chosen on each screen. The thing that can go wrong here is not
 *  arithmetic: it is one investor's name reaching another investor's
 *  contract, which reads exactly like a contract and is not one.
 *
 *  So three halves. The migration, run rather than read. The two pure
 *  functions, against a fixture where every key holds a DIFFERENT value,
 *  so dropping one from the strip list cannot pass. And the source rules
 *  for the order things are laid in and for sending keeping the deal --
 *  neither of which is visible in a type or in a picture.
 *
 *      node apps/inbox/lib/__fixtures__/standard-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const app = join(lib, "..");
const root = join(app, "..", "..");
const SQL = join(root, "docs", "shared-line", "049-the-terms-we-always-use.sql");

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    const why = String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 200)]);
  }
};

// ---------------------------------------------------------------- the code
const gen = (name) => {
  const out = join(lib, `${name}.gen.mjs`);
  writeFileSync(out, ts.transpileModule(
    readFileSync(join(lib, `${name}.ts`), "utf8"),
    { compilerOptions: { target: 99, module: 99 } }).outputText
    .replace(/from "\.\/(\w[\w-]*)"/g, (_m, d) => `from "./${d}.gen.mjs"`));
  return out;
};
gen("papers");
const H = await import(gen("house-terms"));
const P = await import(join(lib, "papers.gen.mjs"));

/* EVERY KEY HOLDS A DIFFERENT VALUE. With two deal-only keys sharing one
   value, dropping either from the strip list still leaves the other's
   value absent and the check passes on the fault. */
const ANDREW = {
  ...P.DEFAULTS,
  buyer: "Andrew Habberstad",
  agreedOn: "2026-07-27",
  leaseFrom: "2026-08-01",
  parkName: "The Retreat at Cross Creek",
  lotRent: 375, consulting: 45, lateFee: 100, graceDays: 10,
  noticeDays: 60, rofrDays: 15, leaseForm: "investor",
  escalate: false, reserve: 750, ratePct: 5.2, termYears: 30,
};

t("the standard carries the terms", () => {
  const h = H.houseStandard(ANDREW);
  return h.lateFee === 100 && h.graceDays === 10 && h.noticeDays === 60
    && h.rofrDays === 15 && h.leaseForm === "investor" && h.lotRent === 375
    && h.consulting === 45 && h.reserve === 750 && h.escalate === false;
});

for (const k of H.DEAL_ONLY) {
  t(`and never ${k}, which belongs to one deal`, () =>
    !(k in H.houseStandard(ANDREW)));
}

/* THE WHOLE POINT. A standard that kept the buyer would put Andrew's name
   on Conor's purchase agreement, and nothing on the screen would say so. */
t("Andrew's name cannot reach Conor's papers", () => {
  const conor = { ...P.DEFAULTS, buyer: "Conor Dolan",
    agreedOn: "2026-09-14", leaseFrom: "2026-10-01", parkName: "Northside" };
  const out = H.applyHouse(conor, H.houseStandard(ANDREW));
  return out.buyer === "Conor Dolan" && out.agreedOn === "2026-09-14"
    && out.leaseFrom === "2026-10-01" && out.parkName === "Northside"
    // ...and the terms DID come across, or this check passes on a no-op.
    && out.lotRent === 375 && out.graceDays === 10 && out.leaseForm === "investor";
});

/* The belt-and-braces path: a row written before DEAL_ONLY grew, or typed
   into the SQL editor by hand, still cannot name the wrong purchaser. */
t("a stored standard that does carry a name is stripped on the way in", () => {
  const poisoned = { ...ANDREW };           // deal-only keys and all
  const conor = { ...P.DEFAULTS, buyer: "Conor Dolan", agreedOn: "2026-09-14" };
  const out = H.applyHouse(conor, poisoned);
  return out.buyer === "Conor Dolan" && out.agreedOn === "2026-09-14"
    && out.lotRent === 375;
});

/* A standard saved before a switch existed must leave that switch alone
   rather than blanking it. The base has a value the DEFAULTS do not, so
   "left alone" and "reset to the default" are different answers. */
t("a term the standard does not carry is left as it was", () => {
  const base = { ...P.DEFAULTS, buyer: "Conor Dolan", reserveCap: 9100 };
  const out = H.applyHouse(base, { lotRent: 375 });
  return out.reserveCap === 9100 && out.lotRent === 375;
});

/* AND A KEY THE STANDARD HOLDS AS NOTHING. Object.entries never yields an
   undefined for a key that was simply absent, so the check above cannot
   tell the undefined guard from no guard at all -- it passed with that
   line deleted. Only an EXPLICIT undefined asks it, which is what a
   caller handing over a Partial built by hand produces. */
t("a term the standard holds as nothing does not blank the deal's", () => {
  const base = { ...P.DEFAULTS, buyer: "Conor Dolan", graceDays: 21 };
  const out = H.applyHouse(base, { lotRent: 375, graceDays: undefined });
  return out.graceDays === 21 && out.lotRent === 375;
});

t("no standard at all changes nothing", () => {
  const base = { ...P.DEFAULTS, buyer: "Conor Dolan", lotRent: 410 };
  return JSON.stringify(H.applyHouse(base, null)) === JSON.stringify(base);
});

// ------------------------------------------------------- the order on screen
const screen = readFileSync(join(app, "components", "OwnerScreen.tsx"), "utf8");
/* Cut the seed effect out before matching inside it. An anchor that runs
   on past its own block matched the `.eq` in the NEXT one once already. */
const seed = (() => {
  const at = screen.indexOf("const first: Held | undefined = homes[0];");
  return at < 0 ? "" : screen.slice(at, screen.indexOf("setSeeded(true);", at));
})();

t("the seed effect exists to be read", () => seed.length > 200);

/* The standard goes UNDER, the sale's own figures OVER. Asked by position
   rather than by pattern: a regex for "applyHouse comes first" matches
   none of the ways that line can be written, and the fault is an ordering
   -- the same reason send-check compares positions. */
t("the standard is laid under the figures read off the homes", () => {
  const under = seed.indexOf("applyHouse(");
  const rate = seed.indexOf("ratePct:");
  const rent = seed.indexOf("lotRent:");
  return under > -1 && rate > under && rent > under;
});

t("and nothing is seeded until the standard has answered", () => {
  const guard = seed.slice(0, 1) === "" ? "" : screen.slice(
    screen.indexOf("if (seeded || !owner"),
    screen.indexOf("const first: Held | undefined = homes[0];"));
  return /!houseRead/.test(guard);
});

/* A guard that names a setter is a guard the next rename walks past, so
   the name is read out of its own declaration. */
const houseSetter = (screen.match(
  /const \[house, (\w+)\] = useState<Partial<Terms> \| null>/) ?? [])[1];
t("the standard's state has a setter to find", () => !!houseSetter);
t("and the standard is not written before the answer is read", () => {
  const block = screen.slice(screen.indexOf('fetch("/api/house-terms"'),
    screen.indexOf('setHouseRead(true)'));
  const wrote = block.indexOf(`${houseSetter}(`);
  const read = block.indexOf("await res.json()");
  return wrote > read;
});

// ------------------------------------------------- sending keeps the terms
const sendRoute = readFileSync(
  join(app, "app", "api", "owners", "[id]", "send", "route.ts"), "utf8");

t("sending keeps the deal that produced the pack", () =>
  /from\("deal_drafts"\)\s*\.upsert\(/.test(sendRoute.replace(/\s+/g, " ")
    .replace(/ \./g, ".")));

/* The pack is the thing that must not be lost. Keeping the draft is worth
   doing and is not worth refusing a send over, so it comes after the pack
   is stored and does not throw. */
t("and does it after the pack is stored, not instead of it", () => {
  const pack = sendRoute.indexOf('from("signing_requests").insert(');
  const draft = sendRoute.indexOf('from("deal_drafts").upsert(');
  return pack > -1 && draft > pack;
});

t("a draft that did not save is said out loud, not swallowed", () =>
  /draftSaid/.test(sendRoute) && /draftSaid/.test(screen));

t("the screen sends the deal with the pack", () => {
  const block = screen.slice(screen.indexOf("const sendIt = async"),
    screen.indexOf("const sendIt = async") + 2200);
  return /\bdeal,/.test(block);
});

/* And it may not report the deal as kept when the server said it was not
   -- that is the fault this whole thing exists to fix, in new clothes. */
t("and does not call it saved when the server said it was not", () => {
  const block = screen.slice(screen.indexOf("const sendIt = async"),
    screen.indexOf("const sendIt = async") + 3400);
  return /if \(!out\.draftSaid\) \{[\s\S]{0,200}?setDrafted\(true\)/.test(block);
});

// ------------------------------------------------------------- the route
const route = readFileSync(
  join(app, "app", "api", "house-terms", "route.ts"), "utf8");
t("the route strips on the way in", () => {
  const put = route.slice(route.indexOf("export async function PUT"));
  return /houseStandard\(/.test(put);
});
t("and on the way out", () => {
  const get = route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function PUT"));
  return /houseStandard\(/.test(get);
});
t("and a read-only guest may not set it", () =>
  /isDesk\(staff\.role\)/.test(
    route.slice(route.indexOf("export async function PUT"))));

// -------------------------------------------- the migration, run not read
const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/lib/postgresql/17/bin", "/usr/local/pgsql/bin"]
  .find((d) => existsSync(join(d, "initdb")));

if (!BIN) {
  /* A SKIP IS AS LOUD AS A FAILURE HERE. Four harnesses in this directory
     skipped silently in every cloud session for months. */
  checks.push(["the migration was run against a real postgres", false,
    "no postgres on this machine — the SQL has NOT been checked"]);
} else {
  const PORT = "55467";
  const dir = mkdtempSync(join(tmpdir(), "house-check-"));
  const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  const asPg = (line) => {
    try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
    catch { return ["sh", ["-c", line]]; }
  };
  try {
    run("chmod", ["777", dir]);
    run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
    run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
    await new Promise((r) => setTimeout(r, 1500));

    const psql = (sql) => run("psql",
      ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
      .split("\n")[0].trim();
    const psqlEnd = (sql) => run("psql",
      ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
      .split("\n").map((x) => x.trim()).filter(Boolean).pop() ?? "";
    const refuses = (sql) => { try { psql(sql); return false; } catch { return true; } };

    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
      "-c", "create database t"]);
    psql(`
      create role authenticated; create role anon;
      create or replace function is_active_staff() returns boolean
        language sql stable as $$ select true $$;
      create table staff (id uuid primary key default gen_random_uuid(), full_name text);
      -- The case the revoke exists for, as a DEFAULT privilege: a plain
      -- grant on all tables reaches only ones that already exist, so the
      -- revoke would have nothing to take back and both checks below
      -- would pass with it deleted.
      alter default privileges in schema public grant all on tables to authenticated;
    `);

    let applied = true, why = "";
    try {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
        "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    } catch (e) {
      applied = false;
      why = String(e.stderr ?? e.message).replace(/\s+/g, " ").trim().slice(0, 240);
    }
    checks.push(["the migration applies", applied, why]);
    if (!applied) throw new Error("stopping: nothing below can be true");

    t("and applies again, because it will be pasted twice", () => {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
        "-v", "ON_ERROR_STOP=1", "-f", SQL]);
      return true;
    });

    const who = psql("insert into staff (full_name) values ('Ben') returning id");

    t("a standard can be kept", () => {
      psql(`insert into house_terms (terms, by_staff)
            values ('{"lotRent":375,"graceDays":10}', '${who}')`);
      return psql("select terms->>'lotRent' from house_terms") === "375";
    });

    /* ONE ROW IS THE WHOLE IDEA. Two standards is no standard, and the
       screen would read whichever came back first. */
    t("a second standard is refused", () =>
      refuses(`insert into house_terms (terms) values ('{"lotRent":99}')`));
    t("and so is one calling itself something other than the row", () =>
      refuses(`insert into house_terms (only_row, terms)
               values (false, '{"lotRent":99}')`));

    t("and keeping it again replaces the one that is there", () => {
      psql(`insert into house_terms (only_row, terms) values (true, '{"lotRent":410}')
            on conflict (only_row) do update set terms = excluded.terms`);
      return psql("select terms->>'lotRent' from house_terms") === "410"
        && psql("select count(*) from house_terms") === "1";
    });

    t("losing the person who set it does not lose the standard", () => {
      psql(`delete from staff where id = '${who}'`);
      return psql("select count(*) from house_terms") === "1"
        && psql("select by_staff is null from house_terms") === "t";
    });

    t("a signed-in client may read it", () =>
      psqlEnd("set role authenticated; select count(*) from house_terms") === "1");
    t("and may not change the terms every future deal starts from", () =>
      refuses(`set role authenticated;
               update house_terms set terms = '{"lotRent":1}'`));
    t("nor delete it", () =>
      refuses("set role authenticated; delete from house_terms"));
    t("and a caller with no session sees nothing at all", () =>
      refuses("set role anon; select count(*) from house_terms"));

  } catch (e) {
    const why = String(e && e.message || e).replace(/\s+/g, " ").trim();
    if (!/^stopping:/.test(why)) checks.push(["the harness ran to the end", false, why]);
  } finally {
    try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* down */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

rmSync(join(lib, "house-terms.gen.mjs"), { force: true });
rmSync(join(lib, "papers.gen.mjs"), { force: true });

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("one set of terms, carried forward, and nobody's name with it");
