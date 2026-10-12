import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import OwnerScreen from "@/components/OwnerScreen";

export const dynamic = "force-dynamic";

/** One investor: what they own, what they owe, and their papers. */
export default async function OwnerPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireStaff();
  if (!me) redirect("/login");
  const { id } = await params;
  return <OwnerScreen ownerId={id} />;
}
