import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET } from "@/lib/media";
import { pushToTeam } from "@/lib/push";

export const runtime = "nodejs";

/** What a phone camera produces, and nothing else. This bucket is read back
 *  into an <img> on someone's phone; anything outside these types has no
 *  business being rendered there. */
const ACCEPTED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif",
};
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 8;

/**
 * A contractor marking a job finished.
 *
 * Authenticated by the token in the URL and nothing else, so every step treats
 * it as a bearer credential: the token identifies a vendor, and the job is then
 * required to belong to THAT vendor. Without that second check, anyone holding
 * any vendor link could close anyone's job by guessing an id.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data: vendor } = await db
    .from("contacts").select("id, full_name").eq("jobs_token", token).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const jobId = String(form.get("jobId") ?? "");
  const waiver = String(form.get("waiver") ?? "").trim();

  // Theirs, open, and real. All three in one query.
  const { data: job } = await db
    .from("work_orders")
    .select("id, conversation_id, summary, completion_photos, status")
    .eq("id", jobId).eq("assigned_vendor", vendor.id).maybeSingle();
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (job.status === "done") {
    return NextResponse.json({ error: "That job is already closed." }, { status: 409 });
  }

  const photos = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (photos.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos at a time.` }, { status: 400 });
  }
  if (!photos.length && waiver.length < 10) {
    return NextResponse.json(
      { error: "Add a photo of the finished work, or say why there isn't one." },
      { status: 400 },
    );
  }

  const paths: string[] = [];
  for (const [i, photo] of photos.entries()) {
    const type = (photo.type || "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED.has(type)) {
      return NextResponse.json({ error: "That file isn't a photo." }, { status: 400 });
    }
    if (photo.size > MAX_BYTES) {
      return NextResponse.json({ error: "That photo is too large." }, { status: 400 });
    }

    // The job id is in the path, which is what lets office staff read it under
    // the rule that already governs work orders rather than a second one.
    const path = `work-orders/${job.id}/${Date.now()}-${i}.${EXTENSION[type]}`;
    const { error } = await db.storage.from(BUCKET)
      .upload(path, new Uint8Array(await photo.arrayBuffer()), { contentType: type });
    if (error) {
      console.error("completion photo upload failed", error);
      return NextResponse.json({ error: "The photo didn't upload. Try again." }, { status: 502 });
    }
    paths.push(path);
  }

  const { error } = await db.from("work_orders").update({
    completion_photos: [...(job.completion_photos ?? []), ...paths],
    completion_waiver: paths.length ? null : waiver,
    status: "done",
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (error) {
    // The database refuses `done` with no photo and no reason. If that fires,
    // it means this route let something through that it should not have.
    console.error("closing work order failed", error);
    return NextResponse.json({ error: "Couldn't close the job. Call the office." }, { status: 500 });
  }

  // The office finds out because the job closed, not because someone happened
  // to check. A repair nobody knows is finished is still an open repair.
  if (job.conversation_id) {
    const { data: convo } = await db
      .from("conversations").select("team_id").eq("id", job.conversation_id).maybeSingle();
    await pushToTeam(convo?.team_id ?? null, {
      title: `${vendor.full_name || "A vendor"} finished a job`,
      body: job.summary,
      url: `/c/${job.conversation_id}`,
      tag: `done-${job.id}`,
      conversationId: job.conversation_id,
    });
  }

  return NextResponse.json({ ok: true });
}
