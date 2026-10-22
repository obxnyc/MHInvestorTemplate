import type { SupabaseClient } from "@supabase/supabase-js";
import { DESK } from "@/lib/roles";
import { ZONE } from "@/lib/zone";

/** The title that marks a thread as somebody's line to the office.
 *
 *  A thread is found again by this title rather than by its membership,
 *  because membership changes: somebody joins the office, somebody leaves,
 *  and a thread matched on "exactly these people" would stop matching and a
 *  second one would quietly be made. Half the history would then be in the
 *  thread nobody is looking at -- which is the reason `oneToOneThread` reuses
 *  rather than creates, and the same reason applies here.
 */
export const OFFICE_THREAD = "Office";

/* The zone comes from lib/format.ts, which has had it all along. A second
   constant holding the same fact is how the role list ended up hardcoded in
   seven files. */

/**
 * The thread a person on the clock uses to reach the office, made if it is
 * not there yet.
 *
 * NOT the shared line. The mainline is the number tenants text, and a crew
 * message arriving there lands in the same queue as a tenant's and gets
 * answered as if it were one. This is the staff side of the application,
 * which already exists.
 *
 * Everybody at a desk is in it, rather than one named person: the point of
 * asking is to get an answer, and a thread with whoever happens to be off
 * that day in it is a message nobody reads.
 *
 * Runs with the service role, so it is the caller's job to have established
 * that `meId` is who they say they are.
 */
export async function officeThread(
  db: SupabaseClient, meId: string,
): Promise<{ id: string; desks: number } | null> {
  const { data: desk } = await db.from("staff")
    .select("id").eq("active", true).in("role", DESK);
  const desks = (desk ?? []).map((d) => d.id as string).filter((id) => id !== meId);

  const { data: mine } = await db.from("dm_members")
    .select("thread_id, thread:thread_id(id, title)").eq("staff_id", meId);
  for (const row of mine ?? []) {
    const t = row.thread as unknown as { id: string; title: string | null } | null;
    if (t?.title === OFFICE_THREAD) {
      /* Catch the thread up with who is at a desk NOW. Somebody who joined
         the office after this thread was made would otherwise never see it,
         and the crew member would have no way of knowing that. */
      const { data: already } = await db.from("dm_members")
        .select("staff_id").eq("thread_id", t.id);
      const have = new Set((already ?? []).map((m) => m.staff_id as string));
      const missing = desks.filter((id) => !have.has(id));
      if (missing.length) {
        await db.from("dm_members")
          .insert(missing.map((id) => ({ thread_id: t.id, staff_id: id })));
      }
      return { id: t.id, desks: desks.length };
    }
  }

  const { data: made, error } = await db.from("dm_threads")
    .insert({ created_by: meId, title: OFFICE_THREAD }).select("id").single();
  if (error || !made) return null;

  await db.from("dm_members").insert([
    { thread_id: made.id, staff_id: meId, last_read_at: new Date().toISOString() },
    ...desks.map((id) => ({ thread_id: made.id, staff_id: id })),
  ]);
  return { id: made.id as string, desks: desks.length };
}

/**
 * What was going on when they asked, as one line above their message.
 *
 * The office's first reply to "I need a part" is "where are you?", and the
 * answer is already on the screen the message was sent from. Writing it here
 * rather than asking the crew member to type it is the whole difference
 * between a message that gets answered and one that starts a conversation.
 *
 * Built from the SHIFT as the server reads it, never from anything the
 * browser said: a line claiming which job somebody is on is worth nothing if
 * the person sending it chose what it says.
 */
export function withWhere(
  body: string,
  shift: { property?: string | null; startedAt?: string | null } | null,
  zone: string = ZONE,
): string {
  const text = body.trim();
  if (!shift) return `[off the clock]\n${text}`;
  const where = shift.property ? `on ${shift.property}` : "no job recorded";
  /* THE TIMEZONE HAS TO BE SAID OUT LOUD.
     `toLocaleTimeString` with no zone uses the machine's, and this runs on a
     server in UTC -- so a shift that started at 8:08 in the evening was
     written into the message as "since 12:08 AM". Not a rounding error: a
     time of day that is wrong by four or five hours, in the one line the
     office reads to decide whether to drive out, and wrong in a direction
     that makes a man look like he is on nights.
     Said explicitly rather than taken from the clock, because the clock here
     is right and is answering a different question. */
  const since = shift.startedAt
    ? new Date(shift.startedAt).toLocaleTimeString("en-US",
        { hour: "numeric", minute: "2-digit", timeZone: zone })
    : null;
  return `[on the clock, ${where}${since ? `, since ${since}` : ""}]\n${text}`;
}
