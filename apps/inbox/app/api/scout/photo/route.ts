import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One photo of a property somebody has spotted.
 *
 * The time in the path is the SERVER's, when it arrived -- the same rule as
 * the clock-in photos -- and the path carries the scout's own id, so the
 * sighting route can accept only this person's photos from the last hour.
 * The service role writes the file because the bucket is private; who may
 * attach it is decided by the path, checked when the sighting is saved.
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
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No photo came through. Take it again." }, { status: 400 });
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return NextResponse.json({ error: "That is not a photo." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too big. Take it again." }, { status: 400 });

  const at = Date.now();
  const path = `scout/${me.id}/${at}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: type, upsert: false });
  if (error) return NextResponse.json({ error: `The photo could not be kept: ${error.message}` }, { status: 500 });
  return NextResponse.json({ path });
}
