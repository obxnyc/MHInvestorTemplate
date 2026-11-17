import { requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { redirect } from "next/navigation";
import Link from "next/link";
import ParkLeads from "@/components/ParkLeads";
import BrokerBoard from "@/components/BrokerBoard";
import BuyBoxes from "@/components/BuyBoxes";
import SpottedBoard from "@/components/SpottedBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Acquisitions: every NC park owner, and every broker and realtor who might
 *  bring one. Two lists, one place, because they are one job. */
export default async function Parks({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireStaff();
  if (!me || !isDesk(me.role)) redirect("/home");
  const t = (await searchParams).tab;
  const tab = t === "brokers" || t === "buy" || t === "spotted" ? t : "owners";
  return (
    <div className="pk-page">
      <nav className="pk-tabs" aria-label="Acquisitions">
        <Link href="/parks" className={tab === "owners" ? "on" : ""} aria-current={tab === "owners" ? "page" : undefined}>Park owners</Link>
        <Link href="/parks?tab=brokers" className={tab === "brokers" ? "on" : ""} aria-current={tab === "brokers" ? "page" : undefined}>Brokers &amp; agents</Link>
        <Link href="/parks?tab=spotted" className={tab === "spotted" ? "on" : ""} aria-current={tab === "spotted" ? "page" : undefined}>Spotted</Link>
        <Link href="/parks?tab=buy" className={tab === "buy" ? "on" : ""} aria-current={tab === "buy" ? "page" : undefined}>Buy boxes</Link>
      </nav>
      {tab === "brokers" ? <BrokerBoard /> : tab === "buy" ? <BuyBoxes /> : tab === "spotted" ? <SpottedBoard /> : <ParkLeads />}
    </div>
  );
}
