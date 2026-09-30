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

  for (const p of props) {
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

  return NextResponse.json({
    signedIn: true,
    parks: [...parks.entries()].map(([name, p]) => ({
      name, label: p.label, id: p.id, lots: p.total, runsOn: runsOn.get(name) ?? null,
    })),
    moves,
  });
}
