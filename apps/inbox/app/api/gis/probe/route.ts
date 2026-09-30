import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * What a county GIS site is actually serving.
 *
 * An ArcGIS Online app is a pointer to a web map, and the web map names its
 * layers, and every layer describes itself. All of that is public and
 * machine-readable, which means the useful question -- "where are Pasquotank's
 * parcel boundaries and their aerial photography, as URLs" -- has an exact
 * answer that nobody has to guess at.
 *
 * Worth the trouble rather than paying for a parcel aggregator, because the
 * county is the source those aggregators buy from, and for 1140 -- where the
 * ground changes month to month -- county flights are usually more current
 * than anything Google has.
 *
 * Read-only throughout. It fetches published metadata and nothing else.
 */

type Layer = {
  title: string;
  url: string;
  kind: "operational" | "basemap";
  /** What the layer turned out to be when asked directly. */
  type?: string | null;
  geometry?: string | null;
  /** Whether it can hand us shapes as GeoJSON, which is what decides whether
   *  parcels can be drawn rather than merely looked at. */
  geoJson?: boolean;
  fields?: string[];
  detail?: string | null;
};

const AGOL = "https://www.arcgis.com/sharing/rest/content/items";

/** The app id out of whatever was pasted: a bare id, or the whole URL. */
function appIdFrom(s: string): string | null {
  const t = s.trim();
  if (/^[0-9a-f]{32}$/i.test(t)) return t;
  const m = t.match(/appid=([0-9a-f]{32})/i) ?? t.match(/items\/([0-9a-f]{32})/i)
    ?? t.match(/([0-9a-f]{32})/i);
  return m?.[1] ?? null;
}

async function json(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch { return null; }
}

/** Ask a layer what it is. A service that will answer this will answer
 *  everything else we need from it. */
async function describe(l: Layer): Promise<Layer> {
  const meta = await json(`${l.url}?f=json`);
  if (!meta) return { ...l, detail: "did not answer" };

  const fields = (meta.fields as { name?: string }[] | undefined)
    ?.map((f) => String(f.name)).filter(Boolean).slice(0, 30);

  // Whether it speaks GeoJSON decides whether parcels can be drawn on our
  // map or only admired on theirs.
  let geoJson = false;
  if (/FeatureServer|MapServer/i.test(l.url) && /\/\d+$/.test(l.url)) {
    const probe = await json(
      `${l.url}/query?where=1%3D1&resultRecordCount=1&outFields=*&f=geojson`);
    geoJson = Boolean(probe && (probe.type === "FeatureCollection"));
  }

  return {
    ...l,
    type: (meta.type as string) ?? (meta.serviceDataType as string) ?? null,
    geometry: (meta.geometryType as string) ?? null,
    fields, geoJson,
    detail: null,
  };
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { url } = await req.json().catch(() => ({}));
  const appId = appIdFrom(String(url ?? ""));
  if (!appId) {
    return NextResponse.json({
      error: "That does not contain an ArcGIS item id. Paste the whole link from"
        + " the county's map site — it has appid= in it.",
    }, { status: 400 });
  }

  // The app, then the web map it points at. Asked of arcgis.com rather than
  // the county's own vanity host, because the vanity host is a redirect to
  // exactly this and one fewer hop is one fewer thing to go wrong.
  const app = await json(`${AGOL}/${appId}/data?f=json`);
  const item = await json(`${AGOL}/${appId}?f=json`);
  if (!app && !item) {
    return NextResponse.json({
      appId, reachable: false,
      hint: "ArcGIS did not answer for that id. Either the app is private, or the"
        + " link points at something other than a map.",
    });
  }

  const values = (app?.values ?? {}) as Record<string, unknown>;
  const mapId = (values.webmap ?? values.mapItemId ?? null) as string | null;

  const layers: Layer[] = [];
  let mapTitle: string | null = null;

  if (mapId) {
    const map = await json(`${AGOL}/${mapId}/data?f=json`);
    const meta = await json(`${AGOL}/${mapId}?f=json`);
    mapTitle = (meta?.title as string) ?? null;

    for (const l of (map?.operationalLayers ?? []) as Record<string, unknown>[]) {
      if (typeof l.url === "string") {
        layers.push({ title: String(l.title ?? "—"), url: l.url, kind: "operational" });
      }
    }
    const base = (map?.baseMap ?? {}) as Record<string, unknown>;
    for (const l of (base.baseMapLayers ?? []) as Record<string, unknown>[]) {
      const u = (l.url ?? l.templateUrl) as string | undefined;
      if (typeof u === "string") {
        layers.push({ title: String(l.title ?? "basemap"), url: u, kind: "basemap" });
      }
    }
  }

  // Sequentially: this is somebody's public service and a dozen parallel
  // requests to it is not how to introduce ourselves.
  const described: Layer[] = [];
  for (const l of layers.slice(0, 14)) described.push(await describe(l));

  const parcels = described.filter((l) =>
    /parcel|cadastr|propert|tax|land/i.test(l.title) && l.geoJson);
  const imagery = described.filter((l) =>
    l.kind === "basemap" || /imager|aerial|ortho|photo/i.test(l.title));

  return NextResponse.json({
    appId, reachable: true, mapId, mapTitle,
    title: (item?.title as string) ?? null,
    layers: described,
    // The two answers actually being looked for, named rather than left to be
    // picked out of a list of fourteen.
    verdict: {
      parcels: parcels[0]?.url ?? null,
      parcelsTitle: parcels[0]?.title ?? null,
      imagery: imagery[0]?.url ?? null,
      imageryTitle: imagery[0]?.title ?? null,
    },
  });
}
