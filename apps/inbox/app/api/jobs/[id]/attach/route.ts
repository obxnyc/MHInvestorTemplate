import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  BUCKET, MAX_KEEP_BYTES, keepableExtension, safeName,
} from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twelve is a walk round a yard. More than that is a camera roll. */
const MOST = 12;

/**
 * Evidence onto a work order, for whoever is going to do it.
 *
 * `reported_photos` has existed since the job board did, and until now the
 * only way anything got into it was a tenant TEXTING a picture -- a job
 * raised by hand had no way to carry one. So the thing that happens
 * constantly ("my man sent me two videos of the debris, send them to the
 * lawn chap") could not be done, and the videos went out through somebody's
 * phone instead, where nothing is attached to the property afterwards.
 *
 * The vendor's own page already shows whatever is here, so nothing
 * downstream needs changing: the gap was only ever getting them in.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;

  /* Read through the user's own client so row-level security answers the
     question of whether they may touch this job at all. */
  const supabase = await supabaseServer();
  const { data: job } = await supabase
    .from("work_orders").select("id, reported_photos").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected a file upload" }, { status: 400 });
  }

  const files = form.getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const already = ((job as { reported_photos?: string[] | null }).reported_photos ?? []);
  if (already.length + files.length > MOST) {
    return NextResponse.json({
      error: `A job carries up to ${MOST} files; this one already has`
        + ` ${already.length}.`,
    }, { status: 400 });
  }

  const db = supabaseAdmin();
  const added: string[] = [];
  const refused: string[] = [];

  for (const file of files) {
    const ext = keepableExtension(file.type || "");
    if (!ext) {
      refused.push(`${file.name || "that file"} — we don't keep ${file.type || "that kind"}`);
      continue;
    }
    if (file.size > MAX_KEEP_BYTES) {
      /* NAMED IN MEGABYTES, because "too large" sends somebody to try the
         same file again. A video off a phone is routinely over this. */
      refused.push(`${file.name || "that file"} — ${Math.round(file.size / 1e6)}MB,`
        + ` and the limit is ${Math.round(MAX_KEEP_BYTES / 1e6)}MB`);
      continue;
    }
    const path = `jobs/${id}/${randomUUID()}-${safeName(file.name || "evidence", ext)}`;
    const { error } = await db.storage.from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      refused.push(`${file.name || "that file"} — ${error.message}`);
      continue;
    }
    added.push(path);
  }

  if (added.length) {
    /* Appended to what is there rather than replacing it: two people
       adding a photograph at the same time must not lose one. */
    const { data: fresh } = await db.from("work_orders")
      .select("reported_photos").eq("id", id).maybeSingle();
    const now = ((fresh as { reported_photos?: string[] | null } | null)
      ?.reported_photos ?? []);
    const { error } = await db.from("work_orders")
      .update({ reported_photos: [...now, ...added] }).eq("id", id);
    if (error) {
      /* The files are in storage and the job does not point at them, which
         is worse than not having uploaded: somebody would be told it
         worked. Said plainly instead. */
      return NextResponse.json({
        error: "The files uploaded but could not be attached to the job."
          + ` ${error.message}`,
      }, { status: 500 });
    }
  }

  /* BOTH HALVES, ALWAYS. Four videos where one was too big is not a
     success and is not a failure, and reporting it as either loses the
     one that did not go. */
  return NextResponse.json({
    ok: added.length > 0,
    added: added.length,
    paths: added,
    refused,
  }, { status: added.length ? 200 : 400 });
}
