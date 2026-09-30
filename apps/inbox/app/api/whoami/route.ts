import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which deployment is answering at this address.
 *
 * Exists so the setup check can stop guessing. Twilio is configured with one
 * URL; the setup page is being read at another; and comparing those two
 * strings tells you nothing, because a custom domain and a vercel.app
 * hostname are routinely the same deployment. It was reporting a mismatch
 * every time somebody opened the page on the "wrong" one of their own
 * addresses -- a warning that is wrong more often than right, which is worse
 * than no warning.
 *
 * So the check asks instead. It fetches this on whatever URL Twilio has, and
 * compares the commit. Same commit, same deployment, no problem.
 *
 * Public on purpose and carries nothing worth having: the commit is already
 * printed on the setup page and is in a public repository.
 */
export async function GET() {
  return NextResponse.json({
    app: "larabee-inbox",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  }, { headers: { "Cache-Control": "no-store" } });
}
