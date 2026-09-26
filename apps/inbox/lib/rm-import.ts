import { supabaseAdmin } from "@/lib/supabase-admin";
import { rmAuthorize, type RmSession } from "@/lib/rentmanager";
import type { Kind } from "@/lib/property";
import { KINDS } from "@/lib/property";

/**
 * Bringing the portfolio across from Rent Manager.
 *
 * Rent Manager is the book of record and this is a mirror of it. Nothing is
 * written back, and nothing here invents a fact: a property with no address
 * in Rent Manager arrives with no address, and is listed as something to go
 * and fix over there rather than quietly filled in over here.
 *
 * What the probe turned up, and why the calls look the way they do:
 *
 *  - Bedrooms, bathrooms and square footage are NOT on /Units. They are on
 *    the Unit records embedded inside /Properties?embeds=Units, which return
 *    a fuller record than the list endpoint does. So the units come down
 *    inside their property rather than on their own.
 *  - Rent is separate again: MarketRent embeds onto /Units but not onto the
 *    embedded copies, so it takes a second pass joined on UnitID.
 *  - Vacancy is not a flag on a unit. It is Property.VacantUnitIDs, a list.
 *  - The LLC is Property.PrimaryOwner, which matches the owners table that
 *    already existed here for exactly this purpose.
 */

/** One page at a time. Rent Manager pages everything and a portfolio of a
 *  few hundred units is several round trips however it is asked for. */
const PAGE = 250;

export type Note = string;
export type Tally = { seen: number; written: number };

/** One line per property, so a rehearsal can be READ rather than trusted.
 *  A total is not a check: "259 properties" looks the same whether the
 *  mapping is right or catastrophically wrong, and the only way to know
 *  which is to look at the rows and recognise them. */
export type Row = {
  code: string;
  name: string;
  kind: Kind;
  units: number;
  unitNames: string[];
  vacant: number;
  owner: string | null;
  address: string | null;
  existing: boolean;
};

export type Outcome = {
  ok: boolean;
  dryRun: boolean;
  owners: Tally;
  properties: Tally;
  units: Tally;
  notes: Note[];
  /** Only on a rehearsal. */
  preview?: Row[];
  error?: string;
};

type RmOwner = { OwnerID: number; Name?: string; DisplayName?: string };
type RmAddress = {
  Street?: string; City?: string; State?: string; PostalCode?: string;
  IsPrimary?: boolean;
};
type RmUnit = {
  UnitID: number; PropertyID: number; Name?: string;
  Bedrooms?: number | null; Bathrooms?: number | null;
  SquareFootage?: number | null; UnitTypeID?: number | null;
  Comment?: string | null;
};
type RmProperty = {
  PropertyID: number; Name?: string; ShortName?: string; IsActive?: boolean;
  PrimaryOwnerID?: number | null;
  PrimaryOwner?: RmOwner | null;
  Addresses?: RmAddress[];
  Units?: RmUnit[];
  VacantUnitIDs?: number[] | string | null;
};

async function page<T>(
  session: RmSession, path: string, pageNumber: number,
): Promise<T[]> {
  const join = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${pageNumber}`,
    {
      headers: { [session.header]: session.token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return Array.isArray(body) ? body as T[] : [];
}

/** Every page of something, up to a sane ceiling. The ceiling exists because
 *  a paging bug that always returns page one is an infinite loop, and an
 *  infinite loop against somebody else's API is a rude thing to write. */
async function all<T>(session: RmSession, path: string, cap = 40): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p <= cap; p++) {
    const batch = await page<T>(session, path, p);
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Rent Manager reports vacancy as a list of unit ids on the property, and
 *  has been seen to send it as a comma-separated string. */
function vacantSet(v: RmProperty["VacantUnitIDs"]): Set<number> {
  if (Array.isArray(v)) return new Set(v.map(Number).filter(Number.isFinite));
  if (typeof v === "string") {
    return new Set(v.split(/[,\s]+/).map(Number).filter(Number.isFinite));
  }
  return new Set();
}

function addressOf(list: RmAddress[] | undefined): string | null {
  const a = (list ?? []).find((x) => x.IsPrimary) ?? (list ?? [])[0];
  if (!a) return null;
  const line = [a.Street, a.City, [a.State, a.PostalCode].filter(Boolean).join(" ")]
    .map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  return line || null;
}

/**
 * What kind of place this is, guessed from its shape.
 *
 * Rent Manager does not record "this is a mobile home park" in a way that
 * survives the trip: PropertyType is a free field and the unit types are
 * named by whoever set them up. So: one dwelling is a house, and several
 * dwellings whose units are called lots or sites is a park.
 *
 * Only ever applied to a property being created. A kind somebody has
 * corrected here is never overwritten by a later import -- a guess does not
 * get to overrule a person.
 */
function guessKind(p: RmProperty, unitTypeNames: Map<number, string>): Kind {
  const units = p.Units ?? [];
  if (units.length <= 1) return "sfh";
  const words = units
    .map((u) => `${u.Name ?? ""} ${unitTypeNames.get(u.UnitTypeID ?? -1) ?? ""}`)
    .join(" ").toLowerCase();
  if (/\blot\b|\bsite\b|mobile home|manufactured/.test(words)) return "mhp";
  if (units.length === 2) return "duplex";
  if (units.length === 3) return "triplex";
  return "multi";
}

export async function importFromRentManager(
  { dryRun, staffId }: { dryRun: boolean; staffId: string | null },
): Promise<Outcome> {
  const notes: Note[] = [];
  const preview: Row[] = [];
  const tally = {
    owners: { seen: 0, written: 0 },
    properties: { seen: 0, written: 0 },
    units: { seen: 0, written: 0 },
  };

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ok: false, dryRun, ...tally, notes,
             error: "Not signed in to Rent Manager. Run the connection test first." };
  }
  const session = auth.session;
  const db = supabaseAdmin();

  // ---------------------------------------------------------------- owners
  const rmOwners = await all<RmOwner>(session, "/Owners");
  tally.owners.seen = rmOwners.length;

  const ownerIdByRm = new Map<number, string>();
  const ownerNameByRm = new Map<number, string>();
  {
    const { data: existing } = await db.from("owners").select("id, name, rm_owner_id");
    const byRm = new Map<number, string>();
    const byName = new Map<string, string>();
    for (const o of existing ?? []) {
      if (o.rm_owner_id) byRm.set(Number(o.rm_owner_id), String(o.id));
      byName.set(String(o.name).toLowerCase(), String(o.id));
    }

    for (const o of rmOwners) {
      const name = (o.DisplayName || o.Name || "").trim();
      if (!name) { notes.push(`Owner ${o.OwnerID} has no name in Rent Manager.`); continue; }
      ownerNameByRm.set(o.OwnerID, name);

      // Matched on their id first, then on a name somebody typed here before
      // the two systems were introduced -- so an LLC entered by hand gets
      // adopted rather than duplicated.
      const found = byRm.get(o.OwnerID) ?? byName.get(name.toLowerCase());
      if (found) { ownerIdByRm.set(o.OwnerID, found); }

      if (dryRun) { if (!found) tally.owners.written++; continue; }

      if (found) {
        await db.from("owners")
          .update({ rm_owner_id: o.OwnerID, rm_synced_at: new Date().toISOString() })
          .eq("id", found);
      } else {
        const { data, error } = await db.from("owners").insert({
          name, rm_owner_id: o.OwnerID, rm_synced_at: new Date().toISOString(),
        }).select("id").single();
        if (error) { notes.push(`Could not add owner "${name}": ${error.message}`); continue; }
        ownerIdByRm.set(o.OwnerID, String(data.id));
        tally.owners.written++;
      }
    }
  }

  // ------------------------------------------------------------ unit types
  const unitTypeNames = new Map<number, string>();
  for (const t of await all<{ UnitTypeID: number; Name?: string }>(session, "/UnitTypes")) {
    unitTypeNames.set(t.UnitTypeID, t.Name ?? "");
  }

  // ------------------------------------------------------------ properties
  const rmProps = await all<RmProperty>(
    session, "/Properties?embeds=Addresses,Units,PrimaryOwner");
  tally.properties.seen = rmProps.length;

  // Rent, in one pass over every unit, joined back by id. MarketRent does
  // not come down on the embedded copies.
  const rentByUnit = new Map<number, number>();
  for (const u of await all<{ UnitID: number; MarketRent?: { Amount?: number } | null }>(
    session, "/Units?embeds=MarketRent")) {
    const amount = Number(u.MarketRent?.Amount ?? NaN);
    if (Number.isFinite(amount) && amount > 0) rentByUnit.set(u.UnitID, amount);
  }

  const { data: haveProps } = await db.from("properties")
    .select("id, code, kind, rm_property_id");
  const propByRm = new Map<number, { id: string; kind: string }>();
  const propByCode = new Map<string, { id: string; kind: string }>();
  for (const p of haveProps ?? []) {
    const row = { id: String(p.id), kind: String(p.kind ?? "sfh") };
    if (p.rm_property_id) propByRm.set(Number(p.rm_property_id), row);
    if (p.code) propByCode.set(String(p.code), row);
  }

  const { data: haveUnits } = await db.from("units").select("id, rm_unit_id");
  const unitByRm = new Map<number, string>();
  for (const u of haveUnits ?? []) {
    if (u.rm_unit_id) unitByRm.set(Number(u.rm_unit_id), String(u.id));
  }

  for (const p of rmProps) {
    if (p.IsActive === false) continue;

    const code = (p.ShortName ?? "").trim();
    const name = (p.Name ?? code).trim();
    if (!code) {
      notes.push(`"${name}" has no Short Name in Rent Manager, so it has no code. Skipped.`);
      continue;
    }

    // Their id first, then their code -- which adopts a property somebody
    // added here by hand before the connection existed.
    const existing = propByRm.get(p.PropertyID) ?? propByCode.get(code);
    const kind = existing ? (existing.kind as Kind) : guessKind(p, unitTypeNames);
    const spec = KINDS[kind] ?? KINDS.sfh;

    const row = {
      name, code,
      address: addressOf(p.Addresses),
      owner_id: p.PrimaryOwnerID ? ownerIdByRm.get(p.PrimaryOwnerID) ?? null : null,
      color: spec.color,
      rm_property_id: p.PropertyID,
      rm_synced_at: new Date().toISOString(),
    };

    let propertyId = existing?.id ?? null;
    if (!dryRun) {
      if (propertyId) {
        // Kind is not in the patch. A guess made on the first import must not
        // overrule somebody who corrected it afterwards.
        const { error } = await db.from("properties").update(row).eq("id", propertyId);
        if (error) { notes.push(`Could not update ${code}: ${error.message}`); continue; }
      } else {
        const { data, error } = await db.from("properties")
          .insert({ ...row, kind }).select("id").single();
        if (error) { notes.push(`Could not add ${code}: ${error.message}`); continue; }
        propertyId = String(data.id);
        tally.properties.written++;
      }
    } else if (!propertyId) {
      tally.properties.written++;
    }

    // ----------------------------------------------------------- its units
    const vacant = vacantSet(p.VacantUnitIDs);

    if (dryRun) {
      preview.push({
        code, name, kind,
        units: (p.Units ?? []).length,
        // A handful is enough to recognise the shape. Whether these read as
        // "#22, #30, #58" or as one address decides whether a park came
        // across as a park.
        unitNames: (p.Units ?? []).slice(0, 4).map((u) => (u.Name ?? "").trim()),
        vacant: (p.Units ?? []).filter((u) => vacant.has(u.UnitID)).length,
        owner: p.PrimaryOwnerID ? ownerNameByRm.get(p.PrimaryOwnerID) ?? null : null,
        address: addressOf(p.Addresses),
        existing: Boolean(existing),
      });
    }

    for (const u of p.Units ?? []) {
      tally.units.seen++;
      const label = (u.Name ?? "").trim() || String(u.UnitID);
      const unitRow: Record<string, unknown> = {
        property_id: propertyId,
        label,
        bedrooms: u.Bedrooms ?? null,
        bathrooms: u.Bathrooms ?? null,
        square_feet: u.SquareFootage ?? null,
        monthly_rent: rentByUnit.get(u.UnitID) ?? null,
        is_vacant: vacant.has(u.UnitID),
        rm_unit_id: u.UnitID,
        rm_synced_at: new Date().toISOString(),
      };

      const known = unitByRm.get(u.UnitID);
      if (dryRun) { if (!known) tally.units.written++; continue; }
      if (!propertyId) { notes.push(`Unit ${label} has no property to sit under.`); continue; }

      if (known) {
        const { error } = await db.from("units").update(unitRow).eq("id", known);
        if (error) notes.push(`Could not update unit ${label}: ${error.message}`);
      } else {
        const { error } = await db.from("units").insert(unitRow);
        if (error) notes.push(`Could not add unit ${label}: ${error.message}`);
        else tally.units.written++;
      }
    }
  }

  // Recorded whether it was a rehearsal or not, so "when did this last run"
  // has an answer that is not somebody's memory of clicking a button.
  await db.from("rm_syncs").insert({
    finished_at: new Date().toISOString(),
    dry_run: dryRun, ok: true,
    owners_seen: tally.owners.seen, owners_written: tally.owners.written,
    props_seen: tally.properties.seen, props_written: tally.properties.written,
    units_seen: tally.units.seen, units_written: tally.units.written,
    notes: notes.slice(0, 100),
    by_staff: staffId,
  }).then(() => {}, () => {});

  return { ok: true, dryRun, ...tally, notes, ...(dryRun ? { preview } : {}) };
}
