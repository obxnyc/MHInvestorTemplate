import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PushSetup from "@/components/PushSetup";
import AppHeader from "@/components/AppHeader";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <div className="shell">
      <AppHeader name={staff.full_name} role={staff.role} />
      <PushSetup />
      {children}
    </div>
  );
}
