import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  BUCKET, MAX_KEEP_BYTES, keepableExtension, keepableTypes,
  pathIsSendable, safeName,
} from "@/lib/media";

export const runtime = "nodejs";

/**
 * Put a file where a message can point at it.
 *
 * Separate from sending on purpose. A photograph is slow and a text is fast,
 * and joining them into one request means the send button does nothing visible
 * for eight seconds on a phone in a crawlspace. Here the picture uploads while
 * the message is still being typed, and the send that follows carries three
 * short strings.
 *
 * Nothing about this route trusts the browser with storage. The bucket has no
 * insert policy for signed-in users -- deliberately, since a policy generous
 * enough to allow this would also allow writing into any conversation's folder
 * -- so the write happens here, with the service role, AFTER this route has
 * satisfied itself that the person may open the conversation they named.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;

  // Read through the user's own client so row-level security answers the
  // question. Asking "may this person attach to this conversation" any other
  // way would be a second set of rules to keep in step with the first.
  const supabase = await supabaseServer();
  const { data: convo } = await supabase
    .from("conversations").select("id").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

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
  // One folder per upload, so two people attaching at the same moment cannot
  // land on the same key, and so the read policy -- which keys off the
  // conversation id in the second path segment -- keeps working unchanged.
  const batch = `out-${randomUUID()}`;

  const kept: { path: string; name: string; sendable: boolean }[] = [];
  const refused: { name: string; why: string }[] = [];

  for (const [i, file] of files.entries()) {
    const shown = file.name || `file ${i + 1}`;

    // Anything we are willing to hold, not only what a carrier will take.
    // Whether it can actually be texted is a separate answer, returned
    // alongside, so the composer can say so before the send button is pressed
    // rather than after the carrier has swallowed it.
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

    // The index keeps two files of the same name in one batch apart; the name
    // after it is what a person reads in the thread a month from now.
    const path = `conversations/${id}/${batch}/${i}-${safeName(shown, ext)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await db.storage.from(BUCKET)
      .upload(path, bytes, { contentType: file.type.split(";")[0].trim(), upsert: false });
    if (error) {
      console.error("attachment upload failed", { id, path, error });
      refused.push({ name: shown, why: "it didn't finish uploading" });
      continue;
    }
    kept.push({ path, name: shown, sendable: pathIsSendable(path) });
  }

  return NextResponse.json({
    ok: kept.length > 0, files: kept, refused, accepts: keepableTypes(),
  });
}
