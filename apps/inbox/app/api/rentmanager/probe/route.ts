import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { rmAuthorize, rmGet, rmSettings, type RmCall } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Find out what this Rent Manager account will actually give us.
 *
 * Not a health check -- a survey. Rent Manager accounts differ in what has
 * been bought and switched on, the documentation describes a superset of what
 * any one account exposes, and the only honest way to find out is to knock on
 * each door and write down who answers.
 *
 * Every endpoint is asked for one record and nothing but field names comes
 * back to the browser. No tenant name, no balance, no address: at this stage
 * the question is "does this work and what is it called", and pulling real
 * resident data across to answer that would be careless.
 */

/** In dependency order, so a reader can see the shape of the eventual import:
 *  properties hold units, units hold leases, leases hold people and money. */
const DOORS = [
  "/Properties?pagesize=1",
  "/Units?pagesize=1",
  "/UnitTypes?pagesize=1",
  "/Tenants?pagesize=1",
  "/Leases?pagesize=1",
  "/Contacts?pagesize=1",
  "/ServiceManagerIssues?pagesize=1",
  "/Charges?pagesize=1",
  "/Payments?pagesize=1",
  "/Vendors?pagesize=1",
  "/Owners?pagesize=1",
  "/GLAccounts?pagesize=1",
];

export async function POST() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const s = rmSettings();
  if (!s) {
    return NextResponse.json({
      configured: false,
      hint: "Set RENTMANAGER_BASE_URL (or RENTMANAGER_COMPANY), RENTMANAGER_USERNAME"
        + " and RENTMANAGER_PASSWORD in Vercel, then redeploy.",
    });
  }

  const auth = await rmAuthorize(true);
  if (!auth.ok) {
    return NextResponse.json({
      configured: true,
      // The base URL is not a secret and being able to see it is most of
      // diagnosing a wrong company code.
      base: s.base,
      signedIn: false,
      status: auth.status,
      detail: auth.detail,
      hint: hintFor(auth.status, auth.detail),
    });
  }

  // Sequential rather than parallel: twelve simultaneous requests from an
  // integration user is the sort of thing that trips a rate limit on the
  // first night, and this runs once.
  const calls: RmCall[] = [];
  for (const door of DOORS) calls.push(await rmGet(door, auth.token));

  const open = calls.filter((c) => c.ok);
  return NextResponse.json({
    configured: true,
    base: s.base,
    signedIn: true,
    open: open.length,
    tried: calls.length,
    calls,
  });
}

/** What the status code nearly always means here, said plainly. */
function hintFor(status: number, detail: string): string {
  if (status === 0) {
    return "The address did not resolve or did not answer. Check the company code"
      + " in RENTMANAGER_BASE_URL — it is the part before .api.rentmanager.com.";
  }
  if (status === 401 || status === 403) {
    return "Rent Manager answered, and refused the sign-in. Either the username or"
      + " password is wrong, or this user is not permitted to use the API —"
      + " which is a per-user setting, and separate from being able to log in"
      + " to Rent Manager normally.";
  }
  if (status === 404) {
    return "That address answered but has no AuthorizeUser endpoint, which usually"
      + " means the API is not enabled for this account at all.";
  }
  if (/location/i.test(detail)) {
    return "The LocationID looks wrong. Try RENTMANAGER_LOCATION_ID=1, then 2.";
  }
  return "Rent Manager answered but did not accept the sign-in. The message above"
    + " is theirs, word for word.";
}
