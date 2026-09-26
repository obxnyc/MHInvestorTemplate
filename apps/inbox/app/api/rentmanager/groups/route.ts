import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rmAuthorize } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type Role = "park" | "llc" | "managed" | "ignore" | "unset";

/**
 * Every Rent Manager group, and what each one actually is.
 *
 * Groups are not one kind of thing. "Pines Mobile Home Park" is a park.
 * "Musgrove Holdings" is a company. "Dutch Doors" is a management book.
 * "Non-Musgrove" is a reporting filter -- a complement, which also means a
 * property can sit in several groups at once. Nothing in the data
 * distinguishes them, and nothing ever will: the difference lives in the
 * head of the person who set them up.
 *
 * So they are listed, and he says. Once.
 */
export async function GET() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return NextResponse.json({ signedIn: false, groups: [] });
  }

  // Counted from the properties rather than read from a groups endpoint, so
  // the number beside each name is how many properties would actually move
  // if it were called a park -- which is the number worth seeing.
  const counts = new Map<string, number>();
  for (let p = 1; p <= 40; p++) {
    const res = await fetch(
      `${auth.session.base}/Properties?embeds=PropertyGroups&pagesize=250&pagenumber=${p}`,
      {
        headers: { [auth.session.header]: auth.session.token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) break;
    const batch = await res.json() as {
      PropertyGroups?: { Name?: string }[];
    }[];
    for (const prop of batch) {
      for (const g of prop.PropertyGroups ?? []) {
        const name = (g.Name ?? "").trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    if (batch.length < 250) break;
  }

  const db = supabaseAdmin();
  // Remembered across runs, and new groups appear as "unset" rather than
  // quietly defaulting to something.
  for (const name of counts.keys()) {
    await db.from("rm_groups")
      .upsert({ name, seen_at: new Date().toISOString() }, { onConflict: "name" });
  }

  const { data, error } = await db.from("rm_groups")
    .select("id, name, role, decided_at").order("name");
  if (error) {
    return NextResponse.json({
      signedIn: true, pending: true,
      hint: "Run migration 020 — there is nowhere to record what each group is.",
      groups: [],
    });
  }

  return NextResponse.json({
    signedIn: true,
    groups: (data ?? []).map((g) => ({
      id: g.id, name: g.name, role: g.role as Role,
      properties: counts.get(g.name) ?? 0,
      decided: Boolean(g.decided_at),
    })),
  });
}

/** What he says each one is. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id, role } = await req.json().catch(() => ({}));
  const allowed = ["park", "llc", "managed", "ignore", "unset"];
  if (!id || !allowed.includes(String(role))) {
    return NextResponse.json({ error: "unknown role" }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from("rm_groups").update({
    role,
    decided_at: role === "unset" ? null : new Date().toISOString(),
    decided_by: role === "unset" ? null : me.id,
  }).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
