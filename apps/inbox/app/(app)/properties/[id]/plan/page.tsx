import { requireStaff } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import ParkScreen from "@/components/ParkScreen";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

/** The park, drawn. A thin page: everything here is one client component,
 *  because arranging a plan is a conversation with the screen rather than a
 *  sequence of pages. */
export default async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) notFound();
  const { id } = await params;
  return (
    <>
      <BackLink fallback="/properties" label="Properties" />
      <ParkScreen propertyId={id} />
    </>
  );
}
