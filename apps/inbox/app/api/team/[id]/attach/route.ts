import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  BUCKET, MAX_KEEP_BYTES, keepableExtension, keepableTypes, safeName,
} from "@/lib/media";

export const runtime = "nodejs";

/**
 * Put a file on an internal thread.
 *
 * The same shape as the tenant one, and deliberately a different folder.
 * Files here go under `dm/<thread_id>/`, which migration 027 grants by thread
 * membership rather than by being staff -- because a private message between
 * two colleagues is not company correspondence, and filing its attachments
 * beside a tenant conversation's would quietly make it so.
 *
 * Nothing a carrier cares about applies here: nothing on this thread is ever
 * texted to anybody, so every type we are willing to store is allowed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;

  // Membership is established by reading the thread as this person: if the
  // policy will not show it to them, they may not put a file on it either.
  // The same check the POST that sends a message already makes.
  const supabase = await supabaseServer();
  const { data: thread } = await supabase
    .from("dm_threads").select("id").eq("id", id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected a file upload" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (files.length > 10) {
    return NextResponse.json({ error: "ten at a time, at most" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const batch = randomUUID();

  const kept: { path: string; name: string; sendable: boolean }[] = [];
  const refused: { name: string; why: string }[] = [];

  for (const [i, file] of files.entries()) {
    const shown = file.name || `file ${i + 1}`;

    const ext = keepableExtension(file.type || "");
    if (!ext) {
      refused.push({
        name: shown,
        why: file.type
          ? `we don't take ${file.type} files`
          : "we couldn't tell what kind of file that is",
      });
      continue;
    }
    if (file.size > MAX_KEEP_BYTES) {
      refused.push({
        name: shown,
        why: `it's ${Math.round(file.size / 1024 / 1024)} MB — the limit is 25 MB`,
      });
      continue;
    }

    const path = `dm/${id}/${batch}/${i}-${safeName(shown, ext)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await db.storage.from(BUCKET)
      .upload(path, bytes, { contentType: file.type.split(";")[0].trim(), upsert: false });
    if (error) {
      console.error("team attachment upload failed", { id, path, error });
      refused.push({ name: shown, why: "it didn't finish uploading" });
      continue;
    }
    // Always true here: nothing on an internal thread goes to a carrier, so
    // there is nothing for the composer to warn about.
    kept.push({ path, name: shown, sendable: true });
  }

  return NextResponse.json({
    ok: kept.length > 0, files: kept, refused, accepts: keepableTypes(),
  });
}
