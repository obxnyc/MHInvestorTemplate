import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, clockTime, timeAgo } from "@/lib/format";
import Composer from "@/components/Composer";
import ClaimBar from "@/components/ClaimBar";
import Live from "@/components/Live";

export const dynamic = "force-dynamic";

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await supabaseServer();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, category, status, assigned_to, subject, contacts(phone, full_name), staff:assigned_to(full_name)")
    .eq("id", id).single();
  if (!convo) notFound();

  const [{ data: messages }, { data: notes }] = await Promise.all([
    supabase.from("messages")
      .select("id, direction, body, status, created_at, media_urls, staff:sent_by(full_name)")
      .eq("conversation_id", id).order("created_at"),
    supabase.from("notes")
      .select("id, body, created_at, staff:author_id(full_name)")
      .eq("conversation_id", id).order("created_at"),
  ]);

  const contact = convo.contacts as unknown as { phone: string; full_name: string | null };
  const holder = convo.staff as unknown as { full_name: string } | null;

  // Messages and internal notes interleave by time, so the thread reads as one
  // story: what the tenant said, who answered, what got noted in between.
  const timeline = [
    ...(messages ?? []).map((m) => ({ kind: "message" as const, at: m.created_at, m })),
    ...(notes ?? []).map((n) => ({ kind: "note" as const, at: n.created_at, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <main className="thread-view">
      <Live />
      <div className="thread-head">
        <Link href="/" className="back">← Inbox</Link>
        <div>
          <h1>{contact.full_name || prettyPhone(contact.phone)}</h1>
          <p className="muted">{prettyPhone(contact.phone)} · {convo.category.replace("_", " ")}</p>
        </div>
      </div>

      <ClaimBar
        conversationId={id}
        holderName={holder?.full_name ?? null}
        isMine={convo.assigned_to === staff!.id}
      />

      <ol className="timeline">
        {timeline.map((item) =>
          item.kind === "note" ? (
            <li key={`n${item.n.id}`} className="note">
              <span className="who">
                {(item.n.staff as unknown as { full_name: string })?.full_name} · internal note
              </span>
              <p>{item.n.body}</p>
              <time>{clockTime(item.at)}</time>
            </li>
          ) : (
            <li key={`m${item.m.id}`} className={item.m.direction === "inbound" ? "in" : "out"}>
              <div className="bubble">
                <p>{item.m.body}</p>
                {item.m.media_urls?.map((u: string, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt="Attachment" className="mms" />
                ))}
              </div>
              <span className="meta">
                {item.m.direction === "outbound" && (
                  <strong>{(item.m.staff as unknown as { full_name: string })?.full_name ?? "system"}</strong>
                )}
                {" "}{clockTime(item.at)}
                {item.m.status === "failed" && <em className="failed"> · not delivered</em>}
                {item.m.status === "undelivered" && <em className="failed"> · undelivered</em>}
              </span>
            </li>
          ),
        )}
      </ol>

      <Composer conversationId={id} />
    </main>
  );
}
