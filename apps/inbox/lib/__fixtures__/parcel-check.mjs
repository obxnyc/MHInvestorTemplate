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
const { pinFields, parcelByPin, outerRing } = await import(join(here, "agol.gen.mjs"));

const square = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]];
const asked = [];

/** A county server that holds one parcel, under a field name we choose. */
function county({ fields, pinField, pin, geometry }) {
  return async (url) => {
    asked.push(url);
    if (!url.includes("/query")) {
      return { ok: true, json: async () => ({ fields: fields.map((name) => ({ name })) }) };
    }
    const where = decodeURIComponent(new URL(url).searchParams.get("where") ?? "");
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
asked.length = 0;
global.fetch = county({ fields: ["OBJECTID", "REID", "PIN"], pinField: "PIN", pin: "P139-50A", geometry: geom });
const hit = await parcelByPin("https://county/0", "P139-50A");
is("the parcel comes back", hit?.field, "PIN");
is("with its boundary", outerRing(hit?.geometry).length, 5);

// --- the things that make a real lookup miss ---
asked.length = 0;
global.fetch = county({ fields: ["PIN"], pinField: "PIN", pin: "P139-50A", geometry: geom });
is("lower case on the card still matches",
   Boolean(await parcelByPin("https://county/0", "p139-50a")), true);

asked.length = 0;
is("a space in the number still matches",
   Boolean(await parcelByPin("https://county/0", " P139 - 50A ".replace(/ - /g, "-"))), true);

// The one that matters: the likeliest field is asked first, and when
// it comes back empty the next one is tried rather than the lookup
// giving up. A county whose number lives in REID while it also has a
// column called PIN is exactly the case that looks like "no such
// parcel" when this is wrong.
asked.length = 0;
global.fetch = county({ fields: ["PIN", "REID"], pinField: "REID", pin: "P139-50A", geometry: geom });
const second = await parcelByPin("https://county/0", "P139-50A");
is("a miss on the first field falls through to the next", second?.field, "REID");
// The innermost REPLACE names the column; the outer one is the
// separator-stripping retry, which is a second attempt at the SAME
// field and not a different field.
const tried = asked.filter((u) => u.includes("/query"))
  .map((u) => {
    const w = decodeURIComponent(new URL(u).searchParams.get("where"));
    return [...w.matchAll(/REPLACE\((\w+)[,)]/g)].map((m) => m[1])
      .filter((n) => n !== "REPLACE").pop();
  });
is("and asked them in that order", [...new Set(tried)], ["PIN", "REID"]);
is("each field is tried both ways before moving on",
   tried.filter((f) => f === "PIN").length, 2);

// An apostrophe in a parcel number is not a way into the query.
asked.length = 0;
global.fetch = county({ fields: ["PIN"], pinField: "PIN", pin: "x", geometry: geom });
await parcelByPin("https://county/0", "P139'OR 1=1--");
const inj = decodeURIComponent(new URL(asked.find((u) => u.includes("/query"))).searchParams.get("where"));
is("an apostrophe is doubled, not passed through", inj.includes("''"), true);

// --- a county that has nothing ---
global.fetch = async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) });
is("no parcel is null, not a crash", await parcelByPin("https://county/0", "nope", ["PIN"]), null);

global.fetch = async () => { throw new Error("no route to host"); };
is("an unreachable county is null, not a throw",
   await parcelByPin("https://county/0", "P139-50A", ["PIN"]), null);

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
