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
          <PushSetup />
          {children}
        </div>
      </main>
    </div>
  );
}
