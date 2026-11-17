/* Driving for dollars: the two rules the rest stands on.
 *
 *   1. A sighting may carry only photos THIS person uploaded through the
 *      app in the last hour (photoPathOk). Each way round it can be wrong
 *      has a case: another person's id, an hour and a minute old, a path
 *      that did not come from the upload route, a time in the future.
 *   2. The county's reply is read into four answers, not two
 *      (readParcelReply): found / none / failed, and outside before asking.
 *      "No owner" and "could not ask" must not look alike.
 *
 * Run: node --experimental-strip-types lib/__fixtures__/scout-check.mjs
 */
import { photoPathOk } from "../scout.ts";
import { readParcelReply, inNC, settle } from "../parcel-lookup.ts";

const out = [];
const t = (name, fn) => { try { out.push([fn() ? "ok  " : "FAIL", name]); } catch (e) { out.push(["FAIL", `${name} (threw: ${e.message})`]); } };

const me = "22222222-2222-2222-2222-222222222222";
const other = "11111111-1111-1111-1111-111111111111";
const now = 1_800_000_000_000;
const p = (id, ms, ext = "jpg") => `scout/${id}/${ms}-ab12cd.${ext}`;

t("my photo from a minute ago is accepted", () => photoPathOk(p(me, now - 60_000), me, now));
t("somebody else's photo is refused", () => !photoPathOk(p(other, now - 60_000), me, now));
t("a photo 61 minutes old is refused", () => !photoPathOk(p(me, now - 61 * 60_000), me, now));
t("a photo 59 minutes old is accepted", () => photoPathOk(p(me, now - 59 * 60_000), me, now));
t("a time in the future is refused", () => !photoPathOk(p(me, now + 5 * 60_000), me, now));
t("a clock-in photo path is refused", () => !photoPathOk(`clock/${me}/${now}-face.jpg`, me, now));
t("a path climbing out of the folder is refused", () => !photoPathOk(`scout/${me}/../${other}/${now}-ab12cd.jpg`, me, now));
t("a file that is not a photo is refused", () => !photoPathOk(p(me, now, "pdf"), me, now));

t("Goldsboro is in NC", () => inNC(35.385, -77.99));
t("Myrtle Beach is not", () => !inNC(33.69, -78.89));
t("Atlanta is not (it is inside NC's bounding box)", () => !inNC(33.75, -84.39));
t("Greenville SC is not (also inside the box)", () => !inNC(34.85, -82.4));
t("Sanford is", () => inNC(35.48, -79.18));
t("Manteo, on the Outer Banks side, is", () => inNC(35.91, -75.67));
t("Murphy, in the far west, is", () => inNC(35.09, -84.03));
// Fort Mill SC, a mile or two over the line: asked about (near the edge),
// and the NC layer's "nothing here" then reads as another state.
t("Fort Mill SC, just over the line, is still asked about", () => inNC(35.06, -80.95));
t("...and NC's empty answer there reads as outside, not as a road", () => settle({ lookup: "none" }, 35.06, -80.95).lookup === "outside");
t("an empty answer inside NC stays none", () => settle({ lookup: "none" }, 35.385, -77.99).lookup === "none");
t("a found parcel just over the line is kept (the county knows best)", () => settle({ lookup: "found", owner_name: "X" }, 35.06, -80.95).lookup === "found");

const two = { features: [
  { attributes: { ownname: "SMALL LOT LLC", gisacres: 0.3, cntyname: "Wayne" } },
  { attributes: { ownname: "PINE HOLLOW MHP LLC", ownname2: null, mailadd: "PO BOX 112", mcity: "GOLDSBORO", mstate: "NC", mzip: "27530",
                  siteadd: "1200 PINE HOLLOW RD", scity: "GOLDSBORO", cntyname: "Wayne", parno: "2599", gisacres: 12.4, parval: 610000 } },
] };
const r = readParcelReply(two);
t("a point on two parcels takes the bigger one", () => r.lookup === "found" && r.owner_name === "PINE HOLLOW MHP LLC");
t("the mailing address is put together", () => r.mail_address === "PO BOX 112 GOLDSBORO, NC 27530");
t("acres and value are numbers", () => r.acres === 12.4 && r.assessed === 610000);
t("no parcel there reads as none, not failed", () => readParcelReply({ features: [] }).lookup === "none");
t("a county error reads as failed, not none", () => readParcelReply({ error: { message: "Invalid query" } }).lookup === "failed");
t("a reply that is not data reads as failed", () => readParcelReply(null).lookup === "failed");
t("an empty owner field is null, not an empty string", () => readParcelReply({ features: [{ attributes: { ownname: "  " } }] }).owner_name === null);

for (const [s, n] of out) console.log(s, n);
const bad = out.filter(([s]) => s === "FAIL").length;
console.log(bad ? `${bad} failed` : `all ${out.length} passed`);
process.exit(bad ? 1 : 0);
