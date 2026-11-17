import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import ScoutScreen from "@/components/ScoutScreen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Driving for dollars: anybody signed in, crew included, can log a
 *  property from the road. What they log, the office works. */
export default async function Scout() {
  const me = await requireStaff();
  if (!me) redirect("/login");
  return <ScoutScreen />;
}
