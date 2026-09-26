import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PushSetup from "@/components/PushSetup";
import Heartbeat from "@/components/Heartbeat";
import AppHeader from "@/components/AppHeader";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <div className="shell">
      <AppHeader name={staff.full_name} role={staff.role} />
      {/* No UI. It tells the server this tab is open and whether anybody is
          at it, on whatever screen they happen to be on. */}
      <Heartbeat />
      {/* The work sits on a card with the page showing round it, rather than
          bleeding into the window edges. Edge to edge, a conversation list has
          no left margin, so the coloured category strip on each row rendered
          against the browser chrome and read as a rendering fault. */}
      <main className="portal">
        <div className="board">
          {/* Outside the scroller on purpose: it is a prompt about the app,
              not part of the page, and it should not slide away under the
              thing it is asking about. */}
          <PushSetup />
          {/* Every page scrolls, because the shell says so.
              This used to be each page's own job -- .dash and .people asked
              for it, .audit and the rest did not -- which meant the Setup
              check simply stopped at the bottom of the window with no way to
              reach the end of it. A screen that cannot scroll is not a
              styling slip, it is content nobody can read, and it should not
              be possible to ship a new page with that bug. */}
          <div className="boardscroll">{children}</div>
        </div>
      </main>
    </div>
  );
}
