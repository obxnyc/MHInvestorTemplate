import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Pages an applicant reaches before they are anyone to us. An allowlist
 *  rather than a list of protected paths, because the failure directions are
 *  not symmetrical: forgetting to add a page here makes it unreachable and
 *  someone notices within the hour, while forgetting to protect one exposes
 *  tenant conversations and nobody notices at all.
 *
 *  - /apply     the prequalification form, linked from larabeehomesllc.com
 *  - /criteria  the published, dated screening rules the form links to; a
 *               fair-housing defence is worth nothing behind a login
 *  - /book/…    the tokenised showing link a prequalified applicant is sent.
 *               The token is the credential; the page shows nothing without one.
 *
 *  Everything else -- threads, calls, court filings, the audit trail -- needs a
 *  session, and then row-level security decides what that session may see. */
const PUBLIC = [/^\/login/, /^\/auth/, /^\/apply/, /^\/criteria/, /^\/book\//];

const isPublic = (path: string) => PUBLIC.some((re) => re.test(path));

/** Runs before every navigation (Next 16 renamed this convention from
 *  "middleware" to "proxy"). Refreshes the Supabase session cookie and bounces
 *  signed-out users to /login. Twilio webhooks are excluded -- they carry a
 *  signature, not a session. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && !isPublic(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
