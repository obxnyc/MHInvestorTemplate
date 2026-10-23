import Live from "@/components/Live";
import InboxClient from "@/components/InboxClient";
import InboxHeader from "@/components/InboxHeader";
import ConversationList, { type ListFilters } from "@/components/ConversationList";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { isClockOnly } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The inbox. One screen: the list, and whatever is open beside it. */
import PullNew from "@/components/PullNew";

export default async function Messages(
  { searchParams }: { searchParams: Promise<ListFilters> },
) {
  const filters = await searchParams;
  const staff = await requireStaff();
  // Crew have one job in this application and it is not this screen. The nav
  // does not offer it -- but a nav is a suggestion and an address bar is not,
  // so the page itself says no.
  if (isClockOnly(staff?.role)) redirect("/clock");

  return (
    <>
      <Live />
      {/* Asks Rent Manager for anything new, because somebody opened the
          inbox. On this plan a cron fires once a day, so a request filed at
          ten in the morning waited until the next -- and the office opens
          this screen twenty times a day, which is the schedule this plan
          actually has. Draws nothing unless something arrived. */}
      <PullNew />
      <InboxHeader canBroadcast={staff?.role === "admin" || staff?.role === "office"} />
      <InboxClient initialId={null}>
        <ConversationList filters={filters} />
      </InboxClient>
    </>
  );
}
