import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import {
  appIdFrom, layersOf, parcelLayers, parcelByPin, parcelByAddress,
  outerRing, geocode, serviceOf, centroid,
} from "@/lib/agol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The property line, from the county that drew it.
 *
 * A boundary traced with a mouse is somebody's recollection of a deed.
 * The county has the deed line, and their parcel viewer is already
 * showing it -- so the park's outline comes from there, by the number
 * on the tax card, rather than from a tool for drawing approximate
 * rectangles.
 *
 * Every county publishes this differently and none of it can be
 * checked from a machine with no route to arcgis.com, so each step
 * reports what it did. A failure that says "the app has no layer that
 * looks like parcels" is a failure somebody can act on; an empty
 * response is not.
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pin = String(body.pin ?? "").trim();
  const app = appIdFrom(String(body.app ?? ""));
  const steps: { did: string; ok: boolean; say: string }[] = [];

  if (!pin) return NextResponse.json({ error: "which parcel number" }, { status: 400 });

  /** What to do with a parcel once something has found it. */
  const answer = (
    hit: { geometry: unknown; props: Record<string, unknown>; field: string },
    layer: string,
  ) => {
    const ring = outerRing(hit.geometry);
    if (ring.length < 4) return null;
    const lng = ring.reduce((a, q) => a + q[0], 0) / ring.length;
    const lat = ring.reduce((a, q) => a + q[1], 0) / ring.length;
    steps.push({ did: `found ${pin}`, ok: true,
                 say: `in ${layer}, on ${hit.field}, ${ring.length} corners` });
    return NextResponse.json({
      ok: true, ring, centre: [lng, lat], layer,
      field: hit.field, props: hit.props, steps,
    });
  };

  // North Carolina publishes every county's parcels as one layer,
  // refreshed weekly, under a standard schema -- so the usual answer to
  // "where is P139-50A" needs no county link at all, and the same call
  // works for a park in Cumberland and a park in Pasquotank. Tried
  // first, because the alternative asks somebody to find a REST
  // endpoint, which is not a thing to ask.
  // Three ways at the same data, because the first one wants a sign-in
  // and only says so if you read the body.
  //
  //   the /secure/ server      token-protected, and answers 200 with an
  //                            error inside rather than a 401;
  //   the published items      the same layers as ArcGIS Online items,
  //                            reached by id rather than by a REST path
  //                            somebody guessed, which is a 404 that
  //                            reads like an empty layer.
  const NC_ITEMS = [
    // The statewide parcel service, as published. Polygons are layer 1.
    "250eb50c26ba46b185c39aa14fd2870c",
    // The centroids dataset. A point is not a boundary, but it puts the
    // park on the right ground, which is most of the value.
    "943c5690291445c4bb679a7422dd8b93",
  ];
  const NC_FIELDS = ["parno", "altparno", "pin", "PARNO", "PIN"];

  type Source = { say: string; url: string; fields?: string[] };
  const sources: Source[] = [
    { say: "NC OneMap (direct)", fields: NC_FIELDS,
      url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1" },
    { say: "NC OneMap mirror (direct)", fields: NC_FIELDS,
      url: "https://services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/MapServer/1" },
  ];
  for (const id of NC_ITEMS) {
    const base = await serviceOf(id);
    if (!base) {
      steps.push({ did: `looked up published item ${id.slice(0, 8)}…`, ok: false,
                   say: "ArcGIS would not say where it lives" });
      continue;
    }
    sources.push({ say: `NC OneMap item ${id.slice(0, 8)}… polygons`,
                   url: `${base}/1`, fields: NC_FIELDS });
    sources.push({ say: `NC OneMap item ${id.slice(0, 8)}… points`,
                   url: `${base}/0`, fields: NC_FIELDS });
  }

  // The address, kept for the fallback below. A parcel number can be
  // written three ways and indexed on a fourth; an address is the same
  // string on the card, the envelope and the table.
  const where = String(body.address ?? "").trim();

  for (const src of sources) {
    const notes: string[] = [];
    let hit = await parcelByPin(src.url, pin, src.fields, notes);
    if (!hit && where) hit = await parcelByAddress(src.url, where, notes);
    if (hit) {
      const out = answer(hit, src.say);
      if (out) return out;
      // A point layer has no ring, which is still worth having: it puts
      // the park on the right ground even without the deed line.
      const at = centroid(hit.geometry as { type?: string; coordinates?: unknown });
      if (at) {
        steps.push({ did: `found ${pin} in ${src.say}`, ok: true,
                     say: "as a point — it places the park but carries no boundary" });
        return NextResponse.json({
          ok: true, ring: [], centre: [at.lng, at.lat], layer: src.say,
          field: hit.field, props: hit.props, steps,
          note: `${pin} is in ${src.say} as a centre point, not a boundary. `
              + "The park is in the right place; the property line is still a box.",
        });
      }
    }
    steps.push({ did: `asked ${src.say}`, ok: false,
                 say: notes.join("; ") || "nothing came back" });
  }

  if (!app) {
    return NextResponse.json({
      error: `NC OneMap has no parcel numbered ${pin}. Paste the county's own `
           + "parcel viewer link and it will ask them directly.",
      steps,
    }, { status: 404 });
  }
  steps.push({ did: "read the link", ok: true, say: `app ${app}` });

  const { layers, via } = await layersOf(app);
  steps.push({
    did: "asked ArcGIS what that app draws", ok: layers.length > 0,
    say: layers.length ? `${layers.length} layers, via ${via}` : via,
  });
  if (!layers.length) {
    return NextResponse.json({
      error: "ArcGIS would not say what that app draws. It may be a private map.",
      steps,
    }, { status: 404 });
  }

  // Parcel-looking layers first, then everything else -- a county that
  // calls it "Land Records 2024" should not be a dead end.
  const first = parcelLayers(layers);
  const tryThese = [...first, ...layers.filter((l) => !first.includes(l))].slice(0, 8);
  steps.push({
    did: "picked the layers to ask", ok: true,
    say: tryThese.map((l) => l.title).join(", "),
  });

  for (const layer of tryThese) {
    const notes: string[] = [];
    let hit = await parcelByPin(layer.url, pin, undefined, notes);
    if (!hit && where) hit = await parcelByAddress(layer.url, where, notes);
    if (!hit) {
      steps.push({ did: `asked ${layer.title}`, ok: false,
                   say: notes.join("; ") || "nothing came back" });
      continue;
    }
    const out = answer(hit, layer.title);
    if (out) return out;
    steps.push({ did: `found ${pin} in ${layer.title}`, ok: false,
                 say: "but it carried no boundary" });
  }

  // No parcel anywhere. An address still puts the park on the right
  // ground, and the Census geocoder needs no key and no account.
  if (where) {
    const at = await geocode(where);
    if (at) {
      steps.push({ did: "no parcel, so geocoded the address", ok: true, say: where });
      return NextResponse.json({
        ok: true, ring: [], centre: [at.lng, at.lat], steps,
        note: `No parcel numbered ${pin} in any of those layers. The address `
            + "put the park in the right place; the property line will have to "
            + "come from the map.",
      });
    }
  }

  return NextResponse.json({
    error: `No parcel numbered ${pin} in any of those layers.`,
    steps,
  }, { status: 404 });
}
