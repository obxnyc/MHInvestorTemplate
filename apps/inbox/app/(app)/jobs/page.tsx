import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import JobsBoard from "@/components/JobsBoard";

export const dynamic = "force-dynamic";

export default async function Jobs() {
  const staff = await requireStaff();
  if (staff?.role !== "admin" && staff?.role !== "office") redirect("/");
  return <JobsBoard />;
}
