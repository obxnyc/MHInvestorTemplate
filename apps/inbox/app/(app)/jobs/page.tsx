import { canSeeOffice } from "@/lib/roles";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import JobsBoard from "@/components/JobsBoard";

export const dynamic = "force-dynamic";

export default async function Jobs() {
  const staff = await requireStaff();
  if (!staff || !canSeeOffice(staff.role)) redirect("/");
  return <JobsBoard />;
}
