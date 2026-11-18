import { requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The aerial for a point, proxied so the key stays here.
 *
 *  Confirming the pin matters more than it sounds: an address that geocodes to
 *  the middle of a road, or to the next park along, sends somebody to the wrong
 *  place months later, and by then nobody remembers it was never checked. */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return new Response("not signed in", { status: 401 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const zoom = Math.min(21, Math.max(15, Number(url.searchParams.get("z") ?? (key ? 19 : 17))));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return new Response("bad point", { status: 400 });
  }

  /* NO GOOGLE KEY: ESRI'S WORLD IMAGERY, the same photograph the park map
     draws on. A picture of the ground at the point, so "is this the right
     spot?" can still be answered -- an empty box asks it of nothing. */
  if (!key) {
    const across = (640 * 156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
    const dLng = across / (111320 * Math.cos((lat * Math.PI) / 180)) / 2;
    const dLat = (across * 360 / 640) / 110540 / 2;
    const esri = new URL("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export");
    esri.searchParams.set("bbox", `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`);
    esri.searchParams.set("bboxSR", "4326");
    esri.searchParams.set("imageSR", "3857");
    esri.searchParams.set("size", "640,360");
    esri.searchParams.set("format", "jpg");
    esri.searchParams.set("f", "image");
    const res = await fetch(esri);
    if (!res.ok) return new Response("aerial unavailable", { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const src = new URL("https://maps.googleapis.com/maps/api/staticmap");
  src.searchParams.set("center", `${lat},${lng}`);
  src.searchParams.set("zoom", String(zoom));
  src.searchParams.set("size", "640x360");
  src.searchParams.set("scale", "2");
  src.searchParams.set("maptype", "satellite");
  src.searchParams.set("markers", `color:red|${lat},${lng}`);
  src.searchParams.set("key", key);

  const res = await fetch(src);
  if (!res.ok) return new Response("aerial unavailable", { status: 502 });

  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      // The same point gives the same picture. Cached privately: it is behind a
      // sign-in and should not sit in a shared cache.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
