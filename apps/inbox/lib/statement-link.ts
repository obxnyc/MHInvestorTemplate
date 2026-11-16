/**
 * The "Download for Excel" link in an owner's email.
 *
 * The owner has no account here, so the link itself is the permission: it
 * names the month and the statements, and carries a signature over exactly
 * those. Change one id and the signature no longer matches, so one owner's
 * link cannot be edited into another's.
 *
 * Signed with DISTRIBUTIONS_LINK_SECRET, else the service-role key -- a
 * secret that exists on every deployment and never leaves the server. Without
 * either there is no link at all, rather than an unsigned one.
 */
import { createHmac, timingSafeEqual } from "crypto";

const secret = () => process.env.DISTRIBUTIONS_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BASE = () => process.env.APP_URL || "https://app.larabeehomesllc.com";

const sig = (month: string, ids: string[]) =>
  createHmac("sha256", secret()).update(`distribution-excel|${month}|${[...ids].sort().join(",")}`).digest("base64url");

export function excelUrl(month: string, ids: string[]): string | undefined {
  if (!secret() || !ids.length) return undefined;
  const q = new URLSearchParams({ m: month, s: ids.join(","), t: sig(month, ids) });
  return `${BASE()}/api/distributions/excel?${q}`;
}

export function excelLinkOk(month: string, ids: string[], token: string): boolean {
  if (!secret() || !ids.length || !token) return false;
  const want = Buffer.from(sig(month, ids));
  const got = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch; a wrong length is a refusal, not a 500.
  return want.length === got.length && timingSafeEqual(want, got);
}
