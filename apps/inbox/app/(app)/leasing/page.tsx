import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";
import LeasingBoard, { type Looking, type EmptyLot } from "@/components/LeasingBoard";

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
  if (me?.role !== "admin" && me?.role !== "office") redirect("/");

  const db = supabaseAdmin();

  // Two tiers. `read`, `unit_id` and `owner_id` arrive with 037; without them
  // the screen still lists who is looking and what they asked for, which is
  // the part that matters, rather than failing the query and showing nothing.
  const HEAD = "id, inquired_at, source, bedrooms_min, price_ceiling, area, has_pets,"
    + " move_in_from, outcome, contact_id, conversation_id,"
    + " contacts(full_name, phone, email)";
  let rows: unknown[] | null = null;
  let full = false;
  for (const [i, sel] of [`${HEAD}, read, unit_id, owner_id`, HEAD].entries()) {
    const got = await db.from("inquiries").select(sel)
      .eq("outcome", "open").order("inquired_at", { ascending: false }).limit(200);
    if (!got.error) { rows = got.data as unknown[]; full = i === 0; break; }
  }

  // The lots to match against, with the clock, if there is one.
  const LOTS = "id, label, monthly_rent, bedrooms, available_on, properties(name, address)";
  let lotRows: unknown[] | null = null;
  let clock = false;
  for (const [i, sel] of [`${LOTS}, vacant_since, vacant_since_estimated, blocker`, LOTS].entries()) {
    const got = await db.from("units").select(sel).eq("is_vacant", true).limit(500);
    if (!got.error) { lotRows = got.data as unknown[]; clock = i === 0; break; }
  }

  type Row = Record<string, unknown>;
  const looking: Looking[] = ((rows ?? []) as Row[]).map((r) => {
    const c = r.contacts as { full_name: string | null; phone: string | null;
                              email: string | null } | null;
    return {
      id: String(r.id),
      inquiredAt: String(r.inquired_at),
      source: (r.source as string | null) ?? null,
      name: c?.full_name ?? null,
      phone: c?.phone ?? null,
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

  return <LeasingBoard looking={looking} lots={lots} full={full} clock={clock}
                       canEdit={me.role === "admin" || me.role === "office"} />;
}
