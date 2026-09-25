import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Address lookup, proxied.
 *
 * The key stays on the server. A Maps key in the browser is a key anybody can
 * lift and spend, and the usual answer -- referrer restrictions -- is a request
 * header, which is to say a request for politeness. Autocomplete is billed per
 * keystroke-ish, so this is a bill somebody else can run up.
 *
 * Staff only for the same reason.
 *
 * Without GOOGLE_MAPS_API_KEY this returns nothing rather than failing, and the
 * form falls back to typing the address by hand -- which is what it did before
 * and is still perfectly usable.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ suggestions: [], configured: false });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const q = (url.searchParams.get("q") ?? "").trim();

  try {
    if (id) {
      // One place, with only the two fields we keep. The field mask is not
      // optional on this API and it is also what the call is priced on.
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
        { headers: { "X-Goog-Api-Key": key,
                     "X-Goog-FieldMask": "formattedAddress,location" } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return fail(body, res.status);

      const loc = body.location ?? {};
      return NextResponse.json({
        configured: true,
        address: body.formattedAddress ?? null,
        lat: loc.latitude ?? null,
        lng: loc.longitude ?? null,
      });
    }

    if (q.length < 3) return NextResponse.json({ suggestions: [], configured: true });

    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "X-Goog-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ input: q, includedRegionCodes: ["us"] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return fail(body, res.status);

    // Read tolerantly. This response has changed shape across versions of the
    // API and the cost of being wrong here is an empty dropdown with no
    // explanation, so take the text from wherever it is.
    const suggestions = (body.suggestions ?? [])
      .map((s: Record<string, unknown>) => {
        const p = (s.placePrediction ?? {}) as Record<string, unknown>;
        const text = p.text as { text?: string } | string | undefined;
        const label = typeof text === "string" ? text : text?.text
          ?? (p.structuredFormat as { mainText?: { text?: string } } | undefined)
              ?.mainText?.text;
        return p.placeId && label ? { id: String(p.placeId), label: String(label) } : null;
      })
      .filter(Boolean)
      .slice(0, 6);

    return NextResponse.json({ suggestions, configured: true });
  } catch (e) {
    console.error("places lookup failed", e);
    return NextResponse.json(
      { error: "Address lookup is not answering. Type it in instead.", suggestions: [] },
      { status: 502 },
    );
  }
}

/** Google's own message, passed through. When this breaks it is nearly always
 *  a key that is not enabled for this API or has no billing on it, and that
 *  message says so -- swallowing it turns a five-minute fix into an afternoon. */
function fail(body: Record<string, unknown>, status: number) {
  const err = body.error as { message?: string } | undefined;
  console.error("places api", status, err?.message ?? body);
  return NextResponse.json(
    { error: err?.message ?? "Address lookup refused that.", suggestions: [] },
    { status: 502 },
  );
}
