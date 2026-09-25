import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { prettyPhone } from "@/lib/format";
import PeopleAdmin from "@/components/PeopleAdmin";

export const dynamic = "force-dynamic";

/** Everyone the shared line knows: the people who work here, and the trades. */
export default async function People(
  { searchParams }: { searchParams: Promise<{ tab?: string }> },
) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") redirect("/");
  const { tab = "office" } = await searchParams;

  const supabase = await supabaseServer();
  const [{ data: staff }, { data: vendors }] = await Promise.all([
    supabase.from("staff").select("id, full_name, role, forward_to, active, created_at")
      .order("full_name"),
    supabase.from("contacts").select("id, full_name, phone")
      .eq("party", "vendor").order("full_name"),
  ]);

  const office = (staff ?? []).filter((s) => s.role === "admin" || s.role === "office");
  const field = (staff ?? []).filter((s) => s.role === "tech" || s.role === "shower");

  return (
    <PeopleAdmin
      tab={tab}
      isAdmin={me.role === "admin"}
      office={office}
      field={field}
      vendors={(vendors ?? []).map((v) => ({
        id: v.id,
        full_name: v.full_name ?? prettyPhone(v.phone),
        phone: prettyPhone(v.phone),
      }))}
    />
  );
}
