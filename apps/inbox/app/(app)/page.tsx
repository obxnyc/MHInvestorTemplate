import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import Live from "@/components/Live";
import Search from "@/components/Search";
import QueueSelects from "@/components/QueueSelects";

export const dynamic = "force-dynamic";

/** A name gives initials; an unsaved number gives its last two digits, because
 *  "(2" tells you nothing and reads like a rendering fault. */
function initials(n: string) {
  const s = String(n).trim();
  if (/^[\d\s()+\-.]+$/.test(s)) return s.replace(/\D/g, "").slice(-2) || "#";
  return s.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

/** Tinted per person so a face is recognisable down the list; the badge
 *  carries the category. */
const SWATCH = [
  ["#E3ECFA", "#2F4E7E"], ["#FAE6EC", "#7E3350"], ["#E4F0E9", "#0F4B36"],
  ["#F0EAFA", "#54417F"], ["#FBEEE3", "#8A4418"], ["#E6F1F4", "#1F5566"],
];
const swatch = (n: string) =>
  SWATCH[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % SWATCH.length];

type Params = { searchParams: Promise<{ show?: string; who?: string; q?: string }> };

export default async function Messages({ searchParams }: Params) {
  const staff = await requireStaff();
  const { show = "open", who = "everyone", q = "" } = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from("conversations")
    .select("id, category, source, status, assigned_to, closure_prompts, category_confidence, last_message_at, last_message_preview, subject, contacts(phone, full_name, party), staff:assigned_to(full_name)")
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (show === "open") query = query.eq("status", "open");
  if (show === "closed") query = query.eq("status", "closed");
  if (show === "maintenance") query = query.eq("category", "maintenance").eq("status", "open");
  if (show === "leasing") query = query.eq("category", "prospect").eq("status", "open");
  if (show === "closing") query = query.gt("closure_prompts", 0).eq("status", "open");
  if (show === "review") query = query.lt("category_confidence", 0.75).eq("status", "open");
  if (who === "unclaimed") query = query.is("assigned_to", null);
  if (who === "mine") query = query.eq("assigned_to", staff!.id);
  if (q) query = query.or(`subject.ilike.%${q}%,last_message_preview.ilike.%${q}%`);

  const [{ data: rows }, { count: unclaimed }, { count: closing }] = await Promise.all([
    query,
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("status", "open").is("assigned_to", null),
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("status", "open").gt("closure_prompts", 0),
  ]);

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ show, who, ...(q ? { q } : {}), ...extra });
    for (const [k, v] of [...p]) if (!v || v === "open" || v === "everyone") p.delete(k);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  const statusTabs: [string, string][] = [
    ["open", "Open"], ["unread", "Unread"], ["closed", "Closed"], ["all", "All"],
  ];

  return (
    <div className="split">
      <Live />
      <div className="listcol">
        <Search initial={q} />

        <div className="tabsrow">
          <div className="tabs">
            {statusTabs.map(([k, label]) => (
              <Link key={k} href={keep({ show: k })} className={show === k ? "on" : ""}>
                {label}
              </Link>
            ))}
          </div>
        </div>

        <QueueSelects who={who} show={show}
                      unclaimed={unclaimed ?? 0} closing={closing ?? 0} />

        <ul className="rows">
          {rows?.map((c) => {
            const contact = c.contacts as unknown as
              { phone: string; full_name: string | null; party: string };
            const holder = c.staff as unknown as { full_name: string } | null;
            const name = contact?.full_name || prettyPhone(contact?.phone ?? "");
            const [bg, fg] = swatch(name);
            const unsure = c.category_confidence !== null && c.category_confidence < 0.75;
            return (
              <li key={c.id}>
                <Link href={`/c/${c.id}`} className="row">
                  <span className="avwrap">
                    <span className="av" style={{ background: bg, color: fg }}>
                      {initials(name)}
                    </span>
                    {holder
                      ? <span className="who-pip" title={holder.full_name}>
                          {initials(holder.full_name)}
                        </span>
                      : <span className="open-pip" title="Nobody has picked this up" />}
                  </span>
                  <span className="rbody">
                    <span className="rtop">
                      <span className="rname">{name}</span>
                      {contact?.party && contact.party !== "other" && (
                        <span className={`badge ${contact.party}`}>
                          {contact.party.replace("_", " ")}
                        </span>
                      )}
                      {c.closure_prompts > 0 && (
                        <span className="pill warn">{c.closure_prompts}&times;</span>
                      )}
                      {unsure && <span className="pill grey">unsure</span>}
                      <span className="rtime">{timeAgo(c.last_message_at)}</span>
                    </span>
                    <span className="rprev">{c.last_message_preview ?? c.subject}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {!rows?.length && <li className="none">No conversations match.</li>}
        </ul>
      </div>

      <div className="chatcol idle">
        <div className="empty">
          <div>
            <div className="ic">
              <svg viewBox="0 0 24 24">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z" />
              </svg>
            </div>
            <h3>No conversation selected</h3>
            <p>Pick one from the list, or start a new message.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
