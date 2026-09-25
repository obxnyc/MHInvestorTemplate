import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, timeAgo, initials, swatch } from "@/lib/format";
import { CATEGORIES, CAT_TAB, catLabel, propertyOf, type Category } from "@/lib/category";
import Search from "@/components/Search";
import QueueSelects from "@/components/QueueSelects";

export type ListFilters = { show?: string; who?: string; q?: string; cat?: string };

/** The list of conversations, rendered beside whatever is open.
 *
 *  It was a page once, which meant opening a conversation REPLACED it: the
 *  two-pane view was two separate pages that happened to look like one, and
 *  moving between threads went list, thread, back, list. That is not an inbox.
 *
 *  `basePath` is what keeps it honest -- the filter links rebuild the current
 *  URL rather than jumping home, so changing a filter while reading a thread
 *  keeps the thread open. */
export default async function ConversationList(
  { filters, selectedId, basePath = "/" }:
  { filters: ListFilters; selectedId?: string; basePath?: string },
) {
  const staff = await requireStaff();
  const { show = "open", who = "everyone", q = "", cat = "all" } = filters;
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

  // Conversations with people outside, and threads with colleagues, in one
  // list. You do not keep a second app open to ask Hannah whether she rang the
  // plumber -- and what keeps that safe is that a staff thread is plainly
  // marked and has no phone number on it to send anything to.
  const staffThreads = supabase
    .from("dm_members")
    .select("last_read_at, thread:thread_id(id, title, last_at, dm_members(staff:staff_id(id, full_name)), dm_messages(body, created_at, author_id))")
    .eq("staff_id", staff!.id);

  const [{ data: rows }, { data: counts }, { count: unclaimed }, { count: closing }, { data: dms }] =
    await Promise.all([
      query,
      supabase.from("open_category_counts").select("category, total, unclaimed"),
      supabase.from("conversations").select("id", { count: "exact", head: true })
        .eq("status", "open").is("assigned_to", null),
      supabase.from("conversations").select("id", { count: "exact", head: true })
        .eq("status", "open").gt("closure_prompts", 0),
      staffThreads,
    ]);

  const staffRows = (dms ?? []).map((row) => {
    const t = row.thread as unknown as {
      id: string; title: string | null; last_at: string;
      dm_members: { staff: { id: string; full_name: string } | null }[];
      dm_messages: { body: string; created_at: string; author_id: string | null }[];
    };
    const others = (t.dm_members ?? []).map((m) => m.staff)
      .filter((x): x is { id: string; full_name: string } => Boolean(x) && x!.id !== staff!.id);
    const last = (t.dm_messages ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: t.id,
      name: t.title ?? (others.map((o) => o.full_name).join(", ") || "Just you"),
      at: last?.created_at ?? t.last_at,
      preview: last?.body ?? "No messages yet",
      unread: Boolean(last && last.author_id !== staff!.id
        && (!row.last_read_at || last.created_at > row.last_read_at)),
    };
  })
    // Only when nothing narrower is being asked for: a staff thread is not a
    // maintenance request and must not pad out a filtered queue.
    .filter(() => cat === "all" && who === "everyone" && show !== "closed"
      && (!q || true))
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())
      || r.preview.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.at.localeCompare(a.at));

  const byCat = new Map<string, { total: number; unclaimed: number }>(
    (counts ?? []).map((r) => [r.category as string, { total: r.total, unclaimed: r.unclaimed }]),
  );
  const openTotal = [...byCat.values()].reduce((a, b) => a + b.total, 0);

  const keep = (extra: Record<string, string>, to = basePath) => {
    const p = new URLSearchParams({ show, who, cat, ...(q ? { q } : {}), ...extra });
    for (const [k, v] of [...p])
      if (!v || v === "open" || v === "everyone" || v === "all") p.delete(k);
    const s = p.toString();
    return s ? `${to}?${s}` : to;
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
          {staffRows.map((t) => (
            <li key={`dm${t.id}`}>
              <a href={`/team?t=${t.id}`} data-dm={t.id}
                 className={`row cat-staff${t.id === selectedId ? " sel" : ""}`}>
                <span className="avwrap">
                  <span className="av staffav">{initials(t.name)}</span>
                </span>
                <span className="rbody">
                  <span className="rtop">
                    <span className="rname">{t.name}</span>
                    <span className="badge staffbadge">Staff</span>
                    {t.unread && <span className="pill warn">new</span>}
                    <span className="rtime">{timeAgo(t.at)}</span>
                  </span>
                  <span className="rprev">{t.preview}</span>
                </span>
              </a>
            </li>
          ))}

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
                {/* A real link, so middle-click and copy-link work and a
                    pasted URL opens the thread. The inbox intercepts the plain
                    click and swaps the pane instead of navigating. */}
                {/* What the right-click menu needs to act without opening the
                    thread first. Written here because the list already knows
                    all of it -- fetching it again on right-click would be a
                    round trip for a menu that has to feel instant. */}
                <Link href={`/c/${c.id}`} data-cid={c.id}
                      data-name={name}
                      data-phone={contact?.phone ?? ""}
                      data-claimed={c.assigned_to ? "1" : "0"}
                      data-mine={c.assigned_to === staff?.id ? "1" : "0"}
                      className={`row cat-${c.category}${c.id === selectedId ? " sel" : ""}`}
                      aria-current={c.id === selectedId ? "true" : undefined}>
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
  );
}
