import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone } from "@/lib/format";
import { toE164 } from "@/lib/twilio";
import type { Recipient } from "@/lib/compose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everyone you could start a message to, in one list.
 *
 * One search rather than a tab per kind of person. Whoever is composing knows
 * the name they want; making them first decide whether that name is filed as
 * staff, a tenant or a vendor is asking them to know how the database is
 * arranged before they can send a text.
 *
 * Read through the signed-in user's client so row-level security decides what
 * comes back, rather than this route deciding a second time and eventually
 * disagreeing with it.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const supabase = await supabaseServer();

  // Empty box: who you have been talking to. A blank panel with a prompt to
  // type is a worse starting point than the eight people it is nearly always
  // going to be.
  if (!q) {
    const [{ data: convos }, { data: threads }] = await Promise.all([
      supabase.from("conversations")
        .select("last_message_at, contact:contact_id(id, full_name, phone, party)")
        .neq("status", "closed")
        .order("last_message_at", { ascending: false }).limit(12),
      supabase.from("dm_members")
        .select("thread:thread_id(id, title, last_at, dm_members(staff:staff_id(id, full_name, role)))")
        .eq("staff_id", me.id).limit(12),
    ]);

    const recent: Recipient[] = [];
    const seen = new Set<string>();

    for (const row of threads ?? []) {
      const t = row.thread as unknown as {
        id: string; title: string | null; last_at: string;
        dm_members: { staff: { id: string; full_name: string; role: string } | null }[];
      } | null;
      if (!t) continue;
      const others = (t.dm_members ?? []).map((m) => m.staff)
        .filter((s): s is { id: string; full_name: string; role: string } =>
          s !== null && s.id !== me.id);
      // A group is reached as itself, not as one of its members.
      if (t.title || others.length !== 1) continue;
      const [other] = others;
      if (seen.has(other.id)) continue;
      seen.add(other.id);
      recent.push({ kind: "staff", id: other.id, name: other.full_name, sub: other.role });
    }

    for (const row of convos ?? []) {
      const c = row.contact as unknown as
        { id: string; full_name: string | null; phone: string; party: string } | null;
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      recent.push({
        kind: "contact", id: c.id,
        name: c.full_name || prettyPhone(c.phone),
        sub: c.full_name ? prettyPhone(c.phone) : c.party.replace("_", " "),
      });
    }

    return NextResponse.json({ recent: recent.slice(0, 8), results: null });
  }

  const digits = q.replace(/\D/g, "");
  const like = `%${q.replace(/[%_]/g, "")}%`;

  const [{ data: people }, { data: contacts }] = await Promise.all([
    supabase.from("staff").select("id, full_name, role")
      .eq("active", true).ilike("full_name", like).order("full_name").limit(8),
    // Matched on name OR number, because half of these people are remembered
    // as a name and half as the number on a work order.
    supabase.from("contacts").select("id, full_name, phone, party")
      .or(digits.length >= 3
        ? `full_name.ilike.${like},phone.ilike.%${digits}%`
        : `full_name.ilike.${like}`)
      .order("full_name").limit(12),
  ]);

  const results: Recipient[] = [
    ...(people ?? [])
      .filter((p) => p.id !== me.id)
      .map((p): Recipient => ({ kind: "staff", id: p.id, name: p.full_name, sub: p.role })),
    ...(contacts ?? []).map((c): Recipient => ({
      kind: "contact", id: c.id,
      name: c.full_name || prettyPhone(c.phone),
      sub: c.full_name ? prettyPhone(c.phone) : c.party.replace("_", " "),
    })),
  ];

  // A number nobody has on file. Offered last, and only once it is long enough
  // to be a real one, so it never sits above the person you were looking for.
  const phone = toE164(q);
  if (/^\+\d{11,15}$/.test(phone) && !results.some((r) => r.name === prettyPhone(phone))) {
    results.push({
      kind: "number", id: phone, name: prettyPhone(phone), sub: "not in your contacts",
    });
  }

  return NextResponse.json({ recent: null, results });
}
