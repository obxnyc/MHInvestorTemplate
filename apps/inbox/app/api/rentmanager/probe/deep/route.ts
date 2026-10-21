import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { rmAuthorize, rmEmbedProbe } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Where the detail is hiding.
 *
 * The first probe proved the pipe and showed the bare records, and the bare
 * records are skeletons: /Leases has no end date, /Units has no rent and no
 * bed count, /Tenants has no balance and no telephone number. All of those
 * plainly exist -- the Rent Manager dashboard shows an expiring-leases list
 * and a delinquency total -- so they hang off `embeds`, and which embeds an
 * endpoint accepts is not documented anywhere reachable from here.
 *
 * So: ask. One embed at a time, and report what each added.
 */

/** Guesses, in the order most likely to matter to the import. Each is cheap
 *  and a wrong one is simply a 400 that says so. */
const WANTED: [string, string[]][] = [
  ["Properties", [
    "Addresses", "PhoneNumbers", "PrimaryOwner", "Owners", "Units",
    "UserDefinedValues", "PropertyGroups",
  ]],
  ["Units", [
    "UnitType", "Property", "Addresses", "Amenities", "MarketRent",
    "UnitStatus", "Leases", "Tenants", "UserDefinedValues",
  ]],
  ["Tenants", [
    "Addresses", "PhoneNumbers", "Contacts", "Leases", "Balance",
    "OpenReceivables", "Property", "Unit", "UserDefinedValues", "RentDueDay",
  ]],
  ["Leases", ["Tenant", "Unit", "Property", "MoveOutDate", "LeaseTerms"]],
  // The three that answer are Category, Status and Priority -- proved
  // against this account. Property, Unit and Tenant all 404, and the bare
  // record carries no PropertyID, UnitID or TenantID either, so as this
  // endpoint hands an issue over IT DOES NOT SAY WHICH LOT IT IS FOR.
  //
  // That is the one thing a maintenance request cannot do without, so the
  // rest of this list is the hunt for where Rent Manager keeps it.
  // `CreateWebUserID` is on the bare record and is the Tenant Web Access
  // user who submitted it, which makes the web-user embeds the most
  // promising of them: resolve that and the tenant, and the tenant's
  // lease, give the lot.
  ["ServiceManagerIssues", [
    "Category", "Status", "Priority",
    "Locations", "ServiceManagerLocations", "IssueLocations", "Location",
    "Participants", "ServiceManagerParticipants",
    "CreateWebUser", "WebUser", "CreateUser", "AssignedToUser",
    "UserDefinedValues", "Attachments", "History", "ServiceManagerHistory",
    "WorkOrders", "ServiceManagerWorkOrders", "Notes", "ServiceManagerNotes",
  ]],
  ["Vendors", ["Addresses", "PhoneNumbers", "Contacts"]],
  ["Owners", ["Addresses", "PhoneNumbers", "Contacts", "Properties"]],
  ["Contacts", ["PhoneNumbers", "Addresses"]],
];

export async function POST() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return NextResponse.json({
      signedIn: false,
      hint: "Run the first test again — the sign-in is no longer working.",
    });
  }

  // Sequential throughout. This is roughly sixty requests and the point is to
  // be a good citizen on an account that has never seen API traffic before.
  const found = [];
  for (const [entity, candidates] of WANTED) {
    found.push(await rmEmbedProbe(entity, candidates, auth.session));
  }

  return NextResponse.json({ signedIn: true, base: auth.session.base, found });
}
