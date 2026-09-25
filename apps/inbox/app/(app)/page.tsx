import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import ConversationList, { type ListFilters } from "@/components/ConversationList";

export const dynamic = "force-dynamic";

/** The inbox. One screen: the list, and whatever is open beside it. */
export default async function Messages(
  { searchParams }: { searchParams: Promise<ListFilters> },
) {
  const filters = await searchParams;
  return (
    <>
      <Live />
      <InboxClient initialId={null}>
        <ConversationList filters={filters} />
      </InboxClient>
    </>
  );
}
