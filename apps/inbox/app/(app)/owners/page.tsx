import { canSeeOffice, isDesk } from "@/lib/roles";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import OwnersBoard from "@/components/OwnersBoard";

export const dynamic = "force-dynamic";

/**
 * Every investor on the books.
 *
 * The papers have been generated per investor since the owner card
 * shipped, and the only way to reach one was to walk to a park, find a
 * lot with a sale recorded on it, and click the name on that card. So
 * the papers for a sale that is not recorded yet -- which is to say the
 * papers that MAKE the sale -- could not be reached at all.
 */
export default async function OwnersPage() {
  const staff = await requireStaff();
  if (!staff || !canSeeOffice(staff.role)) redirect("/");
  return <OwnersBoard canAdd={isDesk(staff.role)} />;
}
