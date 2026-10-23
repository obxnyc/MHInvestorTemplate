import { canSeeOffice } from "@/lib/roles";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import TimesheetBoard from "@/components/TimesheetBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets — Larabee Homes" };

export default async function Timesheets() {
  const me = await requireStaff();
  if (!me || !canSeeOffice(me.role)) redirect("/");
  return <TimesheetBoard />;
}
