import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * A listing photo, into the public bucket Zillow can read.
 *
 * Its own bucket and never `attachments`: those are photographs tenants sent
 * of the inside of their homes, and a public URL in that bucket would be a
 * public URL to somebody's bedroom.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const unitId = String(form?.get("unitId") ?? "");
  if (!(file instanceof File) || !unitId) {
    return NextResponse.json({ error: "a photo and a home, please" }, { status: 400 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "JPEG, PNG or WebP only" }, { status: 400 });
  // Vercel refuses a request body over 4.5MB before this runs; say so in
  // words rather than letting it arrive as a bare 413.
  if (file.size > 4_400_000) {
    return NextResponse.json({ error: "That photo is over 4MB — export it smaller and try again." },
                             { status: 400 });
  }

  const db = supabaseAdmin();
  const path = `${unitId}/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from("listing-photos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) {
    return NextResponse.json({
      error: /bucket/i.test(error.message)
        ? "Run migration 051 first -- the listing-photos bucket is not there yet."
        : error.message,
    }, { status: 500 });
  }
  const { data } = db.storage.from("listing-photos").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
