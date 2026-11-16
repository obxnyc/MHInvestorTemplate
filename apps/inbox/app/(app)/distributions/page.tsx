import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import DistributionsBoard from "@/components/DistributionsBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner distributions — Larabee Homes" };

export default async function Distributions() {
  const me = await requireStaff();
  // Every owner's money. Office and admin, the same two the route allows.
  if (!me || (me.role !== "admin" && me.role !== "office")) redirect("/");
  return <DistributionsBoard />;
}
