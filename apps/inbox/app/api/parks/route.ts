import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every NC park owner (migration 069) with where each one stands in the
 *  outreach pipeline (070).
 *
 *  All of it in one reply, about 3,600 owners, because filtering a list
 *  somebody is working through should not be a round trip per keystroke.
 *
 *  PostgREST stops at 1,000 rows a request whatever is asked for, so the
 *  owners are read a page at a time. Read in one go, the list would
 *  have silently been the first thousand, which looks exactly like a
 *  complete list. */

const OWNER_COLS =
  "key, owner, owner2, mail_address, mail_city, mail_state, mail_zip, parcels, acres, " +
  "assessed_value, counties, sites, strong, by_use, by_owner, by_legal, by_subdiv, " +
  "out_of_state, earliest_sale, lat, lon";

export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(me.role)) return NextResponse.json({ error: "office and admin only" }, { status: 403 });

  const db = await supabaseServer();

  const owners: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mhp_owners").select(OWNER_COLS)
      .order("acres", { ascending: false }).order("key").range(from, from + 999);
    if (error) {
      return NextResponse.json({
        error: /key/.test(error.message)
          ? "Migration 070 has not been applied yet, so owners have no key to file a lead against."
          : `Could not read the park owners: ${error.message}`,
      }, { status: 500 });
    }
    owners.push(...(data ?? []) as unknown as Record<string, unknown>[]);
    if (!data || data.length < 1000) break;
  }

  const leads: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mhp_leads")
      .select("owner_key, stage, starred, next_touch, phone, email, notes, updated_at")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: `Could not read the pipeline: ${error.message}` }, { status: 500 });
    leads.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // The latest touch per owner, so the list can say "called 3 days ago".
  const last: Record<string, { kind: string; at: string }> = {};
  const counts: Record<string, number> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mhp_touches").select("owner_key, kind, at")
      .order("at", { ascending: false }).range(from, from + 999);
    if (error) return NextResponse.json({ error: `Could not read the touch history: ${error.message}` }, { status: 500 });
    for (const t of data ?? []) {
      counts[t.owner_key] = (counts[t.owner_key] ?? 0) + 1;
      if (!last[t.owner_key]) last[t.owner_key] = { kind: t.kind, at: t.at };
    }
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ owners, leads, last, counts });
}
