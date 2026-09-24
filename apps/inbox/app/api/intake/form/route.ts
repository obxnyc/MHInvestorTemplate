import { NextResponse } from "next/server";
import { ingest } from "@/lib/intake";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your own website's contact / interest form posts here.
 *
 * CORS is deliberately open for POST because the form lives on a different
 * origin. That makes this endpoint publicly writable, so it is rate-limited by
 * the honeypot below and should stay low-trust: it can only ever create a
 * conversation, never read one.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400, headers: cors() });

  // Hidden field no human fills in. Bots fill everything.
  if (body.company) return NextResponse.json({ ok: true }, { headers: cors() });

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!phone && !email) {
    return NextResponse.json({ error: "phone or email required" }, { status: 400, headers: cors() });
  }

  const lines = [
    name && `Name: ${name}`,
    phone && `Phone: ${phone}`,
    email && `Email: ${email}`,
    body.property && `Property: ${body.property}`,
    body.bedrooms && `Bedrooms: ${body.bedrooms}`,
    body.move_in && `Move-in: ${body.move_in}`,
    message && `\n${message}`,
  ].filter(Boolean).join("\n");

  const result = await ingest({
    source: "website",
    name: name || null,
    phone: phone || null,
    email: email || null,
    summary: message || `Website enquiry from ${name || phone || email}`,
    raw: lines,
    category: "prospect",
    externalId: `web:${randomUUID()}`,
  });

  return NextResponse.json({ ok: result.ok }, { headers: cors() });
}

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": process.env.WEBSITE_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
