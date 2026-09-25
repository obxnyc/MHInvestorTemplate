import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import InboxHeader from "@/components/InboxHeader";
import ConversationList, { type ListFilters } from "@/components/ConversationList";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The same inbox, opened on a staff thread. Exists for the link in a push
 *  notification; the list opens these without coming here. */
export default async function Team(
  { searchParams }: { searchParams: Promise<ListFilters & { t?: string }> },
) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  const { t, ...filters } = await searchParams;

  return (
    <>
      <Live />
      <InboxHeader canBroadcast={staff.role === "admin" || staff.role === "office"} />
      <InboxClient initialId={null} initialDm={t ?? null}>
        <ConversationList filters={filters} selectedId={t} />
      </InboxClient>
    </>
  );
}
