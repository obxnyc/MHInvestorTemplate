import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import Link from "next/link";
import Live from "@/components/Live";
import BackLink from "@/components/BackLink";
import CallCard, { type CallView, type Target } from "@/components/CallCard";
import { CALL_CATEGORIES } from "@/lib/callcats";

export const dynamic = "force-dynamic";

/**
 * The office line: every call, who took it, what it was about, the recording,
 * what was said, and what is still owed to the caller.
 *
 * Read with the signed-in person's own client, so the row policies decide what
 * they see. The transfer list comes from the phone list itself.
 */
export default async function Calls({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "" } = await searchParams;
  const supabase = await supabaseServer();

  let q = supabase
    .from("calls")
    .select("id, direction, missed, created_at, duration_seconds, voicemail_text, recording_sid, conversation_id, returns_call_id, category, route_key, after_hours, answered_at, ended_at, notes, summary, follow_up, suggested_category, texted, language, contacts(phone, full_name), answered:answered_by(full_name), person:answered_person(full_name), call_recordings(recording_sid, kind, duration_seconds, transcript, transcript_status, created_at)")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(100);
  if (f === "missed") q = q.eq("missed", true);
  else if (f === "live") q = q.not("answered_at", "is", null).is("ended_at", null)
    .gte("created_at", new Date(Date.now() - 4 * 3600 * 1000).toISOString());
  else if ((CALL_CATEGORIES as readonly string[]).includes(f)) q = q.eq("category", f);

  const [{ data: calls, error }, { data: returnedRows }, people, routes] = await Promise.all([
    q,
    supabase.from("calls").select("returns_call_id").not("returns_call_id", "is", null)
      .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
    supabaseAdmin().from("phone_people").select("id, full_name").eq("active", true).order("full_name"),
    supabaseAdmin().from("call_routes").select("key, category, day_group, night_group").order("sort"),
  ]);

  // A missed call counts as handled once some outbound call points back at it.
  const returned = new Set((returnedRows ?? []).map((r) => r.returns_call_id));

  const targets: Target[] = [
    ...(people.data ?? []).map((p) => ({ kind: "person" as const, id: p.id, label: p.full_name })),
    ...(routes.data ?? [])
      .filter((r) => r.day_group || r.night_group)
      .map((r) => ({ kind: "team" as const, id: r.key, label: `${r.category} team` })),
  ];

  const views: CallView[] = (calls ?? []).map((c) => {
    const ct = c.contacts as unknown as { phone: string; full_name: string | null } | null;
    const who = (c.person as unknown as { full_name: string } | null)?.full_name
      ?? (c.answered as unknown as { full_name: string } | null)?.full_name ?? null;
    const recs = ((c.call_recordings ?? []) as unknown as CallView["recordings"])
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    // Calls from before recordings had rows of their own.
    if (!recs.length && c.recording_sid) {
      recs.push({ recording_sid: c.recording_sid, kind: c.missed ? "voicemail" : "call",
        duration_seconds: c.duration_seconds, transcript: null, transcript_status: null,
        created_at: c.created_at });
    }
    return {
      id: c.id, createdAt: c.created_at,
      name: ct?.full_name ?? null, phone: ct?.phone ?? "",
      category: c.category, suggested: c.suggested_category,
      afterHours: !!c.after_hours, spanish: c.language === "es", missed: !!c.missed, returned: returned.has(c.id),
      live: !!c.answered_at && !c.ended_at
        && Date.now() - new Date(c.created_at).getTime() < 4 * 3600 * 1000,
      answeredBy: who, duration: c.duration_seconds,
      texted: c.texted, voicemail: c.voicemail_text,
      summary: c.summary, followUp: c.follow_up, notes: c.notes,
      conversationId: c.conversation_id, recordings: recs,
    };
  });

  const tab = (key: string, label: string) => (
    <Link key={key} prefetch={false} href={key ? `/calls?f=${encodeURIComponent(key)}` : "/calls"}
      className={`cl-filter${f === key ? " on" : ""}`}>{label}</Link>
  );

  return (
    <main className="inbox">
      <BackLink />
      <Live />
      <h1 className="pagetitle">Calls</h1>
      <nav className="cl-filters" aria-label="Show">
        {tab("", "All")}
        {tab("live", "Live now")}
        {tab("missed", "Missed")}
        {CALL_CATEGORIES.map((c) => tab(c, c))}
      </nav>

      {error && (
        <p className="cl-error">
          Could not read the calls: {error.message}.
          {/column|relation/.test(error.message) ? " Migration 069 has probably not been run yet." : ""}
        </p>
      )}

      <ul className="threads">
        {views.map((c) => <li key={c.id}><CallCard call={c} targets={targets} /></li>)}
        {!error && !views.length && (
          <li className="cl-none">{f ? "No calls match this filter." : "No calls yet."}</li>
        )}
      </ul>
    </main>
  );
}
