import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { runSetupChecks } from "@/lib/setup-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same checks as /setup, as JSON.
 *
 *  Not a duplicate: a server component that throws in production renders as an
 *  opaque digest with the message stripped, which is precisely the wrong
 *  failure mode for a diagnostic. This route controls its own response body, so
 *  even a crash comes back as a sentence someone can act on. */
export async function GET(req: Request) {
  const staff = await requireStaff();
  if (staff?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";

  try {
    return NextResponse.json({
      checks: await runSetupChecks(`${proto}://${host}`, await supabaseServer()),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "the setup check itself failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
