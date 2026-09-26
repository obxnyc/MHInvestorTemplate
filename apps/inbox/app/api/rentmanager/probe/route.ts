import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import {
  candidateBases, rmAuthorize, rmGet, rmSettings, type RmCall,
} from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Find out what this Rent Manager account will actually give us.
 *
 * A survey, not a health check. Accounts differ in what has been bought and
 * switched on, the documentation describes a superset of any one of them, and
 * with nobody at Rent Manager to ask, the honest way to find out is to knock
 * on every door and write down who answers.
 *
 * It fetches one record per endpoint and returns only the field names. No
 * resident name, balance or address crosses: at this stage the question is
 * "does this work and what is everything called", and pulling real tenant
 * data to answer it would be careless.
 */

/** In the order an import would need them: properties hold units, units hold
 *  leases, leases hold people and money. */
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
  "/Locations?pagesize=1",
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
      hint: "Set RENTMANAGER_COMPANY, RENTMANAGER_USERNAME and"
        + " RENTMANAGER_PASSWORD in Vercel, then redeploy.",
    });
  }

  const auth = await rmAuthorize(true);

  if (!auth.ok) {
    return NextResponse.json({
      configured: true,
      company: s.company,
      signedIn: false,
      // Every hostname tried and how each one failed. Which way it failed is
      // the diagnosis, so all of it is shown rather than just the last.
      attempts: auth.attempts.length
        ? auth.attempts
        : candidateBases(s.company).map((base) => ({
            base, status: 0, ok: false, detail: "not attempted" })),
      hint: diagnose(auth.attempts),
    });
  }

  // Sequential rather than parallel: a dozen simultaneous requests from a
  // brand new integration user is how you meet a rate limit on night one.
  const calls: RmCall[] = [];
  for (const door of DOORS) calls.push(await rmGet(door, auth.session));

  return NextResponse.json({
    configured: true,
    company: s.company,
    signedIn: true,
    base: auth.session.base,
    header: auth.session.header,
    attempts: auth.attempts,
    open: calls.filter((c) => c.ok).length,
    tried: calls.length,
    calls,
  });
}

/** What the collected failures nearly always mean, said plainly. */
function diagnose(attempts: { status: number; detail: string }[]): string {
  if (!attempts.length) return "Nothing was tried. Check the settings are saved and the build redeployed.";

  const refused = attempts.find((a) => a.status === 401 || a.status === 403);
  if (refused) {
    return "Rent Manager answered and refused the sign-in. That means the hostname is"
      + " right and the credential is the problem: either the username or password is"
      + " wrong, or this user is not permitted to use the API — which is a separate"
      + " setting from being able to log in to Rent Manager normally.";
  }
  if (attempts.some((a) => a.status === 404)) {
    return "A server answered but has no AuthorizeUser endpoint at that address. That"
      + " usually means the API is not enabled for this account.";
  }
  if (attempts.every((a) => a.status === 0)) {
    return "None of the addresses answered at all. Either the company code is wrong, or"
      + " Rent Manager Express serves its API from somewhere none of these guesses"
      + " covered — in which case the exact host has to come from Rent Manager.";
  }
  return "Rent Manager answered but would not sign in. The messages below are theirs,"
    + " word for word.";
}
