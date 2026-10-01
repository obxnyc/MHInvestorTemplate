import { redirect, notFound } from "next/navigation";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * "Open this person's thread", when all you have is who they are.
 *
 * A job names the vendor doing it, and what you want from there is what he
 * said -- but a job stores a contact, not a conversation, and the two are not
 * the same thing. Linking by contact and resolving here keeps that join in
 * one place rather than in every component that happens to know a vendor's
 * name.
 *
 * Read through the signed-in user's client, so a person who may not see this
 * thread gets nothing rather than a redirect into a page that will refuse
 * them anyway.
 */
export default async function ByContact(
  { params }: { params: Promise<{ contactId: string }> },
) {
  const staff = await requireStaff();
  if (!staff) notFound();

  const { contactId } = await params;
  const supabase = await supabaseServer();

  // The open one by preference. A vendor you have worked with for two years
  // has a closed thread from last March, and landing in it would look like
  // the app had lost the conversation you were after.
  const { data: open } = await supabase
    .from("conversations").select("id, last_message_at")
    .eq("contact_id", contactId).neq("status", "closed")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  if (open) redirect(`/c/${open.id}`);

  const { data: any_ } = await supabase
    .from("conversations").select("id")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  if (any_) redirect(`/c/${any_.id}`);

  // Nobody has ever texted them. Not an error -- a vendor can be dispatched
  // by someone who then rang him -- so say so rather than showing a 404.
  return (
    <div className="dash">
      <h1>No thread yet</h1>
      <p className="muted">
        Nothing has been sent to or received from this person on the shared
        line. Start one from <strong>New Message</strong> and it will appear
        against their jobs from then on.
      </p>
    </div>
  );
}
