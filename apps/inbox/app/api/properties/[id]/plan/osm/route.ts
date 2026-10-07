import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { RETREAT, boundaryOf } from "@/lib/parkplan";
import {
  roadQuery, landQuery, buildingQuery, boxAround, buildingsOf, roadsOf, areasOf,
  parkAround, assign, orientedBox, sameStreet, placeFromRoads, midOf, nearestNames,
  fitInside,
  type OsmElement, type Box,
} from "@/lib/osm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Overpass is volunteer-run and routinely takes ten or twenty seconds, and
// this asks twice. The default serverless ceiling killed the request before
// the first mirror had answered once.
export const maxDuration = 60;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

/**
 * The park's real streets, real boundary and real outlines.
 *
 * Asked in two questions. The first goes out a kilometre and a half for
 * named roads and pieces of land, because the only coordinate anybody had
 * for this park was a guess left over from a failed county pull and it was
 * wrong by further than any sensible search box. The second goes out two
 * hundred metres around the streets that question found, and asks for the
 * buildings.
 *
 * Every step is reported whether it worked or not. Six attempts at the
 * county's GIS failed in six different places, and knowing which step gave
 * up was the only thing that ever made one fixable.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await ctx.params;

  const steps: { did: string; ok: boolean; say: string }[] = [];
  const note = (did: string, ok: boolean, say: string) => steps.push({ did, ok, say });

  const url = new URL(req.url);
  const from: [number, number] = [
    Number(url.searchParams.get("lng")) || RETREAT.centre[0],
    Number(url.searchParams.get("lat")) || RETREAT.centre[1],
  ];

  // --- 1. the streets ---
  const wide = await ask(roadQuery(boxAround(from, 1500)), note, "the streets");
  if (!wide) {
    return NextResponse.json({
      steps, error: "No OpenStreetMap mirror answered. The drawn plan is still on screen.",
    });
  }

  const allRoads = roadsOf(wide);
  const wanted = RETREAT.rows.map((r) => r.street);
  const roads = allRoads.filter((r) => wanted.some((w) => sameStreet(w, r.name)));
  note("Looked for the park's streets", roads.length > 0,
    roads.length
      ? [...new Set(roads.map((r) => r.name))].join(" and ")
      : `none of ${wanted.join(" or ")}. Nearest named roads: ${nearestNames(allRoads, from).join(", ") || "none at all"}`);
  if (!roads.length) {
    return NextResponse.json({
      steps,
      error: `OpenStreetMap has no ${wanted.join(" or ")} within a kilometre and a half of where this park is thought to be. Nearest named roads there: ${nearestNames(allRoads, from).join(", ") || "none at all"}.`,
    });
  }

  // From here on the park's real position is known, and the guess is not
  // used again for anything.
  const here = midOf(roads[0].line);
  let fit = placeFromRoads(RETREAT, roads);
  note("Pinned the plan to those streets", Boolean(fit),
    fit
      ? `rows run at ${Math.round(fit.bearing)}°, streets ${Math.round(fit.streetGap)} m apart`
      : "could not, so the drawn plan stays where it was");

  // --- 2. the property line ---
  //
  // Asked separately and asked small. Bundled in with the streets over a
  // three-kilometre box, every back yard in Fayetteville came with it, the
  // answer ran past Overpass's own time limit, and a server-side timeout
  // comes back as an ordinary 200 with an empty list -- which read here as
  // "there are no streets by those names" while the base map was drawing
  // their street signs on the same screen.
  const land = await ask(landQuery(boxAround(here, 500)), note, "the property line");
  const parcel = land ? parkAround(areasOf(land), roads) : null;
  // A row of thirteen homes is a hundred and twenty-six metres long whether
  // or not the park is, so the ends hung outside the fence. The spacing is
  // the only number here that was ever a guess, so it is the one that gives.
  if (fit && parcel) fit = fitInside(fit, parcel.ring);
  note("Looked for the property line", Boolean(parcel),
    parcel
      ? `${parcel.name} — the real boundary, not a rectangle drawn round the homes`
      : "no mapped land here holds both streets, so the boundary is drawn around the homes");

  // --- 3. the homes ---
  const tight = await ask(buildingQuery(boxAround(here, 260)), note, "the homes");
  const shapes = tight ? buildingsOf(tight) : [];
  note("Read the buildings", shapes.length > 0, `${shapes.length} within 260 m of the streets`);

  const { homes, spare, rows } = assign(RETREAT, shapes, roads);
  note("Numbered them", homes.length > 0,
    rows.map((r) => `${r.row.street} ${r.row.side}: ${r.found} of ${r.row.numbers.length}`)
      .join("; "));

  const boundary = parcel?.ring
    ?? (homes.length ? orientedBox(homes.flatMap((h) => h.ring)) : boundaryOf(fit ?? RETREAT));

  if (!homes.length) {
    return NextResponse.json({
      steps, fit, boundary,
      error: "OpenStreetMap has the streets but not the homes on them, so these are drawn — on the right streets, at the right angle.",
    });
  }

  return NextResponse.json({
    ok: true, steps, fit, boundary,
    homes,
    streets: roads.map((r) => ({
      // The plan's spelling, so one street is one name on screen.
      name: RETREAT.rows.find((row) => sameStreet(row.street, r.name))!.street,
      line: r.line,
    })),
    spare: spare.map((s) => s.ring),
    parcel: parcel?.name ?? null,
    missing: rows
      .filter((r) => r.found < r.row.numbers.length)
      .map((r) => ({ street: r.row.street, side: r.row.side, short: r.row.numbers.length - r.found })),
  });
}

/** One question, tried at each mirror in turn. Overpass is free and
 *  volunteer-run, so one being busy is ordinary rather than exceptional. */
async function ask(
  body: string,
  note: (did: string, ok: boolean, say: string) => void,
  what: string,
): Promise<OsmElement[] | null> {
  for (const mirror of MIRRORS) {
    const host = new URL(mirror).hostname;
    try {
      const res = await fetch(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: body }).toString(),
        signal: AbortSignal.timeout(14_000),
      });
      if (!res.ok) { note(`Asked ${host} for ${what}`, false, `it answered ${res.status}`); continue; }
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      const elements = Array.isArray(json.elements) ? json.elements : [];
      // Overpass reports its own timeouts and memory limits as a remark on a
      // perfectly ordinary 200 with an empty list. Read as success, that is
      // indistinguishable from "this place has nothing in it", which is how
      // a park with its street signs on screen came back as not existing.
      if (json.remark) {
        note(`Asked ${host} for ${what}`, false, `it gave up: ${json.remark}`);
        continue;
      }
      note(`Asked ${host} for ${what}`, true, `${elements.length} things came back`);
      return elements;
    } catch (e) {
      note(`Asked ${host} for ${what}`, false, e instanceof Error ? e.message : "no answer");
    }
  }
  return null;
}

export type { Box };
