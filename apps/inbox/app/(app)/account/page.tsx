import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import AccountForm from "@/components/AccountForm";

export const dynamic = "force-dynamic";

export default async function Account() {
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  return <AccountForm name={staff.full_name} role={staff.role} />;
}
