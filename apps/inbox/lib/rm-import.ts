import { supabaseAdmin } from "@/lib/supabase-admin";
import { rmAuthorize, type RmSession } from "@/lib/rentmanager";
import type { Kind } from "@/lib/property";
import { KINDS, nextCode } from "@/lib/property";

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
  /** Things worth a second look before this is written: a lot that never
   *  made it into its park's group, a record that is a company rather than
   *  a building. Neither is an error here -- both are facts about Rent
   *  Manager that are easier to fix over there. */
  flags: string[];
  /** Rent Manager's own grouping. The dashboard's property filter reads
   *  "LarabeeHomesParent", which is a group -- so if the parks are modelled
   *  anywhere, this is the likeliest place, and it is the difference between
   *  a portfolio and two hundred unrelated addresses. */
  groups: string[];
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
type RmGroup = { Name?: string };
type RmProperty = {
  PropertyID: number; Name?: string; ShortName?: string; IsActive?: boolean;
  PropertyGroups?: RmGroup[];
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
 * A lot filed under the wrong parcel.
 *
 * 1140 Northside and 1148 Northside are two parks, next door to each other,
 * and one of 1148's lots is sitting in 1140's group. With ninety-one lots
 * across two adjacent parcels that will happen again, and it is invisible
 * once imported: the lot simply appears in the wrong park and stays there.
 *
 * Worked out from the lots themselves rather than from an address somebody
 * typed. Sixty-three lots beginning "1140" and one beginning "1148" is not
 * ambiguous, and a park whose lots genuinely carry mixed numbers -- one with
 * internal street names, say -- has no majority and so raises nothing.
 */
function strays(lots: RmProperty[]): Map<number, string> {
  const numberOf = (s: string) => (s.trim().match(/^(\d{2,6})\b/) ?? [])[1] ?? null;

  const tally = new Map<string, number>();
  for (const l of lots) {
    const n = numberOf(l.Name ?? "");
    if (n) tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  if (!tally.size) return new Map();

  const [common, howMany] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
  // A majority, not a plurality. Three numbers at a third each is a park
  // addressed by its own internal streets, and nothing there is a stray.
  if (howMany < lots.length * 0.6) return new Map();

  const out = new Map<number, string>();
  for (const l of lots) {
    const n = numberOf(l.Name ?? "");
    if (n && n !== common) {
      out.set(l.PropertyID,
        `addressed ${n} but filed in a park whose other ${howMany} lots are ${common}`);
    }
  }
  return out;
}

/**
 * Anything about this record that deserves a look before it is imported.
 *
 * Two patterns turned up on the first real preview and neither is a bug in
 * the mapping -- they are both true things about the Rent Manager data that
 * are cheaper to fix there than to work around here.
 *
 * A property called "1140 Northside Rd, Lot #16" with no units is a lot of a
 * park that never got added to the park's group. Imported as it stands it
 * becomes a single-family house on its own, which is wrong and will look
 * wrong on the properties screen.
 *
 * A property called "Larabee Homes" or "Dutch Doors" is an administrative
 * record named after a company, not a building. It has no units because
 * there is nothing to let.
 */
function flagsFor(
  p: RmProperty, code: string, name: string,
  companies: Set<string>, inPark: boolean,
  /* The count AFTER a single home has been given its own unit, which is
     the number the row actually imports with.

     Asked of Rent Manager's raw answer instead, the summary at the top
     of the preview said "0 with no units at all" and the list directly
     beneath it said "22 no units" -- the same question answered twice,
     differently, on one screen. The headline was reading the preview
     rows and the list was reading the API, and whichever somebody
     believed, the other was there to be found later and disbelieved.

     One number, from one place. */
  unitCount: number,
): string[] {
  const flags: string[] = [];
  const units = unitCount;

  if (!inPark && /\blot\b\s*#?\s*\w/i.test(name)) {
    flags.push("looks like a lot of a park, but is not in a park group");
  }
  if (companies.has(name.trim().toLowerCase())) {
    flags.push("named after a company, not a building");
  }
  if (!units) flags.push("no units — nothing to let, nothing to charge");
  if (!code) flags.push("no Short Name in Rent Manager, so no code");
  return flags;
}

/* ------------------------------------------- two decisions, asked apart
 *
 * Both of these decide what is written into a live portfolio of 166
 * properties, and neither is visible in a type. They are functions
 * rather than conditions inside a six-hundred-line loop so that the
 * awkward cases can be put to them directly.
 */

/**
 * Whether a Rent Manager property is really a book-keeping record.
 *
 * "Larabee Homes", "Dutch Doors", "Musgrove Holdings LLC" exist over
 * there because the book is organised that way, not because anybody
 * lives there. Imported, they become houses with no units and no
 * address that count towards every total for ever.
 *
 * BOTH conditions are required. A company name on its own is not
 * enough: a real house named after the company that owns it still has
 * a unit, somebody in it, and rent on it, and dropping that because of
 * its name would lose a building.
 */
export function isBookkeepingRecord(
  name: string, companies: Set<string>, unitCount: number,
): boolean {
  return unitCount === 0 && companies.has(name.trim().toLowerCase());
}

/**
 * What to call the unit a single home becomes, or null to invent none.
 *
 * Sixty-seven properties arrive with nothing under them. For a single
 * home that is Rent Manager's modelling, not a fact: somebody lives
 * there. And everything that can be DONE to a place hangs off its unit
 * -- a maintenance request is filed against one, and
 * `unitOfSingleHome` wants exactly one and gives up on none -- so a
 * house with no unit can never be matched to the request its tenant
 * submitted, however perfectly the address reads.
 *
 * Only for a single home. Inventing a unit for a park or a block would
 * be inventing a dwelling; there the honest answer is that the units
 * have not been set up yet.
 */
export function houseUnitLabel(
  kind: string, unitCount: number, address: string | null, name: string,
): string | null {
  if (unitCount > 0) return null;
  if (kind !== "sfh" && kind !== "mh") return null;
  // The street line, so the unit is called what somebody would say,
  // and never the empty string.
  const street = (address ?? "").split(",")[0]?.trim();
  return street || name.trim() || null;
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
  // Every owner and every group name, so a property called "Dutch Doors" can
  // be recognised as the company it is named after rather than imported as a
  // house with nothing in it.
  const companies = new Set<string>();
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
      companies.add(name.trim().toLowerCase());

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

  // ------------------------------------------------- what the groups mean
  //
  // A park is a GROUP over there and a property here; its member properties
  // are the lots. Which groups are parks is not in the data and never will
  // be -- "Pines Mobile Home Park" is one, "Non-Musgrove" is a reporting
  // filter -- so it is recorded by a person and read here. A group nobody
  // has judged does nothing at all, which is the safe way for it to fail.
  const roleOf = new Map<string, {
    role: string; localName: string | null; localAddress: string | null;
    propertyId: string | null;
  }>();
  {
    const { data } = await db.from("rm_groups")
      .select("name, role, local_name, local_address, property_id");
    for (const g of data ?? []) {
      companies.add(String(g.name).trim().toLowerCase());
      roleOf.set(String(g.name), {
        role: String(g.role ?? "unset"),
        localName: (g.local_name as string | null) ?? null,
        localAddress: (g.local_address as string | null) ?? null,
        propertyId: (g.property_id as string | null) ?? null,
      });
    }
  }
  // Where WE say a lot sits, when that differs from Rent Manager. Nothing is
  // written over there on the strength of a street number -- a filing that
  // looks like an oversight is sometimes a decision whose reason has been
  // forgotten. Deleting the row falls straight back to their answer.
  const placed = new Map<number, string | null>();
  {
    const { data, error } = await db.from("rm_placements")
      .select("rm_property_id, park_group");
    if (!error) {
      for (const r of data ?? []) {
        placed.set(Number(r.rm_property_id), (r.park_group as string | null) ?? null);
      }
    }
  }

  const named = (p: RmProperty) =>
    (p.PropertyGroups ?? []).map((g) => (g.Name ?? "").trim()).filter(Boolean);
  const groupWith = (p: RmProperty, role: string) =>
    named(p).find((n) => roleOf.get(n)?.role === role) ?? null;

  /** The park a property belongs to: ours if we have said, theirs otherwise.
   *  A placement row with no group is the other decision -- leave it standing
   *  alone whatever group it is in over there. */
  const parkOf = (p: RmProperty): string | null => {
    if (placed.has(p.PropertyID)) {
      const ours = placed.get(p.PropertyID);
      return ours && roleOf.get(ours)?.role === "park" ? ours : null;
    }
    return groupWith(p, "park");
  };

  // ------------------------------------------------------------ properties
  const rmProps = await all<RmProperty>(
    session, "/Properties?embeds=Addresses,Units,PrimaryOwner,PropertyGroups");
  // Counted by the loops below, not from the Rent Manager total: a park's
  // sixty-four lots are one property here, so their count and ours are
  // different numbers and adding both gave 382 for 123 things.

  // Rent, in one pass over every unit, joined back by id. MarketRent does
  // not come down on the copies embedded in a property.
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
  const takenCodes: string[] = [];
  for (const p of haveProps ?? []) {
    const row = { id: String(p.id), kind: String(p.kind ?? "sfh") };
    if (p.rm_property_id) propByRm.set(Number(p.rm_property_id), row);
    if (p.code) { propByCode.set(String(p.code), row); takenCodes.push(String(p.code)); }
  }

  const { data: haveUnits } = await db.from("units")
    .select("id, rm_unit_id, rm_property_id");
  const unitByRmUnit = new Map<number, string>();
  const unitByRmProp = new Map<number, string>();
  for (const u of haveUnits ?? []) {
    if (u.rm_unit_id) unitByRmUnit.set(Number(u.rm_unit_id), String(u.id));
    if (u.rm_property_id) unitByRmProp.set(Number(u.rm_property_id), String(u.id));
  }

  // Sorted so a park's own property is created before anything is hung off
  // it, and so the preview reads parks first.
  const lotsByPark = new Map<string, RmProperty[]>();
  const standalone: RmProperty[] = [];
  for (const p of rmProps) {
    if (p.IsActive === false) continue;
    const park = parkOf(p);
    if (park) {
      (lotsByPark.get(park) ?? lotsByPark.set(park, []).get(park)!).push(p);
    } else {
      standalone.push(p);
    }
  }

  /** The single unit Rent Manager keeps inside a lot's property, which is
   *  where its beds, baths and square footage actually live. */
  const innerUnit = (p: RmProperty): RmUnit | null => (p.Units ?? [])[0] ?? null;

  /** Everything about one lot, ready to be written as a unit of a park. */
  function lotRow(lot: RmProperty, parkId: string | null) {
    const inner = innerUnit(lot);
    const vacant = vacantSet(lot.VacantUnitIDs);
    return {
      property_id: parkId,
      // Their name for the lot -- "1140 Northside #22" -- because that is
      // what is said on the phone and written on a work order.
      label: (lot.Name ?? lot.ShortName ?? String(lot.PropertyID)).trim(),
      bedrooms: inner?.Bedrooms ?? null,
      bathrooms: inner?.Bathrooms ?? null,
      square_feet: inner?.SquareFootage ?? null,
      monthly_rent: inner ? rentByUnit.get(inner.UnitID) ?? null : null,
      is_vacant: inner ? vacant.has(inner.UnitID) : false,
      // We own the dirt. The home standing on it belongs to whoever Rent
      // Manager runs the distribution to -- an investor, in a park.
      home_owner_id: lot.PrimaryOwnerID
        ? ownerIdByRm.get(lot.PrimaryOwnerID) ?? null : null,
      rm_unit_id: inner?.UnitID ?? null,
      rm_property_id: lot.PropertyID,
      rm_synced_at: new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------------- parks
  for (const [groupName, lots] of lotsByPark) {
    const g = roleOf.get(groupName)!;
    const misfiled = strays(lots);
    const name = (g.localName || groupName).trim();
    tally.properties.seen++;

    let parkId = g.propertyId;

    /* IS IT LINKED, OR DOES IT EXIST? Two different questions.
     *
     * This only ever asked the first. A group with no `property_id` got
     * a brand new park -- so an import run against a database that
     * already held The Retreat made a SECOND The Retreat, with the
     * Rent Manager lots on it and none of the map. Four parks became
     * eight in one press, and the duplicate carrying the real lots was
     * the one WITHOUT the sixty homes somebody had placed by hand.
     *
     * Nothing failed. Both records look like parks.
     *
     * The link is how a park is recognised and it is not the only way:
     * a park already here under the same name is the same park. Found,
     * it is adopted and the link written, so the question is only ever
     * asked once.
     *
     * Matched on the name alone, not the address -- a park's gate
     * address is typed by hand and was wrong on Cross Creek the first
     * time, and matching on a field somebody can mistype would make a
     * typo silently mint a second park, which is the bug this is for. */
    if (!parkId) {
      const { data: already } = await db.from("properties")
        .select("id").eq("kind", "mhp").eq("name", name).limit(2);
      // Two parks of one name is a question, not a match -- the same
      // refusal `matchPlace` makes about two houses at one address.
      if (already?.length === 1) {
        parkId = String(already[0]!.id);
        if (!dryRun) {
          await db.from("rm_groups")
            .update({ property_id: parkId }).eq("name", groupName);
        }
        notes.push(`"${name}" was already here, so it was used rather than`
          + " a second one being made.");
      } else if ((already?.length ?? 0) > 1) {
        notes.push(`There is more than one park called "${name}" here, so`
          + " this group was left alone rather than guessing which.");
        continue;
      }
    }

    if (!parkId) {
      const known = [...propByCode.keys()];
      const code = nextCode("MHP", [...takenCodes, ...known]);
      if (!dryRun) {
        const { data, error } = await db.from("properties").insert({
          name, code, kind: "mhp", color: KINDS.mhp.color,
          address: g.localAddress,
          rm_synced_at: new Date().toISOString(),
        }).select("id").single();
        if (error) { notes.push(`Could not create the park "${name}": ${error.message}`); continue; }
        parkId = String(data.id);
        takenCodes.push(code);
        await db.from("rm_groups").update({ property_id: parkId }).eq("name", groupName);
      } else {
        takenCodes.push(code);
      }
      tally.properties.written++;
    } else if (!dryRun) {
      await db.from("properties")
        .update({ name, address: g.localAddress, rm_synced_at: new Date().toISOString() })
        .eq("id", parkId);
    }

    if (dryRun) {
      preview.push({
        code: "MHP", name, kind: "mhp",
        units: lots.length,
        unitNames: lots.slice(0, 4).map((l) => (l.Name ?? "").trim()),
        vacant: lots.filter((l) => {
          const inner = innerUnit(l);
          return inner ? vacantSet(l.VacantUnitIDs).has(inner.UnitID) : false;
        }).length,
        owner: null,
        address: g.localAddress,
        existing: Boolean(g.propertyId),
        groups: [groupName],
        flags: [
          ...(lots.length ? [] : ["no lots are in this group yet"]),
          ...(misfiled.size
            ? [`${misfiled.size} lot${misfiled.size === 1 ? "" : "s"} here look`
               + `${misfiled.size === 1 ? "s" : ""} to belong to the parcel next door`]
            : []),
        ],
      });
    }

    for (const lot of lots) {
      tally.units.seen++;
      const wrongParcel = misfiled.get(lot.PropertyID);
      if (wrongParcel) {
        notes.push(`"${(lot.Name ?? "").trim()}" is in ${groupName} but is `
          + `${wrongParcel}. Move it in Rent Manager and it lands in the right park.`);
      }
      const row = lotRow(lot, parkId);
      const known = unitByRmProp.get(lot.PropertyID)
        ?? (row.rm_unit_id ? unitByRmUnit.get(row.rm_unit_id) : undefined);
      if (dryRun) { if (!known) tally.units.written++; continue; }
      if (!parkId) continue;

      if (known) {
        const { error } = await db.from("units").update(row).eq("id", known);
        if (error) notes.push(`Could not update lot ${row.label}: ${error.message}`);
      } else {
        const { error } = await db.from("units").insert(row);
        if (error) notes.push(`Could not add lot ${row.label}: ${error.message}`);
        else tally.units.written++;
      }
    }
  }

  // ----------------------------------------------- everything on its own
  for (const p of standalone) {
    const code = (p.ShortName ?? "").trim();
    const name = (p.Name ?? code).trim();
    if (!code) {
      notes.push(`"${name}" has no Short Name in Rent Manager, so it has no code. Skipped.`);
      continue;
    }
    tally.properties.seen++;

    /* A COMPANY IS NOT A BUILDING.
     *
     * "Larabee Homes", "Dutch Doors", "Musgrove Holdings LLC" are records
     * in Rent Manager because the book is organised that way, not because
     * anybody lives there. Imported as properties they become houses with
     * no units, no address and no owner, sitting in the portfolio for
     * ever and counting towards every total.
     *
     * The flag for this already existed and nothing acted on it. Both
     * conditions are required: a company name is only evidence when
     * there is also nothing to let. A real house that happens to share a
     * name with the company that owns it still has its unit, and is
     * kept. */
    if (isBookkeepingRecord(name, companies, (p.Units ?? []).length)) {
      notes.push(`"${name}" is the name of a company and has no units, so it`
        + " is a book-keeping record rather than a building. Not imported.");
      continue;
    }

    const existing = propByRm.get(p.PropertyID) ?? propByCode.get(code);
    const kind = existing ? (existing.kind as Kind) : guessKind(p, unitTypeNames);
    const spec = KINDS[kind] ?? KINDS.sfh;
    /* Worked out here, above both the preview row and the write, because
       the preview must describe the run that actually happens -- a row
       reporting 0 units beside a house the import is about to give one
       to is a preview of something else. */
    const houseLabel = houseUnitLabel(
      kind, (p.Units ?? []).length, addressOf(p.Addresses), name);
    // Somebody else's building on somebody else's land. Marked, so it stays
    // out of occupancy and rent roll instead of inflating both.
    const managed = Boolean(groupWith(p, "managed"));

    const row = {
      name, code,
      address: addressOf(p.Addresses),
      owner_id: p.PrimaryOwnerID ? ownerIdByRm.get(p.PrimaryOwnerID) ?? null : null,
      color: spec.color,
      managed_only: managed,
      rm_property_id: p.PropertyID,
      rm_synced_at: new Date().toISOString(),
    };

    let propertyId = existing?.id ?? null;
    if (!dryRun) {
      if (propertyId) {
        // Kind is not in the patch: a guess made on the first import must not
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

    if (dryRun) {
      preview.push({
        code, name, kind,
        /* The invented one counts. A preview showing 0 units beside a
           house the import is about to give a unit to is a preview of a
           different run than the one that happens. */
        units: (p.Units ?? []).length || (kind === "sfh" || kind === "mh" ? 1 : 0),
        unitNames: (p.Units ?? []).length
          ? (p.Units ?? []).slice(0, 4).map((u) => (u.Name ?? "").trim())
          : (kind === "sfh" || kind === "mh"
              ? [((addressOf(p.Addresses) ?? name).split(",")[0] ?? name).trim()
                 + " (the house itself)"]
              : []),
        vacant: (p.Units ?? []).filter((u) => vacantSet(p.VacantUnitIDs).has(u.UnitID)).length,
        owner: p.PrimaryOwnerID ? ownerNameByRm.get(p.PrimaryOwnerID) ?? null : null,
        address: addressOf(p.Addresses),
        existing: Boolean(existing),
        groups: named(p),
        flags: flagsFor(p, code, name, companies, false,
          (p.Units ?? []).length || (houseLabel ? 1 : 0)),
      });
    }

    const vacant = vacantSet(p.VacantUnitIDs);
    for (const u of p.Units ?? []) {
      tally.units.seen++;
      const label = (u.Name ?? "").trim() || String(u.UnitID);
      const unitRow = {
        property_id: propertyId,
        label,
        bedrooms: u.Bedrooms ?? null,
        bathrooms: u.Bathrooms ?? null,
        square_feet: u.SquareFootage ?? null,
        monthly_rent: rentByUnit.get(u.UnitID) ?? null,
        is_vacant: vacant.has(u.UnitID),
        rm_unit_id: u.UnitID,
        rm_property_id: p.PropertyID,
        rm_synced_at: new Date().toISOString(),
      };

      const known = unitByRmUnit.get(u.UnitID);
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

    /* A HOUSE WITH NO UNIT CANNOT BE REACHED.
     *
     * Sixty-seven properties come across with nothing under them, and
     * for a single-family home that is Rent Manager's modelling rather
     * than a fact about the world: somebody lives there, and the rent is
     * on the property record.
     *
     * It matters because everything that can be DONE to a place hangs
     * off its unit. A maintenance request is filed against a unit --
     * `unitOfSingleHome` looks for exactly one and gives up on none --
     * so a house with no unit can never be matched to the request a
     * tenant submitted about it, however perfectly the address reads.
     * The same shape as the park whose features were keyed on what the
     * tiles carried: the screen looks complete and nothing works.
     *
     * So the house becomes its own unit, which is what it is. Only for
     * a single home: inventing one for a park or a block would be
     * inventing a dwelling, and the right answer there is that the
     * units have not been set up yet.
     *
     * It is NOT marked vacant. Vacancy comes from Rent Manager's own
     * list and a unit we created is not on it -- a phantom vacancy
     * would go straight into the money dashboard as a letting
     * opportunity that does not exist.
     */
    if (houseLabel) {
      const label = houseLabel;
      tally.units.seen++;
      if (dryRun) {
        tally.units.written++;
      } else if (propertyId) {
        /* ASKED OF THE DATABASE, not of Rent Manager's answer.
           A unit invented here has no `rm_unit_id`, so there is nothing
           for the next run to recognise it by -- and `p.Units` is still
           empty, so without this the second import gives the house a
           second unit, the third a third, and `unitOfSingleHome` stops
           matching it at all because it no longer holds exactly one.
           The import is pressed more than once by design. */
        const { count } = await db.from("units")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId);
        if (!count) {
          const { error } = await db.from("units").insert({
            property_id: propertyId,
            label,
            is_vacant: false,
            rm_property_id: p.PropertyID,
            rm_synced_at: new Date().toISOString(),
          });
          if (error) notes.push(`Could not give "${name}" a unit: ${error.message}`);
          else tally.units.written++;
        }
      }
    }
  }

  const unjudged = [...new Set(rmProps.flatMap(named))]
    .filter((n) => (roleOf.get(n)?.role ?? "unset") === "unset");
  if (unjudged.length) {
    notes.push(`Nobody has said what these groups are, so they did nothing: ${unjudged.join(", ")}.`);
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

/* ------------------------------------------------------------------- undo
 *
 * A first import writes hundreds of rows against a portfolio nobody has seen
 * in this shape before, and the preview is a preview -- it is what the code
 * BELIEVES it will do, which is exactly the thing in question. So there is a
 * way back.
 *
 * What it removes is defined narrowly and by evidence, not by a timestamp
 * window: a row is undoable only if it carries a Rent Manager id, which is
 * to say only if an import created it. Anything typed in by hand has no such
 * id and is never touched -- including a property that an import ADOPTED,
 * because adopting sets the id on a row somebody else made. So adopted rows
 * are unlinked rather than deleted: the id and the sync stamp come off, the
 * property stays.
 */

export type Undone = {
  ok: boolean;
  dryRun: boolean;
  units: { removed: number };
  properties: { removed: number; unlinked: number };
  parks: { removed: number };
  kept: string[];
  error?: string;
};

export async function undoLastImport(
  { dryRun }: { dryRun: boolean },
): Promise<Undone> {
  const db = supabaseAdmin();
  const kept: string[] = [];
  const out: Undone = {
    ok: true, dryRun,
    units: { removed: 0 },
    properties: { removed: 0, unlinked: 0 },
    parks: { removed: 0 },
    kept,
  };

  // Units first: a property with units still under it cannot go, and a lot
  // orphaned from its park is worse than either.
  const { data: units } = await db.from("units")
    .select("id, label, rm_unit_id, rm_property_id")
    .or("rm_unit_id.not.is.null,rm_property_id.not.is.null");

  for (const u of units ?? []) {
    // Anything filed against this lot means somebody has used it. A
    // conversation about a leak is worth more than a tidy undo.
    const { count: convos } = await db.from("conversations")
      .select("id", { count: "exact", head: true }).eq("unit_id", u.id);
    const { count: jobs } = await db.from("work_orders")
      .select("id", { count: "exact", head: true }).eq("unit_id", u.id);

    if ((convos ?? 0) + (jobs ?? 0) > 0) {
      kept.push(`${u.label}: ${(convos ?? 0)} conversation(s), ${(jobs ?? 0)} job(s) filed against it`);
      if (!dryRun) {
        await db.from("units")
          .update({ rm_unit_id: null, rm_property_id: null, rm_synced_at: null })
          .eq("id", u.id);
      }
      continue;
    }

    if (!dryRun) await db.from("units").delete().eq("id", u.id);
    out.units.removed++;
  }

  // Then properties the import created, and the ones it merely adopted.
  const { data: props } = await db.from("properties")
    .select("id, name, code, rm_property_id, kind")
    .not("rm_property_id", "is", null);

  for (const p of props ?? []) {
    const { count: left } = await db.from("units")
      .select("id", { count: "exact", head: true }).eq("property_id", p.id);
    if ((left ?? 0) > 0) {
      // Units survived, so this property is in use. Unlink, do not delete.
      kept.push(`${p.code ?? p.name}: ${left} unit(s) still in use`);
      if (!dryRun) {
        await db.from("properties")
          .update({ rm_property_id: null, rm_synced_at: null }).eq("id", p.id);
      }
      out.properties.unlinked++;
      continue;
    }
    if (!dryRun) await db.from("properties").delete().eq("id", p.id);
    out.properties.removed++;
  }

  // Parks are properties created from a GROUP and so carry no Rent Manager
  // property id of their own -- the group row is what points at them.
  const { data: groups } = await db.from("rm_groups")
    .select("name, property_id").not("property_id", "is", null);

  for (const g of groups ?? []) {
    const id = String(g.property_id);
    const { count: left } = await db.from("units")
      .select("id", { count: "exact", head: true }).eq("property_id", id);
    if ((left ?? 0) > 0) {
      kept.push(`${g.name}: ${left} lot(s) still in use`);
      continue;
    }
    if (!dryRun) {
      await db.from("properties").delete().eq("id", id);
      await db.from("rm_groups").update({ property_id: null }).eq("name", g.name);
    }
    out.parks.removed++;
  }

  // Owners are deliberately left alone. An LLC is a fact about the business
  // rather than a row an import invented, and a property somebody adds
  // tomorrow will want to point at one.
  return out;
}
