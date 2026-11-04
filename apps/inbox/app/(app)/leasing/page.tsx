import { canSeeOffice } from "@/lib/roles";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";
import LeasingBoard, { type Looking, type EmptyLot } from "@/components/LeasingBoard";
import type { ShowingRow } from "@/components/ShowingsList";
import type { ListingDraft } from "@/components/ListingEditor";
import { loadHours } from "@/lib/pipeline";
import { splitAddress } from "@/lib/zillow-feed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Looking for a home — Larabee Homes" };

/**
 * Everybody who is looking, and the empty lots they might fit.
 *
 * The record behind this screen is `inquiries`, which has been in the schema
 * since the first migration with nothing writing to it -- so until 037 there
 * is nothing here, and the screen says that rather than looking broken.
 */
export default async function Leasing() {
  const me = await requireStaff();
  if (!me || !canSeeOffice(me.role)) redirect("/");

  const db = supabaseAdmin();

  // Two tiers. `read`, `unit_id` and `owner_id` arrive with 037; without them
  // the screen still lists who is looking and what they asked for, which is
  // the part that matters, rather than failing the query and showing nothing.
  const HEAD = "id, inquired_at, source, bedrooms_min, price_ceiling, area, has_pets,"
    + " move_in_from, outcome, contact_id, conversation_id,"
    + " contacts(full_name, phone, email)";
  let rows: unknown[] | null = null;
  let full = false;
  for (const [i, sel] of [`${HEAD}, read, unit_id, owner_id, stage, stage_at, prescreen_token`,
                          `${HEAD}, read, unit_id, owner_id`, HEAD].entries()) {
    const got = await db.from("inquiries").select(sel)
      .eq("outcome", "open").order("inquired_at", { ascending: false }).limit(200);
    if (!got.error) { rows = got.data as unknown[]; full = i === 0; break; }
  }

  // The lots to match against, with the clock, if there is one.
  const LOTS = "id, label, monthly_rent, bedrooms, bathrooms, square_feet, available_on,"
    + " properties(name, address)";
  let lotRows: unknown[] | null = null;
  let clock = false;
  for (const [i, sel] of [`${LOTS}, vacant_since, vacant_since_estimated, blocker`, LOTS].entries()) {
    const got = await db.from("units").select(sel).eq("is_vacant", true).limit(500);
    if (!got.error) { lotRows = got.data as unknown[]; clock = i === 0; break; }
  }

  // What the pipeline has planned and done for each person, the showings on
  // the calendar, the listings, and the showing hours. Every one of these
  // arrives with 051; before it, each comes back empty and the screen says
  // so once, rather than failing.
  const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
  const [fu, sh, li] = await Promise.all([
    ids.length
      ? db.from("lead_followups").select("inquiry_id, kind, due_at, state, skipped_reason, sent_at, channel")
          .in("inquiry_id", ids).order("due_at")
      : Promise.resolve({ data: [], error: null }),
    db.from("showings")
      .select("id, scheduled_for, status, inquiry_id, unit_id, contacts(full_name, phone), units(label, properties(name))")
      .gte("scheduled_for", new Date(Date.now() - 3 * 864e5).toISOString())
      .order("scheduled_for").limit(200),
    db.from("listings").select("*"),
  ]);
  const pipeline = !sh.error && !li.error && !fu.error;
  const { hours, rules } = await loadHours(db);

  type Row = Record<string, unknown>;
  const looking: Looking[] = ((rows ?? []) as Row[]).map((r) => {
    const c = r.contacts as { full_name: string | null; phone: string | null;
                              email: string | null } | null;
    return {
      id: String(r.id),
      inquiredAt: String(r.inquired_at),
      source: (r.source as string | null) ?? null,
      name: c?.full_name ?? null,
      // A contact that arrived email-first is keyed on "email:<address>" until
      // somebody gives a number. That is a key, not a phone number -- shown in
      // the phone's place it reads as one, and a tel: link to it rings nobody.
      phone: c?.phone && !c.phone.startsWith("email:") ? c.phone : null,
      email: c?.email ?? null,
      conversationId: (r.conversation_id as string | null) ?? null,
      wanted: {
        bedroomsMin: (r.bedrooms_min as number | null) ?? undefined,
        priceCeiling: r.price_ceiling === null || r.price_ceiling === undefined
          ? undefined : Number(r.price_ceiling),
        area: (r.area as string | null) ?? undefined,
        // Written out rather than `?? undefined`, so a stored false stays a
        // stated no instead of turning back into "nobody asked".
        hasPets: r.has_pets === null || r.has_pets === undefined
          ? undefined : Boolean(r.has_pets),
        moveInFrom: (r.move_in_from as string | null) ?? undefined,
      },
      read: (r.read ?? {}) as Looking["read"],
      stage: (r.stage as string | undefined) ?? "new",
      stageAt: (r.stage_at as string | undefined) ?? String(r.inquired_at),
      unitId: (r.unit_id as string | null) ?? null,
      followups: ((fu.data ?? []) as Row[]).filter((f) => f.inquiry_id === r.id).map((f) => ({
        kind: String(f.kind), dueAt: String(f.due_at), state: String(f.state),
        reason: (f.skipped_reason as string | null) ?? null, channel: (f.channel as string | null) ?? null,
      })),
    };
  });

  const lots: EmptyLot[] = ((lotRows ?? []) as Row[]).map((u) => {
    const p = u.properties as { name: string; address: string | null } | null;
    return {
      id: String(u.id),
      label: String(u.label),
      property: p?.name ?? "—",
      rent: u.monthly_rent === null || u.monthly_rent === undefined
        ? null : Number(u.monthly_rent),
      bedrooms: (u.bedrooms as number | null) ?? null,
      area: p?.address ?? null,
      availableOn: (u.available_on as string | null) ?? null,
      vacantSince: (u.vacant_since as string | null) ?? null,
      vacantSinceEstimated: Boolean(u.vacant_since_estimated),
      blocker: (u.blocker as string | null) ?? null,
    };
  });

  const showings: ShowingRow[] = ((sh.data ?? []) as unknown as Row[]).map((x) => {
    const c = x.contacts as { full_name: string | null; phone: string | null } | null;
    const u = x.units as { label: string; properties: { name: string } | null } | null;
    return {
      id: String(x.id), at: String(x.scheduled_for), status: String(x.status ?? "booked"),
      who: c?.full_name ?? c?.phone ?? "Somebody",
      phone: c?.phone && !c.phone.startsWith("email:") ? c.phone : null,
      home: u ? `${u.properties?.name ?? ""} ${u.label}`.trim() : "Home not chosen",
    };
  });

  const listings: Record<string, ListingDraft> = {};
  for (const l of ((li.data ?? []) as Row[])) {
    listings[String(l.unit_id)] = {
      onZillow: !!l.on_zillow, listedAt: (l.listed_at as string | null) ?? null,
      headline: (l.headline as string | null) ?? "", description: (l.description as string | null) ?? "",
      street: (l.street as string | null) ?? "", city: (l.city as string | null) ?? "",
      state: (l.state as string | null) ?? "NC", zip: (l.zip as string | null) ?? "",
      deposit: l.deposit === null || l.deposit === undefined ? "" : String(l.deposit),
      pets: (l.pets as ListingDraft["pets"]) ?? "ask",
      leaseMonths: l.lease_months === null || l.lease_months === undefined ? "" : String(l.lease_months),
      photos: (l.photos as string[] | null) ?? [],
    };
  }
  // A lot with no listing yet gets one drafted from what is on file, for a
  // person to check -- the address split is a guess and is shown as one.
  const drafts: Record<string, ListingDraft> = {};
  for (const u of ((lotRows ?? []) as Row[])) {
    const id = String(u.id);
    if (listings[id]) continue;
    const p = u.properties as { name: string; address: string | null } | null;
    const a = splitAddress(p?.address);
    drafts[id] = {
      onZillow: false, listedAt: null, headline: "", description: "",
      street: a.street ? `${a.street}${u.label ? ` Lot ${String(u.label).replace(/^(lot\s*|#)/i, "")}` : ""}` : "",
      city: a.city, state: a.state || "NC", zip: a.zip,
      deposit: "", pets: "ask", leaseMonths: "12", photos: [],
    };
  }

  const unitFacts: Record<string, { bedrooms: string; bathrooms: string; rent: string; squareFeet: string }> = {};
  for (const u of ((lotRows ?? []) as Row[])) {
    const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
    unitFacts[String(u.id)] = { bedrooms: v(u.bedrooms), bathrooms: v(u.bathrooms),
                                rent: v(u.monthly_rent), squareFeet: v(u.square_feet) };
  }

  const site = (process.env.PUBLIC_BASE_URL || "https://mh-investor-template.vercel.app").replace(/\/+$/, "");

  return <LeasingBoard looking={looking} lots={lots} full={full} clock={clock}
                       canEdit={me.role === "admin" || me.role === "office"}
                       pipeline={pipeline} showings={showings}
                       listings={{ ...drafts, ...listings }} unitFacts={unitFacts}
                       hours={hours} rules={rules}
                       feedUrl={`${site}/api/feeds/zillow`} />;
}
