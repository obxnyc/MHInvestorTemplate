/**
 * The office line: the parts of a phone call that fail silently.
 *
 *     node lib/__fixtures__/office-line-check.mjs
 *
 * A phone tree that is wrong does not throw. It plays a greeting to nobody,
 * asks for a second voicemail, rings a mailbox, or files every call as
 * answered by nobody -- and the first anybody hears of it is a tenant saying
 * they rang three times. So this checks the things that go wrong quietly:
 *
 *   1. Office hours, in the office's time zone, across both halves of the
 *      year. Vercel's clock is UTC; a check written against it closes the
 *      office an hour early from March to November.
 *   2. The instructions handed to Twilio. An `&` in a URL inside a TwiML
 *      attribute is not XML, and the menu shipped with exactly that.
 *   3. The rules that keep a call from going nowhere -- the voicemail that
 *      asks for a second voicemail, the text promised before it was sent,
 *      who answered written from a number that is always the office's.
 *   4. Migration 069, run against a real Postgres twice, and the tree it
 *      builds walked key by key.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const read = (p) => readFileSync(join(app, p), "utf8");
/** Comments out, so a rule cannot be satisfied by the sentence explaining it. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const results = [];
const t = (name, fn) => {
  try { results.push([name, !!fn(), ""]); }
  catch (e) { results.push([name, false, `threw: ${e.message}`]); }
};

/* ------------------------------------------------------------ 1. hours */

const src = read("lib/hours.ts");
const gen = join(here, "hours.gen.mjs");
writeFileSync(gen, ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText);
const { isOpen } = await import(gen);
rmSync(gen);

const H = { tz: "America/New_York", open_at: "08:00:00", close_at: "18:00:00", open_days: [1, 2, 3, 4, 5] };
const at = (iso) => new Date(iso);

// Monday 6 July 2026 is daylight time (UTC-4); Monday 7 December is standard (UTC-5).
t("summer: 5:30 pm on a Monday is open", () => isOpen(H, at("2026-07-06T21:30:00Z")));
t("summer: 6:05 pm on a Monday is closed", () => !isOpen(H, at("2026-07-06T22:05:00Z")));
t("winter: 5:30 pm on a Monday is open", () => isOpen(H, at("2026-12-07T22:30:00Z")));
t("winter: 6:05 pm on a Monday is closed", () => !isOpen(H, at("2026-12-07T23:05:00Z")));
t("8:00 exactly is open", () => isOpen(H, at("2026-12-07T13:00:00Z")));
t("7:59 is closed", () => !isOpen(H, at("2026-12-07T12:59:00Z")));
t("6:00 exactly is closed -- 5:59 is the last minute answered", () => !isOpen(H, at("2026-12-07T23:00:00Z")));
t("Saturday at noon is after hours", () => !isOpen(H, at("2026-12-05T17:00:00Z")));
t("Sunday at noon is after hours", () => !isOpen(H, at("2026-12-06T17:00:00Z")));
// 01:30 UTC on Saturday is still Friday 8:30 pm in New York. A check on the
// UTC weekday calls it Saturday; a check on the UTC hour calls it open.
t("Friday evening in New York is not Saturday in UTC terms", () => !isOpen(H, at("2026-12-05T01:30:00Z")));
t("Saturday opening hours, if set, are honoured",
  () => isOpen({ ...H, open_days: [1, 2, 3, 4, 5, 6] }, at("2026-12-05T17:00:00Z")));
// The fixture must be able to tell local time from UTC, or it proves nothing.
t("the fixture distinguishes UTC from New York", () =>
  new Date("2026-07-06T21:30:00Z").getUTCHours() >= 18);

/* ------------------------------------------------------------ 1b. who keeps ringing */

const rsrc = read("lib/ringorder.ts");
const rgen = join(here, "ringorder.gen.mjs");
writeFileSync(rgen, ts.transpileModule(rsrc, { compilerOptions: { target: 99, module: 99 } }).outputText);
const { keepRinging } = await import(rgen);
rmSync(rgen);
const P = (name, phone) => ({ id: name, name, phone, staffId: null });
const hannah = P("Hannah", "+1"), natashia = P("Natashia", "+2"), sam = P("Samantha", "+3"), cade = P("Cade", "+4");
const office = keepRinging([
  { position: 2, seconds: 12, people: [sam] },        // out of order on purpose
  { position: 1, seconds: 12, people: [hannah, natashia] },
  { position: 3, seconds: 12, people: [cade] },
]);
const names = (st) => st.people.map((p) => p.name).join(",");
t("Hannah keeps ringing after her twelve seconds: rung 2 is Hannah, Natashia AND Samantha",
  () => names(office[1]) === "Hannah,Natashia,Samantha");
t("rung 3 is everybody", () => names(office[2]) === "Hannah,Natashia,Samantha,Cade");
t("rung 1 is still only the front desk", () => names(office[0]) === "Hannah,Natashia");
t("nobody is dialled twice on one rung, and a rung adding nobody is dropped", () => {
  const twice = keepRinging([
    { position: 1, seconds: 12, people: [cade] },
    { position: 2, seconds: 12, people: [cade] },
    { position: 3, seconds: 12, people: [cade, natashia] },
  ]);
  return twice.length === 2 && names(twice[1]) === "Cade,Natashia";
});
t("the ring list uses it unless a group says otherwise", () =>
  /keep_ringing === false \? stages : keepRinging\(stages\)/.test(code("lib/voice.ts")));

/* ------------------------------------------------------------ 1c. transfer by text */

const wsrc = read("lib/transfer-words.ts");
const wgen = join(here, "transfer-words.gen.mjs");
writeFileSync(wgen, ts.transpileModule(wsrc, { compilerOptions: { target: 99, module: 99 } }).outputText);
const { parseTransfer, resolveTarget } = await import(wgen);
rmSync(wgen);
const LIST = [{ id: "h", name: "Hannah Pappas" }, { id: "s", name: "Samantha Graber" },
  { id: "c", name: "Cade Larabee" }, { id: "n", name: "Natashia" }, { id: "w", name: "William Nelson" }];
t("'transfer Samantha' is a transfer to Samantha", () =>
  parseTransfer("transfer Samantha") === "Samantha"
  && resolveTarget("Samantha", LIST).target?.personId === "s");
t("a first name, a surname or the start of one finds the person", () =>
  resolveTarget("sam", LIST).target?.personId === "s"
  && resolveTarget("nelson", LIST).target?.personId === "w");
t("'xfer leasing' is the leasing team", () =>
  resolveTarget(parseTransfer("XFER leasing"), LIST).target?.routeKey === "rent");
t("an ordinary text is not a transfer -- 'T-Mobile says...', 'the tenant called'", () =>
  parseTransfer("T-Mobile says my bill is late") === null
  && parseTransfer("the tenant at lot 4 called") === null
  && parseTransfer("transferred the deposit yesterday") === null);
t("a name that could be two people is a question, not a guess", () => {
  const two = [...LIST, { id: "h2", name: "Hannah Brooks" }];
  return "error" in resolveTarget("hannah", two);
});
t("nobody by that name is said, not silently dropped", () => "error" in resolveTarget("zelda", LIST));
const sms = code("app/api/twilio/sms/route.ts");
t("only a phone on the list can transfer by text", () =>
  /from\("phone_people"\)[\s\S]{0,120}\.eq\("phone", from\)/.test(sms) && /if \(!me\) return null;/.test(sms));
t("and only the call that phone is on", () => /\.eq\("answered_person", me\.id\)/.test(sms));
t("the command is handled before the text is filed as a message", () =>
  sms.indexOf("transferByText(from") > -1 && sms.indexOf("transferByText(from") < sms.indexOf("toEnglish(body)"));

/* ------------------------------------------------------------ 2. TwiML */

const VOICE = [
  "lib/voice.ts",
  "app/api/twilio/voice/route.ts",
  "app/api/twilio/voice/menu/route.ts",
  "app/api/twilio/voice/go/route.ts",
  "app/api/twilio/voice/ring/route.ts",
  "app/api/twilio/voice/whisper/route.ts",
  "app/api/twilio/voice/whisper/accept/route.ts",
  "app/api/twilio/voice/voicemail/route.ts",
  "app/api/twilio/voice/transfer/route.ts",
];
t("no raw & in a URL handed to Twilio inside TwiML", () => {
  const bad = [];
  for (const f of VOICE) {
    for (const line of code(f).split("\n")) {
      if (!/\/api\/twilio\/voice/.test(line)) continue;
      // Built by URLSearchParams and passed through escapeXml is fine.
      if (/escapeXml\(/.test(line)) continue;
      if (/[?&][a-z]=[^"`\s]*&(?!amp;)[a-z]=/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
  }
  if (bad.length) console.error(bad.join("\n"));
  return bad.length === 0;
});
t("the menu's own Gather URL escapes its ampersand", () =>
  /menu\?m=\$\{[^}]+\}`\s*\+\s*`&amp;a=/.test(code("lib/voice.ts")));

/* ------------------------------------------------------------ 3. rules */

const vm = code("app/api/twilio/voice/voicemail/route.ts");
t("voicemail's <Record> has an action, so it does not ask for a second message", () =>
  /<Record[^>]*action="/.test(vm.replace(/`\s*\+\s*`/g, "")));

const whisper = code("app/api/twilio/voice/whisper/route.ts");
t("the whisper's Gather has an action, so pressing 1 does not replay it", () =>
  /<Gather[^>]*action="\$\{accept\}"/.test(whisper));
t("the whisper says what kind of call it is", () => /route\?\.whisper/.test(whisper));

const accept = code("app/api/twilio/voice/whisper/accept/route.ts");
t("only 1 accepts", () => /params\.Digits !== "1"/.test(accept));
t("who answered is written when they press 1, against the CALLER's sid", () =>
  /answered_at:/.test(accept) && /\.eq\("twilio_call_sid", params\.ParentCallSid\)/.test(accept));

const ring = code("app/api/twilio/voice/ring/route.ts");
t("the phone that rings shows the office number", () => /callerId=/.test(ring));
t("each rung is the stage's own length, not a constant", () => /timeout="\$\{stage\.seconds\}"/.test(ring));
t("every phone has to press 1 (the whisper is on each number)", () =>
  /<Number url="\$\{base\}\/api\/twilio\/voice\/whisper/.test(ring));
t("a list that rings out is a missed call, before voicemail", () => {
  const block = ring.slice(ring.indexOf("if (!stage)"), ring.indexOf("if (!stage)") + 400);
  return block.indexOf("noAnswer(") > -1 && block.indexOf("noAnswer(") < block.indexOf("/voicemail");
});

t("a phone that belongs to a crew member's login is refused like any crew phone", () =>
  /role: m\.person\.staff\?\.role/.test(code("lib/voice.ts")));

const go = code("app/api/twilio/voice/go/route.ts");
t("the portal text is sent BEFORE the caller is told it was", () => {
  const block = go.slice(go.indexOf('action === "portal"'));
  const sent = block.indexOf("textCaller(");
  const told = block.indexOf('"portal_prompt"');
  return sent > -1 && told > -1 && sent < told;
});
t("a portal text that did not go is a voicemail, not a promise", () => {
  const block = go.slice(go.indexOf('action === "portal"'), go.indexOf('action === "leasing_voicemail"'));
  return /if \(sent\)/.test(block) && /return voicemail\(\)/.test(block);
});
t("hours are the ones the call arrived in, not the minute the menu ended", () =>
  /call\?\.after_hours != null \? !call\.after_hours/.test(go));

const log = code("lib/calllog.ts");
t("a call somebody answered is never marked missed", () => {
  const fn = log.slice(log.indexOf("export async function noAnswer"));
  return fn.indexOf("if (call.answered_at) return;") > -1
    && fn.indexOf("if (call.answered_at) return;") < fn.indexOf("missed: true");
});
t("one missed-call text per number per day", () => /gte\("missed_texted_at", since\)/.test(log));
t("a caller already texted the portal or the homes is not texted again", () =>
  /if \(!s\.missed_text_on \|\| call\.texted\) return;/.test(log));
t("texts only go to numbers the line can text", () => /canSmsFromLine\(contact\.phone\)/.test(log));

const rec = code("app/api/calls/recording/[sid]/route.ts");
t("recordings are played only to somebody signed in", () =>
  rec.indexOf("requireStaff()") > -1 && rec.indexOf("requireStaff()") < rec.indexOf("fetch("));
t("and only recordings that belong to a call on file", () => /no such recording/.test(rec));

const xfer = code("lib/transfer.ts");
t("a transfer is not reported done until Twilio took it", () =>
  xfer.indexOf(".update({") < xfer.lastIndexOf("ok: true"));
t("a call that already ended is refused, not 'transferred'", () => /already ended/.test(xfer));

const card = code("components/CallCard.tsx");
t("the call card reads the server's answer before saying anything worked", () =>
  /if \(!r\.ok \|\| body\.error\)/.test(card));

/* ------------------------------------------------------------ 4. the SQL */

const SQL012 = join(app, "..", "..", "docs", "shared-line", "012-call-flow.sql");
const SQL069 = join(app, "..", "..", "docs", "shared-line", "069-the-office-line.sql");
const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"]
  .find((d) => existsSync(join(d, "initdb")));

if (!BIN) {
  results.push(["migration 069 against a real Postgres", false,
    "NOT RUN: no postgres here. That is not a pass -- run this where there is one."]);
} else {
  const PORT = "55453";
  const dir = mkdtempSync(join(tmpdir(), "office-line-"));
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
  const asPg = (line) => {
    try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
    catch { return ["sh", ["-c", line]]; }
  };
  try {
    run("chmod", ["777", dir]);
    run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
    run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
    await new Promise((r) => setTimeout(r, 1500));
    const psql = (sql) => run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qtAc", sql]);
    const file = (f) => run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", f]);

    psql(`create table staff (id uuid primary key default gen_random_uuid(), full_name text not null,
            forward_to text, active boolean not null default true);
          create table contacts (id uuid primary key default gen_random_uuid(), phone text);
          create table calls (id uuid primary key default gen_random_uuid(), contact_id uuid,
            direction text, twilio_call_sid text, missed boolean, created_at timestamptz default now());
          create function is_active_staff() returns boolean language sql as 'select true';
          create role anon; create role authenticated;`);
    file(SQL012);

    let applied = true, why = "";
    try { file(SQL069); } catch (e) { applied = false; why = String(e.stderr ?? e).slice(0, 400); }
    results.push(["069 applies on a database built by 012", applied, why]);
    let replayed = true; why = "";
    try { file(SQL069); } catch (e) { replayed = false; why = String(e.stderr ?? e).slice(0, 400); }
    results.push(["069 applies a second time", replayed, why]);

    /** Follow digits from the root menu to wherever they end. */
    const walk = (digits) => {
      let menu = "root";
      for (const d of digits) {
        const row = psql(`select coalesce(n.key,''), coalesce(r.key,'') from call_options o
          join call_menus m on m.id=o.menu_id left join call_menus n on n.id=o.next_menu_id
          left join call_routes r on r.id=o.route_id where m.key='${menu}' and o.digit='${d}'`).trim();
        if (!row) return `nothing at ${menu}/${d}`;
        const [next, route] = row.split("|");
        if (route) return route;
        menu = next;
      }
      return `menu:${menu}`;
    };
    const route = (k) => psql(`select r.day_action||'|'||coalesce(dg.name,'')||'|'||r.night_action||'|'||coalesce(ng.name,'')
      from call_routes r left join ring_groups dg on dg.id=r.day_group left join ring_groups ng on ng.id=r.night_group
      where r.key='${k}'`).trim();

    t("1-1 is renting: rings the office by day, a message and listings at night", () =>
      walk("11") === "rent" && route("rent") === "ring|Office|leasing_voicemail|");
    t("2-1-1 is an emergency: the office by day, the on-call phones at night", () =>
      walk("211") === "emergency" && route("emergency") === "ring|Office|ring|Emergency on call");
    t("2-1-2 is maintenance that can wait: the portal, and no phone rings, day or night", () =>
      walk("212") === "maintenance" && route("maintenance") === "portal||portal|");
    t("3 is an offer on a property: the sellers' list", () =>
      walk("3") === "seller" && route("seller") === "ring|Sellers|voicemail|");
    t("4 is a vendor or contractor", () => walk("4") === "vendor");
    t("8 is Spanish, and 8-2-1-2 is the same maintenance route as 2-1-2", () =>
      walk("8") === "menu:es-root" && walk("8212") === "maintenance" && walk("8211") === "emergency");
    t("every Spanish menu is said in Spanish", () =>
      psql(`select count(*) from call_menus where key like 'es-%' and lang <> 'es'`).trim() === "0");
    t("'Para español, oprima 8' is announced, in Spanish, on the English menu", () =>
      psql(`select coalesce(o.announce_lang,'')||'|'||coalesce(o.announce,'') from call_options o
            join call_menus m on m.id=o.menu_id where m.key='root' and o.digit='8'`).trim()
        === "es|Para español, oprima 8.");
    t("rent-to-own is not advertised", () =>
      !/rent-to-own/i.test(psql(`select string_agg(prompt, ' ') from call_menus`)));
    t("the greeting does not say the call may be recorded", () =>
      !/recorded/i.test(psql(`select day_greeting||night_greeting from call_settings`)));
    t("no message promises a callback by a time", () =>
      !/by 10|first thing|next business/i.test(psql(
        `select voicemail_prompt||leasing_prompt||missed_text from call_settings`)));
    t("0 is everything else: the office", () =>
      walk("0") === "general" && route("general") === "ring|Office|voicemail|");
    t("9 is not on the menu: a person, not a link", () => walk("9").startsWith("nothing"));
    t("no option has two destinations, and none has none", () =>
      psql(`select count(*) from call_options where num_nonnulls(next_menu_id, ring_group_id, route_id) <> 1`).trim() === "0");
    t("the constraint has teeth: an option with two destinations is refused", () => {
      try {
        psql(`insert into call_options (menu_id, digit, label, next_menu_id, route_id)
          select m.id, '7', 'x', m.id, (select id from call_routes limit 1) from call_menus m where key='root'`);
        return false;
      } catch { return true; }
    });
    t("nothing pressed at a menu goes to a person, not to silence", () =>
      psql(`select count(*) from call_menus where key in ('root','sales','residents','maintenance')
            and fallback_route is null`).trim() === "0");
    t("each office rung is about two rings", () =>
      psql(`select string_agg(ring_seconds::text, ',' order by position) from ring_stages s
            join ring_groups g on g.id=s.group_id where g.name='Office'`).trim() === "12,12,12");
    t("no phone numbers are written into the migration", () =>
      !/\+1\d{10}/.test(readFileSync(SQL069, "utf8")));
  } catch (e) {
    results.push(["the Postgres harness itself", false, String(e.stderr ?? e.message).slice(0, 400)]);
  } finally {
    try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d stop -m immediate`)); } catch { /* already down */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

let bad = 0;
for (const [name, ok, why] of results) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${why ? `\n        ${why}` : ""}`);
}
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
