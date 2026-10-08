import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET, MAX_KEEP_BYTES, keepableExtension, safeName } from "@/lib/media";

export const runtime = "nodejs";

/**
 * The paperwork behind a sale: the bill of sale, the lease, the note.
 *
 * Uploaded here rather than from the browser, for the same reason as every
 * other attachment in this app -- the bucket deliberately has no insert
 * policy for signed-in users, because a policy generous enough to allow a
 * browser to write here would also allow writing into any other lot's
 * folder. This route satisfies itself that the person may see the lot, and
 * only then writes with the service role.
 *
 * Filed under the lot rather than the sale, because the file is uploaded
 * before the row that points at it exists, and a lot that changes hands
 * three times keeps all three bills of sale in one place.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: unit } = await supabase
    .from("units").select("id").eq("id", id).maybeSingle();
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

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
  const batch = `doc-${randomUUID()}`;
  const kept: { path: string; name: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_KEEP_BYTES) {
      return NextResponse.json({
        error: `${file.name || "That file"} is bigger than 25 MB.`,
      }, { status: 400 });
    }
    const ext = keepableExtension(file.type);
    if (!ext) {
      return NextResponse.json({
        error: `${file.name || "That file"} is not a kind we keep.`,
      }, { status: 400 });
    }
    const name = safeName(file.name || `paper.${ext}`, ext);
    const path = `units/${id}/${batch}/${name}`;
    const { error } = await db.storage.from(BUCKET).upload(
      path, new Uint8Array(await file.arrayBuffer()),
      { contentType: file.type, upsert: false },
    );
    if (error) {
      console.error("paper upload failed", error);
      return NextResponse.json({ error: "That file didn't upload." }, { status: 500 });
    }
    kept.push({ path, name });
  }

  return NextResponse.json({ files: kept });
}
