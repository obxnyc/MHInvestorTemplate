import Link from "next/link";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PushSetup from "@/components/PushSetup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brandlink">Larabee</Link>
        <nav>
          <Link href="/">Inbox</Link>
          <Link href="/calls">Calls</Link>
          {staff.role === "admin" && <Link href="/audit">Audit</Link>}
        </nav>
        <span className="who" title={staff.full_name}>
          {staff.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
        </span>
      </header>
      <PushSetup />
      {children}
    </div>
  );
}
