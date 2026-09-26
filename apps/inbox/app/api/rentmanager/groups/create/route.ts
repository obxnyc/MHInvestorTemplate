import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { rmAuthorize, rmGet, rmPost, type RmWrite } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RmAddress = { Street?: string; City?: string; State?: string; PostalCode?: string;
                   IsPrimary?: boolean };
type RmProperty = {
  PropertyID: number; Name?: string; ShortName?: string; IsActive?: boolean;
  Addresses?: RmAddress[];
  PropertyGroups?: { Name?: string }[];
};

function lineOf(a: RmAddress | undefined) {
  if (!a) return "";
  return [a.Street, a.City, a.State, a.PostalCode].filter(Boolean).join(", ");
}

/**
 * Make a property group in Rent Manager, with its members in it.
 *
 * The probe settled the rule: "You cannot create an empty Property Group."
 * Name and members go in one call or not at all -- which is a good rule,
 * because it makes the half-finished state impossible.
 *
 * What it does NOT settle is the spelling of the members in the payload, and
 * that is not documented anywhere reachable. So the same discipline as
 * everywhere else: try the plausible shapes in order, stop at the first that
 * works, and report every attempt. Safe to do exactly because of the rule
 * above -- a refused create leaves nothing behind, as the probe demonstrated
 * twice.
 *
 * Searching is by address text and is deliberately dumb. The lots of a park
 * under redevelopment are "the ones on Lady Cheryl and Lady Viola", which is
 * how a person holds it, and matching that literally is more honest than
 * inferring a park from a naming convention that does not exist.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { search, name, propertyIds, go } = await req.json().catch(() => ({}));
  const auth = await rmAuthorize();
  if (!auth.ok) return NextResponse.json({ signedIn: false });
  const session = auth.session;

  // Everything, then filtered here. Two hundred and fifty-nine properties is
  // one round trip, and their filter syntax is one more thing that would
  // have to be discovered to save it.
  const found: RmProperty[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${session.base}/Properties?embeds=Addresses,PropertyGroups&pagesize=250&pagenumber=${page}`,
      { headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) break;
    const batch = await res.json() as RmProperty[];
    found.push(...batch);
    if (batch.length < 250) break;
  }

  // Comma or newline separated, so "Lady Cheryl, Lady Viola" works the way
  // somebody would type it.
  const terms = String(search ?? "").split(/[,\n]+/)
    .map((t) => t.trim().toLowerCase()).filter(Boolean);

  const matches = found
    .filter((p) => p.IsActive !== false)
    .map((p) => {
      const primary = (p.Addresses ?? []).find((a) => a.IsPrimary) ?? (p.Addresses ?? [])[0];
      return {
        id: p.PropertyID,
        code: (p.ShortName ?? "").trim(),
        name: (p.Name ?? "").trim(),
        address: lineOf(primary),
        groups: (p.PropertyGroups ?? []).map((g) => (g.Name ?? "").trim()).filter(Boolean),
      };
    })
    .filter((p) => !terms.length
      || terms.some((t) => `${p.name} ${p.address} ${p.code}`.toLowerCase().includes(t)));

  const chosen: number[] = Array.isArray(propertyIds)
    ? propertyIds.map(Number).filter(Number.isFinite) : [];

  if (go !== true) {
    return NextResponse.json({ signedIn: true, dryRun: true, matches });
  }

  const label = String(name ?? "").trim();
  if (label.length < 2) {
    return NextResponse.json({ error: "Give the group a name." }, { status: 400 });
  }
  if (!chosen.length) {
    return NextResponse.json({
      error: "Rent Manager will not create an empty group. Pick the properties first.",
    }, { status: 400 });
  }

  // What an existing group's members look like, so the payload mirrors real
  // data rather than a guess about it.
  const sample = await rmGet("/PropertyGroups?pagesize=1&embeds=Properties", session);

  const shapes: [string, unknown][] = [
    ["Properties as objects", { Name: label, Properties: chosen.map((id) => ({ PropertyID: id })) }],
    ["Properties as ids", { Name: label, Properties: chosen }],
    ["PropertyIDs", { Name: label, PropertyIDs: chosen }],
  ];

  const tried: (RmWrite & { shape: string })[] = [];
  let made: RmWrite | null = null;
  for (const [shape, payload] of shapes) {
    const out = await rmPost("/PropertyGroups", session, payload);
    tried.push({ ...out, shape });
    // A refusal creates nothing -- that is the rule the probe established --
    // so trying the next spelling cannot leave a trail of empty groups.
    if (out.ok) { made = out; break; }
  }

  return NextResponse.json({
    signedIn: true, dryRun: false,
    created: Boolean(made),
    id: made?.id ?? null,
    name: label,
    count: chosen.length,
    memberShape: sample.shape,
    tried,
  });
}
