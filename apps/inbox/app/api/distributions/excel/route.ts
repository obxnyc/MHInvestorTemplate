import { NextResponse } from "next/server";
import { build } from "@/lib/distribution-data";
import { statementRows, summaryRows, placeOf, entityOf, monthLabel } from "@/lib/distribute";
import { excelLinkOk } from "@/lib/statement-link";
import { workbook, type Sheet } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Download for Excel" from an owner's email. No sign-in: the owner has no
 * account here. The signed link is the permission, and it covers exactly the
 * statements it names -- see lib/statement-link.ts.
 *
 * What it serves is what the email was built from: an emailed statement's
 * lines are the frozen ones that were sent.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const month = q.get("m") ?? "";
  const ids = (q.get("s") ?? "").split(",").filter(Boolean);
  if (!/^\d{4}-\d{2}$/.test(month) || !excelLinkOk(month, ids, q.get("t") ?? "")) {
    return new NextResponse("This link is not valid. Reply to the statement email and we will send it again.", { status: 403 });
  }
  const data = await build(month);
  const list = (data.statements ?? []).filter((s) => ids.includes(s.id));
  if (!list.length) return new NextResponse("That statement is no longer on file. Reply to the statement email and we will send it again.", { status: 404 });

  const inputs = list.map((s) => ({ month: `${month}-01`, payee: s.payee, title: s.title, lines: s.lines, note: s.note, payments: s.payments,
    previousOwedCents: s.previousOwedCents, priorPaidCents: s.priorPaidCents, priorPaidOn: s.priorPaidOn, depositsCents: s.depositsCents,
    reserveHeldCents: s.reserveHeldCents, reservePendingCents: s.reservePendingCents, reserveRequiredCents: s.reserveRequiredCents }));
  const entity = entityOf({ entity: list[0].entity, payee: list[0].payee });
  const widths = [10, 22, 48, 14];
  const sheets: Sheet[] = [
    ...(inputs.length > 1 ? [{ name: "Summary", rows: summaryRows(`${month}-01`, entity, inputs), widths: [48, 16] }] : []),
    ...inputs.map((s) => ({ name: placeOf(s.title, s.payee, s.lines), rows: statementRows(s), widths })),
  ];
  const file = `${entity} - ${monthLabel(`${month}-01`)} Owner Distribution.xlsx`.replace(/[^\w .,()&'-]/g, "");
  return new NextResponse(Buffer.from(workbook(sheets)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
