import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import Live from "@/components/Live";

export const dynamic = "force-dynamic";

const initials = (n: string) =>
  n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

type Params = { searchParams: Promise<{ show?: string }> };

/** Conversation list. Reads like a phone's Messages app on purpose: a person,
 *  what they last said, when. The shared part — who has it, what still needs
 *  someone — sits in the small print rather than reorganising the screen. */
export default async function Messages({ searchParams }: Params) {
  const staff = await requireStaff();
  const { show = "all" } = await searchParams;
  const supabase = await supabaseServer();

  let q = supabase
    .from("conversations")
    .select("id, category, source, assigned_to, last_message_at, last_message_preview, subject, contacts(phone, full_name), staff:assigned_to(full_name)")
    .neq("status", "closed")
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (show === "mine") q = q.eq("assigned_to", staff!.id);
  if (show === "unclaimed") q = q.is("assigned_to", null);

  const [{ data: rows }, { count: unclaimed }] = await Promise.all([
    q,
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .neq("status", "closed").is("assigned_to", null),
  ]);

  const tabs: [string, string][] = [
    ["all", "All"],
    ["unclaimed", `Needs someone${unclaimed ? ` ${unclaimed}` : ""}`],
    ["mine", "Mine"],
  ];

  return (
    <div className="split">
      <Live />
      <div className="listcol">
      <div className="segs">
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <Link key={k} href={k === "all" ? "/" : `/?show=${k}`}
                className={show === k ? "on" : ""}>{label}</Link>
        ))}
      </div>
      </div>

      <ul className="rows">
        {rows?.map((c) => {
          const contact = c.contacts as unknown as { phone: string; full_name: string | null };
          const holder = c.staff as unknown as { full_name: string } | null;
          const name = contact?.full_name || prettyPhone(contact?.phone ?? "");
          return (
            <li key={c.id}>
              <Link href={`/c/${c.id}`} className="row">
                <span className="av">{initials(name)}</span>
                <span className="rbody">
                  <span className="rtop">
                    <span className="rname">{name}</span>
                    <span className="rtime">{timeAgo(c.last_message_at)}</span>
                  </span>
                  <span className="rprev">{c.last_message_preview ?? c.subject}</span>
                  <span className="rfoot">
                    <span className="chan">{c.source}</span>
                    {holder
                      ? <span className="owner">
                          {holder.full_name === staff!.full_name ? "you" : holder.full_name.split(" ")[0]}
                        </span>
                      : <span className="needs">Needs someone</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {!rows?.length && <li className="empty">Nothing here.</li>}
      </ul>
      </div>
      <div className="chatcol">
        <div className="empty">
          <div>
            <p style={{ fontWeight: 700, color: "var(--ink)", marginBottom: ".3rem" }}>
              No conversation selected
            </p>
            <p style={{ margin: 0 }}>Pick one from the list to read it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
