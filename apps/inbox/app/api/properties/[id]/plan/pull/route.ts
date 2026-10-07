import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  appIdFrom, geocode, layersOf, numberField, boxAround, pointsIn,
  houseNumber, mostLikelyFirst, parcelLayers, parcelAt, inShape,
  type Step, type FoundLot,
} from "@/lib/agol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pull a park's lots from the county's map.
 *
 * Preview by default. The last thing anybody wants is forty lots appearing
 * with the neighbours' house numbers among them and no way to tell which is
 * which -- so it finds them, says what it found and where each number came
 * from, and writes nothing until asked a second time.
 *
 * Every step is reported whether it worked or not. This code cannot be run
 * against a county server from a development machine, so when it fails in
 * the field the only thing standing between somebody and an afternoon is
 * whether it said which step gave up.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: property } = await supabase
    .from("properties").select("id, name, address, lat, lng").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const steps: Step[] = [];
  const note = (did: string, ok: boolean, say: string) => { steps.push({ did, ok, say }); };

  // --- 1. the county's map ---
  const appId = appIdFrom(String(body.url ?? ""));
  if (!appId) {
    return NextResponse.json({
      steps, error: "That link has no ArcGIS id in it. Paste the whole address"
        + " from the county's map site — it has appid= in the middle.",
    }, { status: 400 });
  }
  note("Read the link", true, `ArcGIS item ${appId}`);

  // --- 2. where the park is ---
  let centre = property.lat && property.lng
    ? { lat: Number(property.lat), lng: Number(property.lng) }
    : null;
  if (centre) {
    note("Found the park", true, "Using the coordinates already on the property.");
  } else {
    const where = String(property.address ?? "").trim();
    if (!where) {
      return NextResponse.json({
        steps, error: "This property has no address, so there is nowhere to look."
          + " Add one with Edit this property and try again.",
      }, { status: 400 });
    }
    centre = await geocode(where);
    if (!centre) {
      return NextResponse.json({
        steps: [...steps, { did: "Found the park", ok: false,
          say: `The Census geocoder did not recognise "${where}".` }],
        error: "Could not work out where the park is from its address.",
      }, { status: 400 });
    }
    note("Found the park", true,
      `${where} is at ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}.`);
  }

  // --- 3. what the county publishes ---
  const found = await layersOf(appId);
  const layers = found.layers;
  if (!layers.length) {
    return NextResponse.json({
      steps: [...steps, { did: "Asked the county what it serves", ok: false,
        say: `The item is a ${found.kind ?? "thing of unknown type"}; ${found.via}.` }],
      error: "Could not get a layer list out of that link. If the county's site"
        + " has a 'Layers' or 'Legend' panel, there may be a second link behind"
        + " it that points straight at the map.",
    }, { status: 400 });
  }
  note("Asked the county what it serves", true,
    `A ${found.kind ?? "map"} via ${found.via}. ${layers.length} layers with`
    + " something queryable in them.");

  // --- 4. the layer with house numbers in it ---
  const box = boxAround(centre.lat, centre.lng, Number(body.metres) || 250);
  const tried: string[] = [];
  const candidates: { title: string; count: number; found: FoundLot[] }[] = [];
  let best: { title: string; field: string; found: FoundLot[] } | null = null;

  // In order of likelihood, because the budget is spent in order. The last
  // run tried twenty-five aerial photographs and never reached the address
  // points, which were sitting there the whole time.
  // A layer somebody already picked beats any amount of guessing.
  const only = String(body.layerUrl ?? "").trim();
  const order = only
    ? layers.filter((l) => l.url === only)
    : mostLikelyFirst(layers);

  for (const layer of order) {
    // Sequentially and bounded: this is somebody's public service, and
    // twenty parallel requests is not how to introduce ourselves.
    if (tried.length >= 40) break;
    const got = await pointsIn(layer.url, box);
    if (!got) { tried.push(`${layer.title}: no answer`); continue; }
    if (!got.features.length) { tried.push(`${layer.title}: nothing here`); continue; }

    const field = numberField(got.fields);
    if (!field) { tried.push(`${layer.title}: ${got.features.length} shapes, no number field`); continue; }

    const found: FoundLot[] = [];
    for (const f of got.features) {
      const label = houseNumber(f.props[field]);
      if (label) found.push({ label, lat: f.lat, lng: f.lng });
    }
    // Duplicates happen where a layer holds a point AND a footprint per home.
    const seen = new Set<string>();
    const unique = found.filter((f) => !seen.has(f.label) && seen.add(f.label));

    tried.push(`${layer.title}: ${unique.length} numbered from ${field}`);
    // Smallest wins, not largest. Picking whichever found MOST is exactly
    // backwards: a park is a small thing inside a big neighbourhood, so the
    // layer that came back with 85 is the one covering the neighbours and
    // the one with 28 is the park. Anything under four is noise rather than
    // a park.
    if (unique.length >= 4 && (!best || unique.length < best.found.length)) {
      best = { title: layer.title, field, found: unique };
    }
    candidates.push({ title: layer.title, count: unique.length, found: unique });
  }

  note("Looked for house numbers",
    Boolean(best?.found.length),
    `Tried ${tried.length} of ${layers.length} layers, most likely first. `
    + tried.join(" · "));

  if (!best || !best.found.length) {
    // Every layer by name, because at this point the list IS the diagnosis:
    // it says whether this map carries address points at all, or whether the
    // link points at the planning map rather than the parcel viewer.
    return NextResponse.json({
      steps, layers: layers.map((l) => ({ title: l.title, url: l.url })),
      error: "None of the layers this map publishes carries house numbers near"
        + " the park. Pick one below if you can see the right one, or find the"
        + " county's parcel or address viewer — this looks like their planning"
        + " map.",
    }, { status: 400 });
  }

  // --- 5. clip to the parcel ---
  //
  // "Within 250 metres" is not the question. It swept in Capri Street,
  // Gary Street and Rosemary Drive and came back with eighty-five lots for a
  // park that has twenty-eight. A park IS a parcel, the county publishes the
  // boundary, and a point is either inside it or it is somebody else's.
  //
  // Skipped rather than fatal when no parcel can be found: eighty-five lots
  // you can see and reject beats nothing at all, and the report says which
  // happened.
  let kept = best.found;
  if (!body.noClip) {
    let parcel: { geometry: unknown; props: Record<string, unknown> } | null = null;
    let from = "";
    for (const layer of parcelLayers(layers)) {
      parcel = await parcelAt(layer.url, centre.lat, centre.lng);
      if (parcel?.geometry) { from = layer.title; break; }
    }

    if (parcel?.geometry) {
      const inside = best.found.filter((f) => inShape(f.lat, f.lng, parcel!.geometry));
      if (inside.length) {
        note("Clipped to your parcel", true,
          `${inside.length} of ${best.found.length} are inside the parcel from`
          + ` "${from}". The rest are the neighbours'.`);
        kept = inside;
      } else {
        // The park spans several parcels, or the address points sit on the
        // road rather than on the pad. Either way, clipping to nothing is
        // worse than not clipping.
        note("Clipped to your parcel", false,
          `Found the parcel in "${from}", but none of the ${best.found.length}`
          + " numbered points fall inside it. Keeping all of them —"
          + " the park may cover more than one parcel.");
      }
    } else {
      note("Clipped to your parcel", false,
        "No parcel layer on this map returned a boundary at the park's"
        + " coordinates, so everything within 250 m is still here.");
    }
  }

  // --- 6. what came back ---
  //
  // Real coordinates, not fractions of a canvas. The map needs them, and a
  // fraction throws away the one thing that makes an aerial photograph
  // useful: the ability to see whether these homes are yours.
  const placed = [...kept].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }));
  note("Laid them out", true,
    `${placed.length} lots from "${best.title}", numbered ${placed[0].label}`
    + ` to ${placed[placed.length - 1].label}.`);

  if (!body.commit) {
    return NextResponse.json({
      steps, preview: true, lots: placed,
      // Every layer that found something, so the wrong pick is one click to
      // correct rather than a conversation.
      others: candidates
        .filter((c) => c.title !== best!.title && c.count >= 4)
        .map((c) => ({ title: c.title, count: c.count })),
    });
  }

  // --- 7. write them ---
  const db = supabaseAdmin();
  const { data: existing } = await db.from("units").select("id, label").eq("property_id", id);
  const byLabel = new Map((existing ?? []).map((u) => [String(u.label), u.id as string]));

  // Only what was asked for. In picking mode somebody has already looked at
  // the aerial and said which of these are theirs, and ignoring that would
  // make the picking decorative.
  const want = Array.isArray(body.keep) && body.keep.length
    ? new Set((body.keep as unknown[]).map(String))
    : null;
  const writing = want ? placed.filter((l) => want.has(l.label)) : placed;

  let made = 0, moved = 0;
  for (const lot of writing) {
    const known = byLabel.get(lot.label);
    if (known) {
      const { error } = await db.from("units")
        .update({ lat: lot.lat, lng: lot.lng }).eq("id", known);
      if (error) return NextResponse.json({ steps, error: error.message }, { status: 500 });
      moved++;
    } else {
      const { error } = await db.from("units").insert({
        property_id: id, label: lot.label,
        lat: lot.lat, lng: lot.lng, is_vacant: true,
      });
      if (error) return NextResponse.json({ steps, error: error.message }, { status: 500 });
      made++;
    }
  }
  await db.from("properties").update({ map_kind: "aerial" }).eq("id", id);

  return NextResponse.json({ steps, ok: true, created: made, moved });
}
