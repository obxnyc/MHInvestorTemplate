import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { payrollCsv, type PayShift } from "@/lib/crew";
import { weekStart } from "@/lib/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The week as a spreadsheet: one row per shift, then each person's total.
 * Opens in Excel, Google Sheets, and anything a payroll service imports.
 *
 * `offset` is the browser's, so the dates and times in the file are the
 * office's own and not the server's UTC.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return new Response("not allowed", { status: 403 });
  }
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
  const week = url.searchParams.get("week") || weekStart(new Date(), offset);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return new Response("bad week", { status: 400 });

  const from = new Date(Date.parse(`${week}T00:00:00Z`) + offset * 60_000).toISOString();
  const to = new Date(Date.parse(`${week}T00:00:00Z`) + 7 * 864e5 + offset * 60_000).toISOString();

  const db = await supabaseServer();
  const { data, error } = await db.from("shifts")
    .select("id, staff_id, property_id, property_from, started_at, ended_at, signed_off_at, start_fence, end_fence, auto_clocked_out, staff!shifts_staff_id_fkey(full_name), properties(name, address), shift_breaks(started_at, ended_at)")
    .gte("started_at", from).lt("started_at", to);
  if (error) return new Response(error.message, { status: 500 });

  const shifts: PayShift[] = (data ?? []).map((s) => {
    const p = s.properties as unknown as { name: string; address: string | null } | null;
    return {
      id: String(s.id), staffId: String(s.staff_id),
      name: (s.staff as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
      propertyId: (s.property_id as string | null) ?? null,
      siteName: p?.name ?? null, siteAddress: p?.address ?? null,
      propertyFrom: (s.property_from as string | null) ?? null,
      startFence: (s.start_fence as string | null) ?? null,
      endFence: (s.end_fence as string | null) ?? null,
      autoOut: !!s.auto_clocked_out,
      startedAt: String(s.started_at), endedAt: (s.ended_at as string | null) ?? null,
      signedOffAt: (s.signed_off_at as string | null) ?? null,
      breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
        .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
    };
  });

  // A byte-order mark, or Excel on Windows reads "–" as three letters of junk.
  const csv = "﻿" + payrollCsv(shifts, new Date(), { offsetMinutes: offset });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="timesheet-week-of-${week}.csv"`,
      "cache-control": "no-store",
    },
  });
}
