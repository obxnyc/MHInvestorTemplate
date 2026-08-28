import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import Live from "@/components/Live";

export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<{ team?: string; show?: string }> };

export default async function Inbox({ searchParams }: Params) {
  const staff = await requireStaff();
  const { team: teamKey, show } = await searchParams;
  const supabase = await supabaseServer();

  const { data: teams } = await supabase.from("teams").select("id, key, name").order("name");
  const active = teams?.find((t) => t.key === teamKey);

  let q = supabase
    .from("conversations")
    .select("id, category, status, assigned_to, last_message_at, subject, team_id, contacts(phone, full_name), staff:assigned_to(full_name)")
    .neq("status", "closed")
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (active) q = q.eq("team_id", active.id);
  if (show === "mine") q = q.eq("assigned_to", staff!.id);
  if (show === "open") q = q.is("assigned_to", null);

  const { data: rows } = await q;

  return (
    <main className="inbox">
      <Live />
      <div className="filters">
        <Link href="/" className={!teamKey && !show ? "chip on" : "chip"}>All</Link>
        <Link href="/?show=open" className={show === "open" ? "chip on" : "chip"}>Unclaimed</Link>
        <Link href="/?show=mine" className={show === "mine" ? "chip on" : "chip"}>Mine</Link>
        {teams?.map((t) => (
          <Link key={t.id} href={`/?team=${t.key}`}
                className={teamKey === t.key ? "chip on" : "chip"}>{t.name}</Link>
        ))}
      </div>

      <ul className="threads">
        {rows?.map((c) => {
          const contact = c.contacts as unknown as { phone: string; full_name: string | null };
          const holder = c.staff as unknown as { full_name: string } | null;
          return (
            <li key={c.id}>
              <Link href={`/c/${c.id}`} className="thread">
                <div className="line1">
                  <span className="name">{contact?.full_name || prettyPhone(contact?.phone ?? "")}</span>
                  <span className="when">{timeAgo(c.last_message_at)}</span>
                </div>
                <p className="preview">{c.subject}</p>
                <div className="line3">
                  <span className={`tag ${c.category}`}>{c.category.replace("_", " ")}</span>
                  {holder
                    ? <span className="held">{holder.full_name}</span>
                    : <span className="unclaimed">Unclaimed</span>}
                </div>
              </Link>
            </li>
          );
        })}
        {!rows?.length && <li className="empty">Nothing here right now.</li>}
      </ul>
    </main>
  );
}
