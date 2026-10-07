import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { RETREAT, boundaryOf } from "@/lib/parkplan";
import {
  overpassBody, boxAround, buildingsOf, roadsOf, assign, orientedBox, sameStreet,
  placeFromRoads,
} from "@/lib/osm";
import type { OsmElement } from "@/lib/osm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Overpass is volunteer-run and routinely takes ten or twenty seconds. The
// default serverless ceiling is well under the time three mirrors need, so
// the request was being killed before the first one answered.
export const maxDuration = 60;

/** Mirrors, in order. Overpass is free and volunteer-run, so one being busy
 *  is ordinary rather than exceptional and is not a reason to give up. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

/**
 * The park's real outlines, from OpenStreetMap.
 *
 * Every step is reported whether it worked or not. Six attempts at pulling
 * this park out of the county's GIS failed in six different places, and the
 * only thing that made each one fixable was knowing which step gave up.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await ctx.params;

  const steps: { did: string; ok: boolean; say: string }[] = [];
  const note = (did: string, ok: boolean, say: string) => steps.push({ did, ok, say });

  const url = new URL(req.url);
  const lng = Number(url.searchParams.get("lng")) || RETREAT.centre[0];
  const lat = Number(url.searchParams.get("lat")) || RETREAT.centre[1];
  const box = boxAround([lng, lat], 420);
  const body = overpassBody(box);

  let json: { elements?: OsmElement[] } | null = null;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: body }).toString(),
        signal: AbortSignal.timeout(14_000),
      });
      if (!res.ok) { note("Asked " + host(mirror), false, `it answered ${res.status}`); continue; }
      json = await res.json();
      note("Asked " + host(mirror), true, "it answered");
      break;
    } catch (e) {
      note("Asked " + host(mirror), false, e instanceof Error ? e.message : "no answer");
    }
  }
  if (!json) {
    return NextResponse.json({
      steps, error: "No OpenStreetMap mirror answered. The drawn plan is still on screen.",
    });
  }

  const elements = Array.isArray(json.elements) ? json.elements : [];
  const shapes = buildingsOf(elements);
  const roads = roadsOf(elements);
  note("Read what came back", shapes.length > 0,
    `${shapes.length} buildings and ${roads.length} named roads within 420 m`);

  const wanted = RETREAT.rows.map((r) => r.street);
  const found = [...new Set(roads.map((r) => r.name))]
    .filter((n) => wanted.some((w) => sameStreet(w, n)));
  note("Found the park's streets", found.length > 0,
    found.length ? found.join(" and ") : `none of ${wanted.join(" or ")} are on the map here`);
  if (!found.length) {
    return NextResponse.json({
      steps,
      error: "OpenStreetMap has no road by those names here, so there is nothing to hang the numbering on.",
    });
  }

  // The block pinned to the real streets. Worked out before the buildings
  // are looked at, and returned whatever happens to them: two road
  // centrelines are enough to stop the drawn park sitting crooked in the
  // wrong place, and a named street the base map is already drawing is far
  // likelier to be in OpenStreetMap than a mobile home is.
  const fit = placeFromRoads(RETREAT, roads);
  note("Pinned the plan to those streets", Boolean(fit),
    fit
      ? `rows run at ${Math.round(fit.bearing)}°, streets ${Math.round(fit.streetGap)} m apart`
      : "could not, so the drawn plan stays where it was");

  const { homes, spare, rows } = assign(RETREAT, shapes, roads);
  note("Numbered them", homes.length > 0,
    rows.map((r) => `${r.row.street} ${r.row.side}: ${r.found} found, ${r.row.numbers.length} expected`)
      .join("; "));
  if (!homes.length) {
    return NextResponse.json({
      steps, fit,
      error: "OpenStreetMap has the streets but not the homes on them, so these are drawn — on the right streets, at the right angle.",
    });
  }

  const boundary = orientedBox(homes.flatMap((h) => h.ring)) ;
  const streets = roads
    .filter((r) => wanted.some((w) => sameStreet(w, r.name)))
    .map((r) => ({
      // The plan's spelling, so one street is one name on screen.
      name: RETREAT.rows.find((row) => sameStreet(row.street, r.name))!.street,
      line: r.line,
    }));

  return NextResponse.json({
    ok: true, steps, fit,
    homes, streets, spare: spare.map((s) => s.ring),
    boundary: boundary.length ? boundary : boundaryOf(RETREAT),
    missing: rows
      .filter((r) => r.found < r.row.numbers.length)
      .map((r) => ({
        street: r.row.street, side: r.row.side,
        short: r.row.numbers.length - r.found,
      })),
  });
}

const host = (u: string) => new URL(u).hostname;
