import { requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { redirect } from "next/navigation";
import ParkLeads from "@/components/ParkLeads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every mobile home park owner in North Carolina, worked as a pipeline. */
export default async function Parks() {
  const me = await requireStaff();
  if (!me || !isDesk(me.role)) redirect("/home");
  return <ParkLeads />;
}
