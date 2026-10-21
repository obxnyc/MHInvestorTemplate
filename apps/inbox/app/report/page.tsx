import { supabaseAdmin } from "@/lib/supabase-admin";
import ReportForm from "@/components/ReportForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Report a repair — Larabee Homes",
  description: "Tell us what needs fixing and we will get somebody out.",
};

/**
 * Public. A tenant's own way to report a repair, on a page we control.
 *
 * Nothing here asks who they are beyond how to reach them and where they
 * live. A maintenance form is not a place to collect anything else, and a
 * question about household or circumstances on a page about a broken tap is
 * a fair-housing problem wearing a plumber's hat.
 */
export default async function Report() {
  const { data } = await supabaseAdmin()
    .from("properties").select("id, name").order("name");
  return <ReportForm places={(data ?? []).map((p) => String(p.name))} />;
}
