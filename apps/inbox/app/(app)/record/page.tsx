import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import RecordTools from "@/components/RecordTools";

export const dynamic = "force-dynamic";

type Row = {
  id: number; at: string; event: string; source: string;
  conversation_id: string | null; thread_id: string | null;
  author_id: string | null; direction: string | null; body: string | null;
  media_paths: string[] | null;
};
type Hit = { id: number; phrase: string; at: string; seen_at: string | null; record_id: number };

/**
 * The record: every message, note and team-chat message as it was written,
 * every edit and every deletion -- the place to go back to when something
 * has gone wrong.
 *
 * Written by database trigger (072), so no way of sending a message can skip
 * it, and it cannot be changed or emptied, by the app or anybody else. Read
 * by whoever reads everything -- the owner -- and nobody else: the row policy
 * says so, and this page refuses anybody else before asking.
 */
export default async function Record(
  { searchParams }: { searchParams: Promise<{ q?: string; hit?: string; only?: string }> },
) {
  const me = await requireStaff();
  if (!(me as { reads_all_dms?: boolean } | null)?.reads_all_dms) redirect("/home");
  const { q = "", hit, only } = await searchParams;
  const supabase = await supabaseServer();

  const { data: hitRows } = await supabase.from("watch_hits")
    .select("id, phrase, at, seen_at, record_id")
    .order("at", { ascending: false }).limit(300);
  const hits = (hitRows ?? []) as Hit[];
  const unseen = hits.filter((h) => !h.seen_at);
  const hitsBy = new Map<number, Hit[]>();
  for (const h of hits) hitsBy.set(h.record_id, [...(hitsBy.get(h.record_id) ?? []), h]);

  let query = supabase.from("message_record")
    .select("id, at, event, source, conversation_id, thread_id, author_id, direction, body, media_paths")
    .order("id", { ascending: false }).limit(200);
  const term = q.trim();
  if (term) query = query.ilike("body", `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`);
  if (only === "hits") query = query.in("id", [...hitsBy.keys()].slice(0, 300));
  if (hit) {
    const h = hits.find((x) => String(x.id) === hit);
    if (h) query = query.eq("id", h.record_id);
  }
  const { data: rowsData, error } = await query;
  const rows = (rowsData ?? []) as Row[];

  const staffIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))] as string[];
  const convoIds = [...new Set(rows.map((r) => r.conversation_id).filter(Boolean))] as string[];
  const [{ data: people }, { data: convos }] = await Promise.all([
    staffIds.length
      ? supabase.from("staff").select("id, full_name").in("id", staffIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    convoIds.length
      ? supabase.from("conversations")
        .select("id, subject, private_to, contacts(full_name, phone)").in("id", convoIds)
      : Promise.resolve({ data: [] as { id: string; subject: string | null; private_to: string[] | null; contacts: unknown }[] }),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const convoOf = new Map((convos ?? []).map((c) => {
    const who = c.contacts as unknown as { full_name: string | null; phone: string | null } | null;
    return [c.id, {
      label: who?.full_name || who?.phone || c.subject || "Conversation",
      private: Boolean((c.private_to as string[] | null)?.length),
    }];
  }));

  return (
    <main className="record">
      <BackLink />
      <h1>Record</h1>
      <p className="muted">
        Every text, note and team-chat message as it was written, including
        edits and deletions, and including private conversations. Only you
        can see this page, and nothing on it can be changed or deleted.
      </p>

      <RecordTools unseen={unseen.map((h) => h.id)} />

      <form className="recsearch" action="/record">
        <input name="q" defaultValue={term} placeholder="Search every message" />
        <button className="btn" type="submit">Search</button>
        <Link className={only === "hits" ? "btn pri" : "btn"} href={only === "hits" ? "/record" : "/record?only=hits"}>
          {only === "hits" ? "Show everything" : `Watched words only${unseen.length ? ` (${unseen.length} new)` : ""}`}
        </Link>
      </form>

      {error && <p className="err">Could not read the record: {error.message}</p>}
      {!error && !rows.length && <p className="muted">Nothing matches.</p>}

      <ol className="reclist">
        {rows.map((r) => {
          const mine = hitsBy.get(r.id) ?? [];
          const isNew = mine.some((h) => !h.seen_at);
          const convo = r.conversation_id ? convoOf.get(r.conversation_id) : null;
          const where = r.source === "team" ? "Team chat"
            : r.source === "note" ? `Note · ${convo?.label ?? "conversation"}`
            : `${r.direction === "inbound" ? "Text in" : "Text out"} · ${convo?.label ?? "conversation"}`;
          return (
            <li key={r.id} className={`${mine.length ? "hit" : ""}${isNew ? " new" : ""}`}>
              <div className="recmeta">
                <span>{new Date(r.at).toLocaleString("en-US", { timeZone: "America/New_York",
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span>{r.author_id ? nameOf.get(r.author_id) ?? "Staff" : r.direction === "inbound" ? "From outside" : "System"}</span>
                <span>
                  {r.conversation_id ? <Link href={`/c/${r.conversation_id}`}>{where}</Link> : where}
                </span>
                {convo?.private && <span className="tag">private</span>}
                {r.event !== "sent" && <span className="tag warn">{r.event}</span>}
                {mine.map((h) => <span key={h.id} className="tag watch">“{h.phrase}”</span>)}
              </div>
              <p className="recbody">{marked(r.body ?? "", mine.map((h) => h.phrase))}</p>
              {r.media_paths?.length ? (
                <p className="dim">{r.media_paths.length} attachment{r.media_paths.length === 1 ? "" : "s"}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </main>
  );
}

/** The words that were caught, marked where they are in the message. */
function marked(text: string, phrases: string[]) {
  if (!phrases.length || !text) return text;
  const esc = phrases.map((p) => p.trim().replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${esc})`, "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}
