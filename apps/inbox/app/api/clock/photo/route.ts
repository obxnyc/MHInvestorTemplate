import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A photo taken at clock-in when the phone cannot say where it is.
 *
 * Two kinds: `face` (a selfie: who) and `site` (the front of the house or the
 * lot number: where). The screen opens the camera itself, so it is a photo
 * taken now, not one picked from the library.
 *
 * THE TIME IS OURS, NOT THE PHONE'S. It goes in the file name as the moment
 * the photo ARRIVED here -- a phone's clock can be set back and a photo's own
 * date can be edited, but neither touches this. The clock-in route then
 * accepts only paths under the man's own id and from the last fifteen
 * minutes, so a photo uploaded yesterday, or by somebody else, cannot be
 * attached to this morning.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif",
};

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  const kind = String(form?.get("kind") ?? "");
  if (kind !== "face" && kind !== "site") {
    return NextResponse.json({ error: "Which photo is this?" }, { status: 400 });
  }
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "No photo came through. Take it again." }, { status: 400 });
  }
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return NextResponse.json({ error: "That is not a photo." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That photo is too big. Take it again." }, { status: 400 });
  }
  // A camera photo is tens of kilobytes at the very least; a thumbnail or a
  // blank is not evidence of anything.
  if (file.size < 15 * 1024) {
    return NextResponse.json({ error: "That photo is too small to see anything. Take it again." },
                             { status: 400 });
  }

  const at = Date.now();
  const path = `clock/${me.id}/${at}-${kind}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: type, upsert: false });
  if (error) {
    console.error("clock photo upload failed", { path, error });
    return NextResponse.json({ error: "The photo did not upload. Check your signal and try again." },
                             { status: 500 });
  }
  return NextResponse.json({ ok: true, path, at: new Date(at).toISOString() });
}
