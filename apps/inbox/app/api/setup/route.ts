import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { runSetupChecks } from "@/lib/setup-check";
import { cronKeyOk } from "@/lib/cron-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The Hobby ceiling. Several of these checks make a real network call --
 *  Anthropic, Twilio, Postmark -- and a diagnostic killed at sixty seconds
 *  returns Vercel's own page rather than JSON, which reads as the app being
 *  broken rather than as the check being slow. */
export const maxDuration = 60;

/** The same checks as /setup, as JSON.
 *
 *  Not a duplicate: a server component that throws in production renders as an
 *  opaque digest with the message stripped, which is precisely the wrong
 *  failure mode for a diagnostic. This route controls its own response body, so
 *  even a crash comes back as a sentence someone can act on.
 *
 *  TWO WAYS IN, AND THEY ARE NOT THE SAME QUESTION.
 *
 *  A signed-in admin gets everything, the Visibility checks included, because
 *  those ask what THAT PERSON can see and there is no answer to them without a
 *  person.
 *
 *  A machine holding the reports key gets everything else. That is the half
 *  that matters here: whether the Anthropic key in this build is accepted,
 *  whether Twilio points at this deployment, whether email is arriving. Until
 *  now every one of those could only be read by a human opening a page and
 *  reading a line back -- so the answer to "did the redeploy take" was always
 *  somebody else's afternoon, and this machine cannot reach the site directly
 *  to find out.
 *
 *  It can reach it through Postgres, which pg_net can call and which already
 *  holds the key in Vault:
 *
 *      select net.http_get(
 *        'https://app.larabeehomesllc.com/api/setup',
 *        headers := jsonb_build_object(
 *          'Authorization', 'Bearer ' || (select decrypted_secret
 *             from vault.decrypted_secrets where name = 'reports_cron_key')));
 *
 *  The key is read and sent inside the database and never passes through a
 *  chat window, a file or a terminal. Same reasoning as the schedule itself.
 *
 *  Nothing here carries a secret: `shape()` reports a length and a prefix, and
 *  every detail line is written to be read by the person fixing it. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";

  const machine = await cronKeyOk(req, "report_key_ok");
  if (!machine) {
    const staff = await requireStaff();
    if (staff?.role !== "admin") {
      return NextResponse.json({ error: "admins only" }, { status: 403 });
    }
  }

  try {
    return NextResponse.json({
      /* Without a person there is nobody to ask the Visibility checks about,
         and asking them of the service role would answer a different question
         confidently -- the service role sees everything, so they would all
         pass and say nothing about what staff can actually read. */
      checks: await runSetupChecks(
        `${proto}://${host}`,
        machine ? undefined : await supabaseServer(),
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "the setup check itself failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
