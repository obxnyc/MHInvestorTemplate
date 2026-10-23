import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { threadLabel, prettyPhone, timeAgo, initials } from "@/lib/format";
import Avatar from "@/components/Avatar";
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
    .select("id, category, source, status, assigned_to, closure_prompts, category_confidence, last_message_at, last_message_preview, subject, units(label, properties(name, color)), contacts(id, phone, full_name, party, language, unit_id, units(label, properties(name, color))), staff:assigned_to(full_name)")
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (show === "open") query = query.eq("status", "open");
  if (show === "closed") query = query.eq("status", "closed");
  /* The Unread tab matched NO branch here, so it fell through to no status
     filter at all and showed every conversation, closed ones included -- a
     tab that looked like a filter and was a no-op. Narrowing to open is only
     half of it; which of those are unread cannot be asked of the database,
     because it depends on the newest INBOUND message, so the rest is done
     below once that is known. */
  if (show === "unread") query = query.eq("status", "open");
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

  /* IS THERE SOMETHING HERE I HAVE NOT SEEN.
   *
   * `conversation_reads` has existed since migration 003 and this list has
   * never asked it, so a text arriving carried no mark at all while a staff
   * thread did -- the one kind of message that is always from outside was the
   * one kind that looked read.
   *
   * It is NOT `last_message_at > last_read_at`. The newest message on a thread
   * is very often one we sent, and a queue that lights up for our own replies
   * is a queue nobody believes by the end of the week. The question is whether
   * the newest message FROM OUTSIDE is newer than the last time I looked, so
   * that is what is asked: the newest inbound per conversation.
   *
   * A conversation with inbound messages and no read row at all is unread --
   * nobody has opened it. Null is "nobody has looked", not "looked at zero". */
  const ids = (rows ?? []).map((c) => c.id);
  const [{ data: reads }, { data: inbound }] = ids.length
    ? await Promise.all([
        supabase.from("conversation_reads")
          .select("conversation_id, last_read_at").eq("staff_id", staff!.id)
          .in("conversation_id", ids),
        supabase.from("messages")
          .select("conversation_id, created_at").in("conversation_id", ids)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false }).limit(2000),
      ])
    : [{ data: [] }, { data: [] }];

  const readAt = new Map((reads ?? []).map(
    (r) => [r.conversation_id as string, r.last_read_at as string]));
  // Ordered newest first, so the first one seen for a conversation is its newest.
  const lastIn = new Map<string, string>();
  for (const m of inbound ?? []) {
    if (!lastIn.has(m.conversation_id as string)) {
      lastIn.set(m.conversation_id as string, m.created_at as string);
    }
  }
  const isUnread = (id: string) => {
    const got = lastIn.get(id);
    if (!got) return false;
    const seen = readAt.get(id);
    return !seen || got > seen;
  };

  const byCat = new Map<string, { total: number; unclaimed: number }>(
    (counts ?? []).map((r) => [r.category as string, { total: r.total, unclaimed: r.unclaimed }]),
  );
  const openTotal = [...byCat.values()].reduce((a, b) => a + b.total, 0);

  /** Each filter's default, dropped from the URL so a plain link stays clean.
   *
   *  Per key, not per value. It used to drop any parameter whose value was
   *  "open", "everyone" or "all" whatever key it belonged to -- and the status
   *  filter has a value called "all" that is NOT its default. So clicking All
   *  deleted show=all, which left the bare path, which means show=open: the tab
   *  lit up and the list stayed exactly as it was. */
  const FILTER_DEFAULT: Record<string, string> =
    { show: "open", who: "everyone", cat: "all" };

  const keep = (extra: Record<string, string>, to = basePath) => {
    const p = new URLSearchParams({ show, who, cat, ...(q ? { q } : {}), ...extra });
    for (const [k, v] of [...p]) if (!v || FILTER_DEFAULT[k] === v) p.delete(k);
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

        {/* ONE LIST, NEWEST FIRST.
            These were two lists rendered one after the other -- every staff
            thread above every text -- so a text that arrived just now sat
            under a colleague's message from twenty hours ago and looked like
            nothing had come in. Both halves were correctly sorted; stacking
            them is what threw the order away. The two sorts were each
            answering a narrower question than the screen was asking. */}
        <ul className="rows">
          {(() => {
            const feed = [
            /* The other half of the Unread tab. It cannot be asked of the
               database because it turns on the newest INBOUND message against
               my own read receipt, neither of which is a column on the row. */
            ...staffRows.filter((t) => show !== "unread" || t.unread).map((t) => ({
              at: t.at,
              node: (
              <li key={`dm${t.id}`}>
                <a href={`/team?t=${t.id}`} data-dm={t.id}
                   className={`row cat-staff${t.id === selectedId ? " sel" : ""}`
                   + `${t.unread ? " unread" : ""}`}>
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
              ),
            })),
            ...(rows ?? []).filter((c) => show !== "unread" || isUnread(c.id))
              .map((c) => ({
              at: c.last_message_at,
              node: ((): React.ReactNode => {
              const contact = c.contacts as unknown as
                { id: string; phone: string; full_name: string | null; party: string;
                  language: string | null; unit_id: string | null;
                  units: { label: string | null; properties: { name: string; color: string | null } | null } | null };
              const holder = c.staff as unknown as { full_name: string } | null;
              /* A synthetic key is not a phone number. Intake has to put
                 SOMETHING in `contacts.phone` because the column is not
                 null, so a Rent Manager issue with no tenant on it got
                 `email:rm:issue:251` -- and the inbox listed a column of
                 threads with that as their name. `threadLabel` falls through
                 to what the thread is about instead, which at least says
                 what is wrong with the house. */
              const name = threadLabel(contact?.full_name, contact?.phone,
                c.last_message_preview ?? c.subject);
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
                        data-contact={contact?.id ?? ""}
                        data-party={contact?.party ?? ""}
                        data-unit={contact?.unit_id ?? ""}
                        data-lang={contact?.language ?? ""}
                        data-cat={c.category}
                        data-named={contact?.full_name ? "1" : "0"}
                        data-claimed={c.assigned_to ? "1" : "0"}
                        data-mine={c.assigned_to === staff?.id ? "1" : "0"}
                        className={`row cat-${c.category}`
                        + `${c.id === selectedId ? " sel" : ""}`
                        + `${isUnread(c.id) ? " unread" : ""}`}
                        aria-current={c.id === selectedId ? "true" : undefined}>
                    <span className="avwrap">
                      <Avatar name={name} />
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
                      {isUnread(c.id) && <span className="pill warn">new</span>}
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
              })(),
            })),
            ].sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));
            /* The empty line keys on WHAT IS RENDERED, not on whether the
               query returned anything. With the Unread tab filtering after the
               query, `rows` can be full while the list is empty -- and "No
               conversations match" under a tab that is doing the matching
               reads as a broken screen rather than as good news. */
            if (feed.length) return feed.map((f) => f.node);
            return (
              <li className="none">
                {show === "unread" ? "Nothing unread. Everything here has been seen."
                                   : "No conversations match."}
              </li>
            );
          })()}
        </ul>
    </div>
  );
}
