// Choosing a property's county parcel, and the rule that the county's
// line is the default and a drawn one wins.
//
// Built from what the first real run did wrong: "128 Sunflower Ln" in
// Hertford came back as one match 347 km away, and a lone answer was
// taken without asking where it was. And "609 Foreman Bundy Rd"'s pin
// stood on 472 Okisko Rd's land.
//
//   node lib/__fixtures__/county-line-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(here, "parcel.ts"), "utf8");
const out = join(tmpdir(), `countyline-${process.pid}.mjs`);
writeFileSync(out, ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText);
const P = await import(out);

const results = [];
const t = (name, fn) => {
  let ok = false, why = "";
  try { ok = Boolean(fn()); } catch (e) { why = ` (threw: ${e.message})`; }
  results.push(`${ok ? "  ok " : "FAIL"}  ${name}${why}`);
};

const square = (lng, lat, d = 0.0005) =>
  [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]];
const parcel = (site, city, lng, lat) =>
  ({ attributes: { siteadd: site, scity: city }, geometry: { rings: square(lng, lat) } });

const pin = [-76.3301, 36.2367];
const far = parcel("00128 SUNFLOWER LN", "", -79.9, 35.1);
const near = parcel("00128 SUNFLOWER LN", "", pin[0], pin[1]);

t("a lone match far from the pin is refused", () =>
  P.choose([far], "128 Sunflower Ln, Hertford, NC 27944", pin) === null);
t("a lone match near the pin is taken", () =>
  P.choose([near], "128 Sunflower Ln, Hertford, NC 27944", pin) === near);
t("a lone match with no pin is taken", () =>
  P.choose([far], "128 Sunflower Ln, Hertford, NC 27944", null) === far);
t("two matches and no pin: nothing is chosen", () =>
  P.choose([far, near], "128 Sunflower Ln, Hertford, NC 27944", null) === null);
t("of two, the nearer the pin is chosen", () =>
  P.choose([far, near], "128 Sunflower Ln, Hertford, NC 27944", pin) === near);
// The city narrows first: the out-of-town one is NEARER the pin, so only
// the town rule can choose the other.
const town = parcel("01002 MAPLE ST", "ELIZABETH CITY", pin[0] + 0.004, pin[1]);
const elsewhere = parcel("01002 MAPLE ST", "GATESVILLE", pin[0], pin[1]);
t("the property's own town wins over a nearer match elsewhere", () =>
  P.choose([elsewhere, town], "1002 Maple St, Elizabeth City, NC 27909", pin) === town);

t("the address key keeps the number and the street", () =>
  P.addressKey("1142 Northside Rd, Elizabeth City, NC 27909") === "1142 NORTHSIDE");
t("and a leading direction", () =>
  P.addressKey("220-222 N Poindexter St, Elizabeth City") === "220 N POINDEXTER");

t("a parcel under the pin with another house number is not this house", () =>
  !P.sameHouse({ attributes: { siteadd: "00472 OKISKO RD" } }, "609 Foreman Bundy Rd"));
t("the same number with zeros in front is", () =>
  P.sameHouse({ attributes: { siteadd: "00609 FOREMAN BUNDY RD" } }, "609 Foreman Bundy Rd"));
t("a county that publishes no address is taken at its pin", () =>
  P.sameHouse({ attributes: { siteadd: "" } }, "112 Mullen Ct"));

// --- the rule in the route: county is the default, a drawn line wins ---
const route = readFileSync(join(here, "..", "app/api/properties/[id]/plan/route.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const block = route.slice(route.indexOf("const countyRing"), route.indexOf("return NextResponse.json({\n    property"));
t("a drawn line is never replaced by the county's", () =>
  /const drawn = [^;]*fence[^;]*length > 3/.test(block) && /else if \(!drawn\)/.test(block));
t("the county's line is only filled in, never saved over a plan", () =>
  !/\.update\(\{\s*plan/.test(block));

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("FAIL")).length;
console.log(bad ? `\n${bad} failed` : "\nparcels hold");
process.exit(bad ? 1 : 0);
