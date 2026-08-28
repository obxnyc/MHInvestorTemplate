import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone, clockTime } from "@/lib/format";
import Composer from "@/components/Composer";
import ClaimPill from "@/components/ClaimPill";
import CloseButton from "@/components/CloseButton";
import Live from "@/components/Live";

export const dynamic = "force-dynamic";

const initials = (n: string) =>
  n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff();
  const supabase = await supabaseServer();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, category, source, status, category_confidence, assigned_to, contacts(phone, full_name), staff:assigned_to(full_name)")
    .eq("id", id).single();
  if (!convo) notFound();

  const [{ data: messages }, { data: notes }] = await Promise.all([
    supabase.from("messages")
      .select("id, direction, body, status, channel, created_at, media_urls, staff:sent_by(full_name)")
      .eq("conversation_id", id).order("created_at"),
    supabase.from("notes")
      .select("id, body, created_at, staff:author_id(full_name)")
      .eq("conversation_id", id).order("created_at"),
  ]);

  const contact = convo.contacts as unknown as { phone: string; full_name: string | null };
  const holder = convo.staff as unknown as { full_name: string } | null;
  const name = contact.full_name || prettyPhone(contact.phone);

  // Messages and internal notes interleave by time so the thread reads as one
  // story rather than two half-records.
  const timeline = [
    ...(messages ?? []).map((m) => ({ kind: "message" as const, at: m.created_at, m })),
    ...(notes ?? []).map((n) => ({ kind: "note" as const, at: n.created_at, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  let lastDay = "";

  return (
    <div className="chatcol">
      <Live />
      <div className="chead">
        <Link href="/" className="chevron" aria-label="Back to messages">&lsaquo;</Link>
        <span className="avatar">{initials(name)}</span>
        <span>
          <span className="nm">{name}</span>
          <span className="sub">via {convo.source}</span>
        </span>
        <ClaimPill
          conversationId={id}
          holderName={holder?.full_name ?? null}
          isMine={convo.assigned_to === staff!.id}
        />
        <CloseButton conversationId={id} isClosed={convo.status === "closed"} />
      </div>

      {/* The classifier was not sure. Say so, rather than presenting a guess
          as a fact — an unsure label a human can correct beats a confident
          wrong one nobody questions. */}
      {convo.category_confidence !== null && convo.category_confidence < 0.75 && (
        <div className="unsure">
          Filed as <strong>{convo.category.replace("_", " ")}</strong> but we
          weren&rsquo;t confident. Recategorise it if that&rsquo;s wrong.
        </div>
      )}

      <div className="msgs">
        {timeline.map((item) => {
          const day = new Date(item.at).toLocaleDateString(undefined,
            { weekday: "long", month: "short", day: "numeric" });
          const sep = day !== lastDay ? ((lastDay = day), day) : null;

          if (item.kind === "note") {
            const who = (item.n.staff as unknown as { full_name: string })?.full_name;
            return (
              <div key={`n${item.n.id}`}>
                {sep && <div className="daysep">{sep}</div>}
                <div className="note">
                  <span className="lab">{who} · only your team sees this</span>
                  <p>{item.n.body}</p>
                </div>
              </div>
            );
          }

          const m = item.m;
          const author = (m.staff as unknown as { full_name: string })?.full_name;
          // Voicemail and work orders read as system events, not as someone
          // texting you — same as a missed-call row in a phone's Messages.
          const isSystem = m.direction === "inbound" && m.channel !== "sms";
          return (
            <div key={`m${m.id}`}>
              {sep && <div className="daysep">{sep}</div>}
              {isSystem && (
                <div className="sys"><b>{labelFor(m.channel)}</b> · {clockTime(item.at)}</div>
              )}
              <div className={m.direction === "inbound" ? "in" : "out"}>
                {/* Who sent it, above the message. A reply with no name is the
                    thing this whole system exists to prevent. */}
                {m.direction === "outbound" && (
                  <span className="attrib">
                    <span className={author ? "pip" : "pip auto"} />
                    {author ?? "Automated"}
                  </span>
                )}
                <div className="bub">{m.body}</div>
                {m.media_urls?.map((u: string, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt="Attachment" className="mms" />
                ))}
                <span className={
                  m.status === "failed" || m.status === "undelivered"
                    ? "delivered bad" : "delivered"
                }>
                  {clockTime(item.at)}
                  {m.direction === "outbound" && ` · ${deliveryLabel(m.status)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Composer conversationId={id} />
    </div>
  );
}

/** Carrier truth, not app optimism: "sent" only means Twilio accepted it. */
function deliveryLabel(status: string) {
  return { delivered: "Delivered", sent: "Sent", queued: "Sending",
           failed: "Not delivered", undelivered: "Undelivered" }[status] ?? status;
}

function labelFor(channel: string) {
  return { voicemail: "Voicemail", zego: "Work order", zillow: "Zillow enquiry",
           website: "Website form" }[channel] ?? channel;
}
