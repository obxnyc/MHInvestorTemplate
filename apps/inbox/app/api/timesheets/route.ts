import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { week, weekStart, type Shift } from "@/lib/shift";
import { isField } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The office's side of the clock.
 *
 * Who is out, what everybody's week adds up to, and the corrections waiting
 * to be agreed. The crew screen can ask for a correction; without this one
 * the asking goes nowhere, which is the same fault as a send that clears the
 * box and never reads the answer -- it looks like something happened.
 *
 * Approving goes through `approve_shift_edit`, a single function in migration
 * 039. Moving hours on a pay record and recording that they moved must not be
 * able to come apart, and from here they would be two round trips.
 */

type Db = Awaited<ReturnType<typeof supabaseServer>>;

async function shiftsSince(db: Db, from: string): Promise<(Shift & { name: string })[]> {
  const { data } = await db.from("shifts")
    .select("id, staff_id, property_id, started_at, ended_at, signed_off_at, staff(full_name), shift_breaks(started_at, ended_at)")
    .gte("started_at", from)
    .order("started_at", { ascending: true });

  return (data ?? []).map((s) => ({
    id: String(s.id),
    staffId: String(s.staff_id),
    name: (s.staff as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at),
    endedAt: (s.ended_at as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
      .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  }));
}

export async function GET(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const db = await supabaseServer();
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const off = Number.isFinite(offset) ? offset : 0;
  const start = url.searchParams.get("week") || weekStart(new Date(), off);

  const from = new Date(Date.parse(`${start}T00:00:00Z`) - 864e5).toISOString();
  const [rows, crew, asks] = await Promise.all([
    shiftsSince(db, from),
    db.from("staff").select("id, full_name, role").eq("active", true),
    db.from("shift_edits")
      .select("id, shift_id, staff_id, kind, asked_start, asked_end, asked_break_minutes, reason, state, created_at, staff(full_name)")
      .eq("state", "asked").order("created_at", { ascending: true }),
  ]);

  // Everyone who could be on a clock, not only those who have been. Somebody
  // with no hours this week is a row that says nought, which is an answer --
  // a list built from the shifts that exist cannot say "nobody turned up".
  const people = (crew.data ?? []).filter((s) => isField(s.role));

  return NextResponse.json({
    week: start,
    people: people.map((p) => {
      const theirs = rows.filter((r) => r.staffId === p.id);
      return {
        id: String(p.id),
        name: String(p.full_name ?? "Unknown"),
        onTheClock: theirs.some((s) => !s.endedAt),
        week: week(theirs, start, new Date(), { offsetMinutes: off }),
      };
    }),
    // Absent until 039 is run. An empty queue then, rather than a failure.
    asks: asks.error ? [] : (asks.data ?? []).map((a) => ({
      ...a,
      name: (a.staff as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    })),
    migrationMissing: !!asks.error,
  });
}

export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const db = await supabaseServer();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "which request?" }, { status: 400 });

  if (body.decision === "approve") {
    // One function, one transaction. See 039 for why this is not two writes.
    const { error } = await db.rpc("approve_shift_edit", { p_edit: id, p_by: me.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.decision === "decline") {
    // A decline with no word on it is the thing somebody rings up about, so
    // the note is required here even though the column allows null -- null is
    // for the requests approved without comment.
    const note = String(body.note ?? "").trim();
    if (note.length < 3) {
      return NextResponse.json({
        error: "Say why you are declining it — they will ask.",
      }, { status: 400 });
    }
    const { error } = await db.from("shift_edits").update({
      state: "declined", decided_by: me.id,
      decided_at: new Date().toISOString(), decided_note: note,
    }).eq("id", id).eq("state", "asked");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "approve or decline" }, { status: 400 });
}
