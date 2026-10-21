import { NextResponse } from "next/server";
import { ingest } from "@/lib/intake";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A tenant reporting a repair, on our own form rather than Rent Manager's.
 *
 * Deliberately NOT `/api/intake/form`, which hardcodes `category: "prospect"`
 * -- a repair posted there becomes a leasing enquiry, and now also opens an
 * inquiry record, which is three wrong things from one reused endpoint.
 *
 * `category: "maintenance"` is what makes `ingest` open a work order rather
 * than only a thread. That is the right rule here for the same reason it is
 * right for Rent Manager's portal: somebody filled in a box headed "what is
 * wrong" on a page whose entire purpose is reporting a repair. It is not a
 * conversation, and making the office retype it into a ticket is asking a
 * person to do the computer's job.
 *
 * Public and writable, like the other intake routes, so it stays low-trust:
 * it can create a conversation and never read one.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400, headers: cors() });
  if (body.company) return NextResponse.json({ ok: true }, { headers: cors() }); // honeypot

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim();
  const property = String(body.property ?? "").trim();
  const lot = String(body.lot ?? "").trim();
  const problem = String(body.problem ?? "").trim();
  const entry = String(body.entry ?? "").trim();

  if (!phone && !email) {
    return NextResponse.json(
      { error: "We need a phone number or an email so we can reach you." },
      { status: 400, headers: cors() });
  }
  if (problem.length < 5) {
    return NextResponse.json(
      { error: "Please say what is wrong." }, { status: 400, headers: cors() });
  }

  // Both halves, in the shape `unitFromHint` reads: the lot number AND the
  // property, because lot 51 exists in more than one park and filing a leak
  // against the wrong one is worse than filing it against none.
  const where = [property, lot && `#${lot}`].filter(Boolean).join(" ");

  const lines = [
    name && `Name: ${name}`,
    phone && `Phone: ${phone}`,
    email && `Email: ${email}`,
    where && `Where: ${where}`,
    entry && `Entry: ${entry}`,
    `\n${problem}`,
  ].filter(Boolean).join("\n");

  const result = await ingest({
    source: "website",
    name: name || null,
    phone: phone || null,
    email: email || null,
    // What the office sees first, and what the work order is headed with.
    summary: problem.slice(0, 120),
    raw: lines,
    category: "maintenance",
    unitHint: where || null,
    externalId: `report:${randomUUID()}`,
  });

  return NextResponse.json({ ok: result.ok, jobOpened: !!result.workOrderId },
    { headers: cors() });
}

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": process.env.WEBSITE_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
