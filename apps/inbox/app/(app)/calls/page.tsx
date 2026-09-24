import { supabaseServer } from "@/lib/supabase-server";
import { prettyPhone, timeAgo } from "@/lib/format";
import Link from "next/link";
import ReturnCall from "@/components/ReturnCall";
import Live from "@/components/Live";

export const dynamic = "force-dynamic";

export default async function Calls() {
  const supabase = await supabaseServer();

  const { data: calls } = await supabase
    .from("calls")
    .select("id, direction, missed, created_at, duration_seconds, voicemail_text, recording_url, conversation_id, returns_call_id, contacts(phone, full_name), answered:answered_by(full_name), initiated:initiated_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(80);

  // A missed call counts as handled once some outbound call points back at it.
  const returned = new Set((calls ?? []).map((c) => c.returns_call_id).filter(Boolean));

  return (
    <main className="inbox">
      <Live />
      <h1 className="pagetitle">Calls</h1>
      <ul className="threads">
        {calls?.filter((c) => c.direction === "inbound").map((c) => {
          const ct = c.contacts as unknown as { phone: string; full_name: string | null };
          const answered = c.answered as unknown as { full_name: string } | null;
          const isReturned = returned.has(c.id);
          return (
            <li key={c.id}>
              <div className={`thread call ${c.missed && !isReturned ? "needs" : ""}`}>
                <div className="line1">
                  <span className="name">{ct?.full_name || prettyPhone(ct?.phone ?? "")}</span>
                  <span className="when">{timeAgo(c.created_at)}</span>
                </div>

                {c.voicemail_text && <p className="preview">{c.voicemail_text}</p>}
                {c.recording_url && (
                  <audio controls preload="none" src={`${c.recording_url}.mp3`} className="rec" />
                )}

                <div className="line3">
                  {c.missed ? (
                    isReturned
                      ? <span className="tag">Returned</span>
                      : <span className="unclaimed">Missed — needs callback</span>
                  ) : (
                    <span className="held">
                      Answered by {answered?.full_name ?? "someone"}
                      {c.duration_seconds ? ` · ${Math.round(c.duration_seconds / 60)}m` : ""}
                    </span>
                  )}
                  {c.conversation_id && (
                    <Link href={`/c/${c.conversation_id}`} className="mini">Open thread</Link>
                  )}
                  {c.missed && !isReturned && (
                    <ReturnCall callId={c.id} phone={ct?.phone ?? ""} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {!calls?.length && <li className="empty">No calls yet.</li>}
      </ul>
    </main>
  );
}
