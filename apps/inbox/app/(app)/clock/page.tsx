import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import ClockScreen from "@/components/ClockScreen";

export const dynamic = "force-dynamic";
export const metadata = { title: "On the clock — Larabee Homes" };

export default async function Clock() {
  const me = await requireStaff();
  if (!me) redirect("/");
  return <ClockScreen name={me.full_name ?? ""} />;
}
