import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import { CATEGORIES, CAT_TAB, catLabel, propertyOf, type Category } from "@/lib/category";
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

type Params = {
  searchParams: Promise<{ show?: string; who?: string; q?: string; cat?: string }>;
};

export default async function Messages({ searchParams }: Params) {
  const staff = await requireStaff();
  const { show = "open", who = "everyone", q = "", cat = "all" } = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from("conversations")
    // One string literal, not a concatenation: supabase-js infers the row type
    // from the literal, and anything it cannot read collapses the result to an
    // error type.
    .select("id, category, source, status, assigned_to, closure_prompts, category_confidence, last_message_at, last_message_preview, subject, units(label, properties(name, color)), contacts(phone, full_name, party, units(label, properties(name, color))), staff:assigned_to(full_name)")
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (show === "open") query = query.eq("status", "open");
  if (show === "closed") query = query.eq("status", "closed");
  if (show === "closing") query = query.gt("closure_prompts", 0).eq("status", "open");
  if (show === "review") query = query.lt("category_confidence", 0.75).eq("status", "open");
  // The category tab narrows whatever the status tab already chose, so
  // "Closed + Maintenance" is a real view rather than two competing filters.
  if (cat !== "all" && CATEGORIES.includes(cat as Category)) query = query.eq("category", cat);
  if (who === "unclaimed") query = query.is("assigned_to", null);
  if (who === "mine") query = query.eq("assigned_to", staff!.id);
  if (q) query = query.or(`subject.ilike.%${q}%,last_message_preview.ilike.%${q}%`);

  const [{ data: rows }, { data: counts }, { count: unclaimed }, { count: closing }] =
    await Promise.all([
      query,
      supabase.from("open_category_counts").select("category, total, unclaimed"),
      supabase.from("conversations").select("id", { count: "exact", head: true })
        .eq("status", "open").is("assigned_to", null),
      supabase.from("conversations").select("id", { count: "exact", head: true })
        .eq("status", "open").gt("closure_prompts", 0),
    ]);

  const byCat = new Map<string, { total: number; unclaimed: number }>(
    (counts ?? []).map((r) => [r.category as string, { total: r.total, unclaimed: r.unclaimed }]),
  );
  const openTotal = [...byCat.values()].reduce((a, b) => a + b.total, 0);

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ show, who, cat, ...(q ? { q } : {}), ...extra });
    for (const [k, v] of [...p])
      if (!v || v === "open" || v === "everyone" || v === "all") p.delete(k);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  const statusTabs: [string, string][] = [
    ["open", "Open"], ["unread", "Unread"], ["closed", "Closed"], ["all", "All"],
  ];

  // Empty queues still get a tab. "Maintenance 0" is information — it says
  // nothing is outstanding — whereas a tab that disappears just looks broken.
  const catTabs: [string, string, number][] = [
    ["all", "All", openTotal],
    ...CATEGORIES.map((k) =>
      [k, CAT_TAB[k], byCat.get(k)?.total ?? 0] as [string, string, number]),
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

        {/* What it is about, not who it is from. This strip is the differentiator:
            a maintenance request and a prospective tenant are never in the same
            pile unless you ask for All. */}
        <div className="catwrap">
        <nav className="cattabs" aria-label="Filter by what the conversation is about">
          {catTabs.map(([k, label, n]) => (
            <Link key={k} href={keep({ cat: k })}
                  className={`cattab cat-${k}${cat === k ? " on" : ""}`}
                  aria-current={cat === k ? "page" : undefined}>
              <span className="dot" aria-hidden="true" />
              {label}
              <span className="n">{n}</span>
            </Link>
          ))}
        </nav>
        </div>

        <QueueSelects who={who} show={show}
                      unclaimed={unclaimed ?? 0} closing={closing ?? 0} />

        <ul className="rows">
          {rows?.map((c) => {
            const contact = c.contacts as unknown as
              { phone: string; full_name: string | null; party: string;
                units: { label: string | null; properties: { name: string; color: string | null } | null } | null };
            const holder = c.staff as unknown as { full_name: string } | null;
            const name = contact?.full_name || prettyPhone(contact?.phone ?? "");
            const [bg, fg] = swatch(name);
            const unsure = c.category_confidence !== null && c.category_confidence < 0.75;
            const prop = propertyOf(c.units as never, contact?.units as never);
            return (
              <li key={c.id}>
                <Link href={`/c/${c.id}`} className={`row cat-${c.category}`}>
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
                      <span className={`badge cat-${c.category}`}>{catLabel(c.category)}</span>
                      {c.closure_prompts > 0 && (
                        <span className="pill warn">{c.closure_prompts}&times;</span>
                      )}
                      {unsure && <span className="pill grey">unsure</span>}
                      <span className="rtime">{timeAgo(c.last_message_at)}</span>
                    </span>
                    <span className="rprev">{c.last_message_preview ?? c.subject}</span>
                    {prop && (
                      <span className="prop" title={prop.exact ? undefined
                        : `From ${name}'s unit — no unit set on this thread yet`}>
                        <span className="pdot" style={{ background: prop.color }} />
                        <span className="pname">
                          {prop.name}{prop.unit ? ` · ${prop.unit}` : ""}
                        </span>
                      </span>
                    )}
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
