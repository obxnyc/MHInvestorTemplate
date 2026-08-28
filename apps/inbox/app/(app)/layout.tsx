import Link from "next/link";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PushSetup from "@/components/PushSetup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <div className="shell">
      <header className="apphead">
        <h1>Messages</h1>
        <span className="sp" />
        <Link href="/calls" className="btn">Calls</Link>
        {staff.role === "admin" && <Link href="/legal" className="btn">Legal</Link>}
        {staff.role === "admin" && <Link href="/audit" className="btn">Audit</Link>}
        <span className="av" title={staff.full_name}>
          {staff.full_name.split(" ").map((p: string) => p[0]).join("").slice(0, 2)}
        </span>
      </header>
      <PushSetup />
      {children}
    </div>
  );
}
