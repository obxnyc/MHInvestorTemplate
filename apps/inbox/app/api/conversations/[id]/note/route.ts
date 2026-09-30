import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { pushToStaff } from "@/lib/push";
import { belongsToConversation } from "@/lib/media";

export const runtime = "nodejs";

/** Internal note. Never sent anywhere -- this is the "here's what I tried"
 *  that lets the next person pick up without re-asking the tenant. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body, media } = await req.json() as { body?: string; media?: unknown };

  // Same check as a reply, for the same reason: these paths came back through
  // a browser and a browser can name any folder it likes.
  const wanted = Array.isArray(media) ? media.filter((m): m is string => typeof m === "string") : [];
  const paths = wanted.filter((p) => belongsToConversation(p, id));
  if (paths.length !== wanted.length) {
    return NextResponse.json({ error: "that attachment isn't this conversation's" }, { status: 400 });
  }

  // A screenshot of somebody's ledger, posted with no words, is a perfectly
  // good note.
  if (!body?.trim() && !paths.length) {
    return NextResponse.json({ error: "empty note" }, { status: 400 });
  }
  const text = body?.trim() ? body : "";

  const supabase = await supabaseServer();

  // @mentions turn notes from a filing cabinet into coordination: name someone
  // and their phone buzzes.
  const handles = [...text.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase());
  let mentioned: string[] = [];
  if (handles.length) {
    const { data: all } = await supabase.from("staff").select("id, full_name").eq("active", true);
    mentioned = (all ?? []).filter((s) => {
      const first = s.full_name.split(" ")[0].toLowerCase();
      return handles.includes(first) || handles.includes(s.full_name.toLowerCase().replace(/\s+/g, "."));
    }).map((s) => s.id);
  }

  // Written with the attachments where the column exists, and without them
  // where migration 026 has not been run yet. A note that loses its picture is
  // a nuisance; a note that refuses to save because of a column nobody has
  // added yet is somebody's afternoon.
  const row = { conversation_id: id, author_id: staff.id, body: text, mentions: mentioned };
  let lost = false;
  let { error } = await supabase.from("notes").insert({ ...row, media_paths: paths });
  if (error && missingColumn(error) && paths.length) {
    lost = true;
    ({ error } = await supabase.from("notes").insert(row));
  } else if (error && missingColumn(error)) {
    ({ error } = await supabase.from("notes").insert(row));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (mentioned.length) {
    await pushToStaff(mentioned.filter((m) => m !== staff.id), {
      title: `${staff.full_name} mentioned you`,
      body: text.slice(0, 140) || "sent an attachment",
      url: `/c/${id}`,
      tag: `note:${id}`,
    });
  }
  return NextResponse.json({
    ok: true,
    // Said out loud rather than swallowed. The person typed a note with a
    // photograph on it and only the words were kept; they should hear that
    // from us and not discover it next week.
    warning: lost
      ? "Saved, but without the attachment — migration 026 hasn't been run yet."
      : null,
  });
}

/** The shape Postgres uses to say a column is not there. Matched on the code
 *  as well as the text because the wording has changed between versions. */
function missingColumn(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === "42703" || /column .* does not exist/i.test(e.message ?? ""));
}
