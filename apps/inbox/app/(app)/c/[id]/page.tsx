import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import InboxHeader from "@/components/InboxHeader";
import ConversationList, { type ListFilters } from "@/components/ConversationList";
import { requireStaff } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** The same inbox, opened on a conversation.
 *
 *  This route exists for links that arrive from outside -- a push notification,
 *  a pasted URL, a browser reload. It is not how the list opens a thread;
 *  clicking a row swaps the pane without coming here at all. */
export default async function Chat(
  { params, searchParams }:
  { params: Promise<{ id: string }>; searchParams: Promise<ListFilters> },
) {
  const { id } = await params;
  const filters = await searchParams;
  const staff = await requireStaff();

  return (
    <>
      <Live />
      <InboxHeader canBroadcast={staff?.role === "admin" || staff?.role === "office"} />
      <InboxClient initialId={id}>
        <ConversationList filters={filters} selectedId={id} />
      </InboxClient>
    </>
  );
}
