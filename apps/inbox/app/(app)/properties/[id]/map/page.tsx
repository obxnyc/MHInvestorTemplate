import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import BackLink from "@/components/BackLink";
import SiteMap from "@/components/SiteMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One property from above, with every lot on it. */
export default async function PropertyMap(
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireStaff();
  if (!me) redirect("/login");
  const { id } = await params;

  return (
    <main className="sitepage">
      <BackLink fallback="/properties" />
      <SiteMap propertyId={id} />
    </main>
  );
}
