import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one-to-one thread between two people, made if it does not exist yet.
 *
 * Reusing the existing one matters: two threads with the same person means
 * half your history is in the one you are not looking at.
 *
 * A one-to-one is a thread with exactly these two people in it and no title.
 * The title is what makes the difference -- a named group of two is a group
 * somebody deliberately made, and dropping a message into that instead of the
 * private thread would put it somewhere they did not expect.
 *
 * Runs with the service role, so it is the caller's job to have established
 * that `meId` is who they say they are.
 */
export async function oneToOneThread(
  db: SupabaseClient, meId: string, otherId: string,
): Promise<string | null> {
  if (meId === otherId) return null;

  const [{ data: mine }, { data: theirs }] = await Promise.all([
    db.from("dm_members").select("thread_id").eq("staff_id", meId),
    db.from("dm_members").select("thread_id").eq("staff_id", otherId),
  ]);

  const shared = new Set((theirs ?? []).map((t) => t.thread_id));
  for (const id of (mine ?? []).map((t) => t.thread_id).filter((i) => shared.has(i))) {
    const [{ count }, { data: thread }] = await Promise.all([
      db.from("dm_members").select("staff_id", { count: "exact", head: true })
        .eq("thread_id", id),
      db.from("dm_threads").select("title").eq("id", id).maybeSingle(),
    ]);
    if (count === 2 && !thread?.title) return id;
  }

  const { data: made, error } = await db.from("dm_threads")
    .insert({ created_by: meId }).select("id").single();
  if (error || !made) return null;

  await db.from("dm_members").insert([
    { thread_id: made.id, staff_id: meId, last_read_at: new Date().toISOString() },
    { thread_id: made.id, staff_id: otherId },
  ]);
  return made.id;
}

/** Say something in a thread, and move it up the list. */
export async function sayInThread(
  db: SupabaseClient, threadId: string, authorId: string, body: string,
) {
  await db.from("dm_messages").insert({
    thread_id: threadId, author_id: authorId, body,
  });
  await db.from("dm_threads")
    .update({ last_at: new Date().toISOString() }).eq("id", threadId);
}
