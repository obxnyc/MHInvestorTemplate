import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import TeamChat from "@/components/TeamChat";

export const dynamic = "force-dynamic";

/** Talking to each other, kept away from the shared line. */
export default async function Team() {
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  return <TeamChat />;
}
