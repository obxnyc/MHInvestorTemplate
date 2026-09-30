import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rmAuthorize, type RmSession } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Lots filed in the wrong place, and where they belong.
 *
 * Two faults, both of them ordinary and both invisible once imported. A lot
 * that is in no park group at all becomes a house standing on its own. A lot
 * in the wrong park simply sits in the wrong park for ever. Neither is a
 * mistake in the mapping -- both are true of Rent Manager, and both get worse
 * as the parks fill.
 *
 * Which park a lot belongs to is decided by its street number against the
 * numbers already in each park, because that is the only evidence there is
 * and it happens to be conclusive: sixty-three lots beginning 1140 and one
 * beginning 1148, next door to a park whose lots all begin 1148.
 *
 * It proposes and never acts. The moves come back with names on them so a
 * person can read them before anything is written.
 */

type Prop = {
  PropertyID: number; Name?: string; IsActive?: boolean;
  PropertyGroups?: { PropertyGroupID?: number; Name?: string }[];
};

const leadingNumber = (s: string) => (s.trim().match(/^(\d{2,6})\b/) ?? [])[1] ?? null;
const looksLikeALot = (s: string) => /\blot\b\s*#?\s*\w/i.test(s);

async function everyProperty(session: RmSession): Promise<Prop[]> {
  const all: Prop[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${session.base}/Properties?embeds=PropertyGroups&pagesize=250&pagenumber=${page}`,
      { headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) break;
    const batch = await res.json() as Prop[];
    all.push(...batch);
    if (batch.length < 250) break;
  }
  return all;
}

/**
 * Record where a lot sits, here.
 *
 * Nothing goes to Rent Manager. A filing that looks like an oversight is
 * sometimes a decision whose reason has been forgotten, and writing into
 * somebody's book of record on the strength of a street number is not a
 * thing to do while that is an open question. Every row is reversible and
 * carries what Rent Manager said at the time, so a later change over there
 * is visible rather than silently overridden for ever.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { place, undo } = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (Array.isArray(undo) && undo.length) {
    const ids = undo.map(Number).filter(Number.isFinite);
    const { error } = await db.from("rm_placements").delete().in("rm_property_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, removed: ids.length });
  }

  if (!Array.isArray(place) || !place.length) {
    return NextResponse.json({ error: "nothing to place" }, { status: 400 });
  }

  const rows = (place as {
    property: number; intoName: string | null; why?: string; wasIn?: string | null;
  }[]).map((m) => ({
    rm_property_id: Number(m.property),
    park_group: m.intoName ?? null,
    why: (m.why ?? "").slice(0, 300) || null,
    was_in: m.wasIn ?? null,
    placed_at: new Date().toISOString(),
    placed_by: me.id,
  })).filter((r) => Number.isFinite(r.rm_property_id));

  const { error } = await db.from("rm_placements")
    .upsert(rows, { onConflict: "rm_property_id" });
  if (error) {
    return NextResponse.json({
      error: /rm_placements/.test(error.message)
        ? "Run migration 023 — there is nowhere to record a placement yet."
        : error.message,
    }, { status: 400 });
  }
  return NextResponse.json({ ok: true, placed: rows.length });
}

export async function GET() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const auth = await rmAuthorize();
  if (!auth.ok) return NextResponse.json({ signedIn: false, moves: [] });

  // Which groups somebody has called a park. A group nobody has judged takes
  // no part in this: guessing which pile to move a lot onto is worse than
  // leaving it where it is.
  const { data: rows } = await supabaseAdmin().from("rm_groups")
    .select("name, role, local_name").eq("role", "park");
  const parkNames = new Map<string, string>();
  for (const r of rows ?? []) {
    parkNames.set(String(r.name), (r.local_name as string | null) ?? String(r.name));
  }
  if (!parkNames.size) {
    return NextResponse.json({
      signedIn: true, moves: [],
      hint: "No group is marked as a park yet, so there is nothing to file anything into.",
    });
  }

  const props = (await everyProperty(auth.session)).filter((p) => p.IsActive !== false);

  // Decisions already made here. They win over Rent Manager and are not
  // proposed again.
  const { data: already } = await supabaseAdmin().from("rm_placements")
    .select("rm_property_id, park_group, why, was_in, placed_at");

  // What street number each park runs on, taken from the lots already in it.
  const parks = new Map<string, {
    id: number | null; label: string; numbers: Map<string, number>; total: number;
  }>();
  for (const p of props) {
    for (const g of p.PropertyGroups ?? []) {
      const name = (g.Name ?? "").trim();
      if (!parkNames.has(name)) continue;
      const park = parks.get(name) ?? {
        id: g.PropertyGroupID ?? null, label: parkNames.get(name)!,
        numbers: new Map<string, number>(), total: 0,
      };
      if (park.id === null && g.PropertyGroupID) park.id = g.PropertyGroupID;
      const n = leadingNumber(p.Name ?? "");
      if (n) park.numbers.set(n, (park.numbers.get(n) ?? 0) + 1);
      park.total++;
      parks.set(name, park);
    }
  }

  /** The number a park runs on, only when it clearly runs on one. A park
   *  addressed by internal street names has none, and nothing is proposed
   *  for or against it. */
  const runsOn = new Map<string, string>();
  for (const [name, park] of parks) {
    const top = [...park.numbers.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= park.total * 0.6) runsOn.set(name, top[0]);
  }
  const parkFor = (n: string) =>
    [...runsOn.entries()].find(([, number]) => number === n)?.[0] ?? null;

  type Suggestion = {
    property: number; propertyName: string;
    into: number | null; intoName: string; intoLabel: string;
    outOf: number | null; outOfName: string | null;
    why: string;
  };
  const moves: Suggestion[] = [];
  const decided = new Set((already ?? []).map((r) => Number(r.rm_property_id)));

  for (const p of props) {
    if (decided.has(p.PropertyID)) continue;
    const name = (p.Name ?? "").trim();
    const groups = (p.PropertyGroups ?? []).map((g) => (g.Name ?? "").trim());
    const inPark = groups.find((g) => parkNames.has(g)) ?? null;
    const n = leadingNumber(name);
    if (!n) continue;
    const belongs = parkFor(n);
    if (!belongs) continue;

    if (!inPark && looksLikeALot(name)) {
      const park = parks.get(belongs)!;
      moves.push({
        property: p.PropertyID, propertyName: name,
        into: park.id, intoName: belongs, intoLabel: park.label,
        outOf: null, outOfName: null,
        why: `is a lot in no park, and ${belongs} runs on ${n}`,
      });
    } else if (inPark && inPark !== belongs) {
      const park = parks.get(belongs)!;
      const from = (p.PropertyGroups ?? []).find((g) => (g.Name ?? "").trim() === inPark);
      moves.push({
        property: p.PropertyID, propertyName: name,
        into: park.id, intoName: belongs, intoLabel: park.label,
        outOf: from?.PropertyGroupID ?? null, outOfName: inPark,
        why: `is addressed ${n}, which is ${belongs}, but sits in ${inPark}`,
      });
    }
  }

  const byId = new Map<number, string>();
  for (const p of props) byId.set(p.PropertyID, (p.Name ?? "").trim());

  return NextResponse.json({
    signedIn: true,
    // Only the ones still standing. A placement whose property has gone from
    // Rent Manager is noise.
    placed: (already ?? [])
      .filter((r) => byId.has(Number(r.rm_property_id)))
      .map((r) => ({
        property: Number(r.rm_property_id),
        propertyName: byId.get(Number(r.rm_property_id))!,
        intoName: (r.park_group as string | null) ?? null,
        why: (r.why as string | null) ?? null,
        wasIn: (r.was_in as string | null) ?? null,
      })),
    parks: [...parks.entries()].map(([name, p]) => ({
      name, label: p.label, id: p.id, lots: p.total, runsOn: runsOn.get(name) ?? null,
    })),
    moves,
  });
}
