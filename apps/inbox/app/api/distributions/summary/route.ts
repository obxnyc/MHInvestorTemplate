import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { build } from "@/lib/distribution-data";
import { summarize, monthsBetween, rangeLabel, summaryRangeRows } from "@/lib/distribute";
import { workbook } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner distributions over a range of months -- year to date, a past year,
 * or any from/to -- added up per property and per house. `format=xlsx`
 * gives the same table as an Excel file; `owner=` narrows it to one owner,
 * for sending them their own year.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "", to = q.get("to") ?? "";
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "Pick a start month on or before the end month." }, { status: 400 });
  }
  const months = monthsBetween(from, to);
  if (months.length > 60) return NextResponse.json({ error: "Five years at most at a time." }, { status: 400 });
  const data = await Promise.all(months.map((m) => build(m)));
  const failed = data.find((d) => "error" in d && d.error);
  if (failed && "error" in failed) return NextResponse.json({ error: failed.error }, { status: 500 });
  let rows = summarize(data.map((d, i) => ({ month: months[i], statements: d.statements ?? [] })));
  const owner = q.get("owner");
  if (owner) rows = rows.filter((r) => r.owner === owner);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const label = rangeLabel(from, to, today);
  // Which months in the range have anything at all, so the screen can say so rather than show a short year as a full one.
  const withData = months.filter((m, i) => (data[i].statements ?? []).some((s) => s.lines.length));

  if (q.get("format") === "xlsx") {
    const file = `${owner ? `${owner} - ` : ""}Owner distributions ${label}.xlsx`.replace(/[^\w .,()&'–-]/g, "");
    return new NextResponse(Buffer.from(workbook([{ name: label, rows: summaryRangeRows(label, rows), widths: [28, 34, 14, 8, 14, 14, 14, 14] }])), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.json({ from, to, label, months, withData, rows });
}
