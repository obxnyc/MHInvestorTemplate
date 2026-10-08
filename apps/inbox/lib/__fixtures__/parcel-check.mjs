/**
 * Asking a county for a parcel, against a stand-in for their server.
 *
 * arcgis.com cannot be reached from the machine this was written on, so
 * the live call is unverifiable here. What IS verifiable is everything
 * between the parcel number and the request: which field is asked for
 * first, how the comparison is written, and what is made of the answer.
 * That is where the bugs are, and a county's real server is a poor
 * place to find them.
 *
 *     node lib/__fixtures__/parcel-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(here, "agol.ts"), "utf8").replace(/^import type .*$/gm, "");
writeFileSync(join(here, "agol.gen.mjs"),
  ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText);
const { pinFields, parcelByPin, parcelByAddress, outerRing, asked } =
  await import(join(here, "agol.gen.mjs"));

const square = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
const sent = [];

/** A county server that holds one parcel, under a field name we choose. */
function county({ fields, pinField, pin, geometry }) {
  return async (url) => {
    sent.push(url);
    if (!url.includes("/query")) {
      return { ok: true, json: async () => ({ fields: fields.map((name) => ({ name })) }) };
    }
    const where = (new URL(url).searchParams.get("where") ?? "");
    // Only the real field, compared the way the caller wrote it, matches.
    const hit = where.startsWith(`UPPER(REPLACE(${pinField},`)
      && where.includes(`'${pin}'`);
    return {
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: hit ? [{ geometry, properties: { [pinField]: pin } }] : [],
      }),
    };
  };
}

const wrong = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) wrong.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  else console.log(` ok  ${name}`);
};

// --- which field gets asked for, and in what order ---
global.fetch = county({ fields: ["OBJECTID", "OWNER", "PIN", "PARCEL_ADDRESS"], pinField: "PIN", pin: "P139-50A", geometry: null });
// PARCEL_ADDRESS is deliberately not in this list. Searching an address
// column for "P139-50A" is a query that can only ever come back empty,
// and every one of those is a round trip to a county server before the
// field that would have worked is reached.
is("a field called PIN is taken, an address field is not",
   await pinFields("x"), ["PIN"]);

global.fetch = county({ fields: ["OBJECTID", "parno", "ownname", "siteaddress"], pinField: "parno", pin: "x", geometry: null });
// North Carolina's statewide layer -- the one that covers every park
// here -- calls it parno, which the first version of this matched on
// none of.
is("North Carolina's own parno is recognised", await pinFields("x"), ["parno"]);

global.fetch = county({ fields: ["OBJECTID", "GPIN", "PARCELID", "SHAPE"], pinField: "GPIN", pin: "x", geometry: null });
is("GPIN and PARCELID are both recognised", (await pinFields("x")).slice(0, 2), ["GPIN", "PARCELID"]);

global.fetch = county({ fields: ["OBJECTID", "OWNER_NAME", "SHAPE_Area"], pinField: "", pin: "", geometry: null });
is("a layer with no parcel number offers nothing", await pinFields("x"), []);

// --- finding the parcel ---
const geom = { type: "Polygon", coordinates: square(-76.29, 36.369, 0.002) };
sent.length = 0;
global.fetch = county({ fields: ["OBJECTID", "REID", "PIN"], pinField: "PIN", pin: "P139-50A", geometry: geom });
const hit = await parcelByPin("https://county/0", "P139-50A");
is("the parcel comes back", hit?.field, "PIN");
is("with its boundary", outerRing(hit?.geometry).length, 5);

// --- the things that make a real lookup miss ---
sent.length = 0;
global.fetch = county({ fields: ["PIN"], pinField: "PIN", pin: "P139-50A", geometry: geom });
is("lower case on the card still matches",
   Boolean(await parcelByPin("https://county/0", "p139-50a")), true);

sent.length = 0;
is("a space in the number still matches",
   Boolean(await parcelByPin("https://county/0", " P139 - 50A ".replace(/ - /g, "-"))), true);

// The one that matters: the likeliest field is asked first, and when
// it comes back empty the next one is tried rather than the lookup
// giving up. A county whose number lives in REID while it also has a
// column called PIN is exactly the case that looks like "no such
// parcel" when this is wrong.
sent.length = 0;
global.fetch = county({ fields: ["PIN", "REID"], pinField: "REID", pin: "P139-50A", geometry: geom });
const second = await parcelByPin("https://county/0", "P139-50A");
is("a miss on the first field falls through to the next", second?.field, "REID");
// The innermost REPLACE names the column; the outer one is the
// separator-stripping retry, which is a second attempt at the SAME
// field and not a different field.
const tried = sent.filter((u) => u.includes("/query"))
  .map((u) => {
    const w = (new URL(u).searchParams.get("where"));
    return [...w.matchAll(/REPLACE\((\w+)[,)]/g)].map((m) => m[1])
      .filter((n) => n !== "REPLACE").pop();
  });
is("and asked them in that order", [...new Set(tried)], ["PIN", "REID"]);
is("each field is tried both ways before moving on",
   tried.filter((f) => f === "PIN").length, 2);

// An apostrophe in a parcel number is not a way into the query.
sent.length = 0;
global.fetch = county({ fields: ["PIN"], pinField: "PIN", pin: "x", geometry: geom });
await parcelByPin("https://county/0", "P139'OR 1=1--");
const inj = decodeURIComponent(new URL(sent.find((u) => u.includes("/query"))).searchParams.get("where"));
is("an apostrophe is doubled, not passed through", inj.includes("''"), true);

// --- a county that has nothing ---
global.fetch = async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) });
is("no parcel is null, not a crash", await parcelByPin("https://county/0", "nope", ["PIN"]), null);

global.fetch = async () => { throw new Error("no route to host"); };
is("an unreachable county is null, not a throw",
   await parcelByPin("https://county/0", "P139-50A", ["PIN"]), null);

// --- why it failed, which is the whole point of asking ---
//
// "nothing numbered P139-50A, or the service did not answer" went to
// the owner as a diagnosis. It is three different failures in one
// sentence, and the real one -- a server that wants a sign-in -- was
// not among the two it offered.

global.fetch = async () => ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) });
is("a 404 says so", (await asked("https://x")).why, "the server answered 404 Not Found");

// ArcGIS answers 200 with the refusal inside, which is its own trap.
global.fetch = async () => ({
  ok: true, status: 200, json: async () => ({ error: { code: 499, message: "Token Required" } }),
});
const tok = await asked("https://x");
is("a token demand is not an empty layer", tok.data, null);
is("and it says which it is", tok.why, "Token Required \u2014 it wants a sign-in");

global.fetch = async () => { throw new Error("The operation was aborted due to timeout"); };
is("a timeout says so", (await asked("https://x")).why, "it did not answer in time");

global.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND nope.example"); };
is("an unreachable host says what it said",
   (await asked("https://x")).why, "getaddrinfo ENOTFOUND nope.example");

// And the reason comes back up through the lookup, per field.
global.fetch = async (url) => (String(url).includes("/query")
  ? { ok: true, status: 200, json: async () => ({ error: { code: 499, message: "Token Required" } }) }
  : { ok: true, status: 200, json: async () => ({ fields: [{ name: "parno" }] }) });
const notes = [];
await parcelByPin("https://county/1", "P139-50A", undefined, notes);
is("the reason reaches the caller", notes[0], "parno: Token Required \u2014 it wants a sign-in");

// A layer with nothing parcel-shaped in it is its own answer, not a
// silent miss that reads as the parcel not existing.
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ fields: [{ name: "OWNER" }] }) });
const none = [];
await parcelByPin("https://county/1", "P139-50A", undefined, none);
is("a layer with no parcel column says that",
   none[0], "that layer has no field that looks like a parcel number");

// --- found by address, when the number is not the key ---
//
// "P139-50A" off a tax card need not be what the table is indexed on;
// the county's own file names suggest an internal id and a numeric pin
// alongside it. An address is the same string in all three places.

/** A county holding one parcel, found only by its address field. */
function byAddress({ field, value, geometry }) {
  return async (url) => {
    if (!String(url).includes("/query")) {
      return { ok: true, status: 200, json: async () => ({
        fields: [{ name: "OBJECTID" }, { name: "OWNER" }, { name: field }],
      }) };
    }
    const w = (new URL(url).searchParams.get("where") ?? "");
    const m = w.match(/UPPER\((\w+)\) LIKE '(\d+) %' AND UPPER\(\1\) LIKE '%([^']+)%'/);
    const hit = m && m[1] === field
      && value.toUpperCase().startsWith(`${m[2]} `) && value.toUpperCase().includes(m[3]);
    return { ok: true, status: 200, json: async () => ({
      type: "FeatureCollection",
      features: hit ? [{ geometry, properties: { [field]: value } }] : [],
    }) };
  };
}

global.fetch = byAddress({ field: "SITEADDRESS", value: "1140 NORTHSIDE RD", geometry: geom });
const byAddr = await parcelByAddress("https://county/1", "1140 Northside Rd, Elizabeth City NC");
is("found by its address", byAddr?.field, "SITEADDRESS");
is("with its boundary", outerRing(byAddr?.geometry).length, 5);

// "Road" against "RD", and doubled spaces, are the same place.
is("the street type does not have to match",
   Boolean(await parcelByAddress("https://county/1", "1140  Northside  Road")), true);

// The house number must still match, or every house on the road is a hit.
is("a different house number is not this parcel",
   await parcelByAddress("https://county/1", "1148 Northside Rd"), null);

const noAddr = [];
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ fields: [{ name: "PIN" }] }) });
await parcelByAddress("https://county/1", "1140 Northside Rd", noAddr);
is("a layer with no address field says so", noAddr[0], "that layer has no address field either");

const notAddr = [];
global.fetch = byAddress({ field: "SITEADDRESS", value: "x", geometry: geom });
await parcelByAddress("https://county/1", "Northside Road", notAddr);
is("something that is not an address says so",
   notAddr[0], '"Northside Road" is not a street address');

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
