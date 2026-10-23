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
// /jobs/<token> is a contractor's own list, authenticated by the token in the
// URL rather than by a session. Sending it to the sign-in page would mean
// asking a plumber to create an account, which is how the completion photo
// stops arriving.
// /trades/apply is a contractor putting themselves forward. It writes to an
// application queue, never to contacts, so a public form cannot reach a row
// that already exists.
// /report is a tenant saying something is broken. Behind a login it is a
// page no tenant can reach, which is the failure this list's own comment
// warns about -- added an hour after the page shipped, by somebody who had
// read that comment and walked past it anyway.
const PUBLIC = [/^\/login/, /^\/signin/, /^\/auth/, /^\/apply/, /^\/criteria/, /^\/book\//,
                /^\/jobs\//, /^\/trades\/apply/, /^\/join/, /^\/welcome\//, /^\/report/,
                // Says which commit is answering here and nothing else. The
                // setup check fetches it across domains to find out whether a
                // custom domain and this one are the same deployment.
                /^\/api\/whoami$/];

const isPublic = (path: string) => PUBLIC.some((re) => re.test(path));

/** The methods that only look. Everything else is a change.
 *
 *  Listed as what is ALLOWED rather than what is refused: a list of refused
 *  verbs is one somebody adds PATCH to and forgets, and the failure is
 *  silent -- a read-only account quietly able to write. */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

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

  /* AN API REQUEST IS NEVER BOUNCED TO THE SIGN-IN PAGE.
     Twilio, Postmark and the vendor links arrive with a signature or a token
     and no session at all. Redirecting those to /login would turn every
     inbound text into an HTML page nobody reads, so an unauthenticated API
     call simply goes through to the route, which does its own checking. */
  const api = path.startsWith("/api");

  if (!user) {
    if (api) return response;
    if (!isPublic(path)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return response;
  }

  /* READ ONLY MEANS READ ONLY, AND IT IS DECIDED HERE.
   *
   * A guest account exists so somebody can look round the application and say
   * what they think of it. Hiding the buttons would not be that: every one of
   * these routes is a URL and a fetch away, and a person poking at a live
   * system is exactly who finds that out. A hidden button is a suggestion.
   *
   * So it is refused by METHOD, in the one place every request passes
   * through, which means there is nothing to remember when the next route is
   * written. That is the whole reason it is here and not in forty handlers.
   *
   * The role is read only for writes by somebody signed in -- a bounded,
   * small set. Every GET, and every webhook, costs nothing.
   */
  if (!READS.has(request.method)) {
    const { data: me } = await supabase
      .from("staff").select("role, active").eq("id", user.id).maybeSingle();

    /* FAIL CLOSED. A signed-in session with no staff row behind it is not
       staff, and the one thing it must not be given is a write. The routes
       that legitimately run before a staff row exists -- taking up an invite,
       signing in with a PIN -- carry no session at all and were let through
       above. */
    if (!me || me.active === false || me.role === "viewer") {
      const why = me?.role === "viewer"
        ? "This account can look at everything and change nothing."
        : "That account cannot make changes.";
      return api
        ? NextResponse.json({ error: why }, { status: 403 })
        : new NextResponse(why, { status: 403 });
    }
  }

  return response;
}


/** Files a phone fetches WITHOUT a session, and must get.
 *
 *  Two of these decide whether this is an app or a bookmark:
 *
 *  - manifest.webmanifest: the browser reads it before anyone signs in. Bounced
 *    to /login, "Add to Home Screen" makes a shortcut rather than installing the
 *    app -- no name, no standalone window, and on iOS no push notifications at
 *    all, because iOS only delivers those to an installed app.
 *  - sw.js: the service worker IS the push notification handler. A redirect
 *    here means registration fails and nobody is ever alerted to anything.
 *
 *  Both fetches are anonymous by design, and neither file says anything about
 *  anybody -- they are the same for every visitor signed in or not. */
//  One string literal, not a concatenation: Next reads this at compile time and
//  refuses anything it cannot parse statically.
export const config = {
  //  `api` is NOT excluded any more. It was, which meant a read-only account
  //  was refused nothing that mattered: the screens are reads, and every
  //  change in this application is an API call. The proxy lets an
  //  unauthenticated API request straight through, so webhooks are unaffected.
  matcher: ["/((?!_next/static|_next/image|sw\\.js|favicon\\.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|webmanifest)$).*)"],
};
