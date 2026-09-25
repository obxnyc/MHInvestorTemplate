import Live from "@/components/Live";
import ConversationList, { type ListFilters } from "@/components/ConversationList";

export const dynamic = "force-dynamic";

/** The inbox with nothing open yet. The list itself is a component rather than
 *  this page, because the thread route renders the same list beside the open
 *  conversation — otherwise opening one would replace it. */
export default async function Messages(
  { searchParams }: { searchParams: Promise<ListFilters> },
) {
  const filters = await searchParams;

  return (
    <div className="split">
      <Live />
      <ConversationList filters={filters} />

      <div className="chatcol idle">
        <div className="empty">
          <div>
            <div className="ic">
              <svg viewBox="0 0 24 24">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z" />
              </svg>
            </div>
            <h3>No conversation selected</h3>
            <p>Pick one from the list, or start a new message.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
