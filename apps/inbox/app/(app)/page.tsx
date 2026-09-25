import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import InboxHeader from "@/components/InboxHeader";
import ConversationList, { type ListFilters } from "@/components/ConversationList";
import { requireStaff } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** The inbox. One screen: the list, and whatever is open beside it. */
export default async function Messages(
  { searchParams }: { searchParams: Promise<ListFilters> },
) {
  const filters = await searchParams;
  const staff = await requireStaff();

  return (
    <>
      <Live />
      <InboxHeader canBroadcast={staff?.role === "admin" || staff?.role === "office"} />
      <InboxClient initialId={null}>
        <ConversationList filters={filters} />
      </InboxClient>
    </>
  );
}
