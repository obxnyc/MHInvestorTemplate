import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import ConversationList, { type ListFilters } from "@/components/ConversationList";

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
  return (
    <>
      <Live />
      <InboxClient initialId={id}>
        <ConversationList filters={filters} selectedId={id} />
      </InboxClient>
    </>
  );
}
