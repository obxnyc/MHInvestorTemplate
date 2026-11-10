import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import CrewSetup from "@/components/CrewSetup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crews & texts — Larabee Homes" };

export default async function Crew() {
  const me = await requireStaff();
  if (!me || (me.role !== "admin" && me.role !== "office")) redirect("/");
  return <CrewSetup />;
}
