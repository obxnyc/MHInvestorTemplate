import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import TrailBoard from "@/components/TrailBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where they went — Larabee Homes" };

export default async function Trail() {
  const me = await requireStaff();
  // Where somebody was all day: office and admin, as the route allows.
  if (!me || (me.role !== "admin" && me.role !== "office")) redirect("/");
  return <TrailBoard />;
}
