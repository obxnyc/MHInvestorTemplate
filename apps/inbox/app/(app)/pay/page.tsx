import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PayBoard from "@/components/PayBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Friday pay — Larabee Homes" };

export default async function Pay() {
  const me = await requireStaff();
  // Everybody's wage. Office and admin, the same two the route allows.
  if (!me || (me.role !== "admin" && me.role !== "office")) redirect("/");
  return <PayBoard />;
}
