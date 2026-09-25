import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { runSetupChecks, type Check } from "@/lib/setup-check";
import BackLink from "@/components/BackLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What is actually wired up, and what is not.
 *
 * This exists because the useful facts about a deployment live in places
 * nobody can see. A hosting dashboard stores secrets write-only, so the value
 * in the box can never be read back. A webhook failure is recorded as a status
 * code in one console and a truncated log line in another. The result is that
 * diagnosing "my text did not arrive" turns into pasting credentials again and
 * hoping, which is guessing with extra steps.
 *
 * So the server -- which can see all of it -- answers the questions directly,
 * and answers them about the live deployment rather than about a config file.
 *
 * No secret is ever rendered. What is shown is shape (a Twilio auth token is
 * 32 hex characters), presence, and the outcome of actually using the
 * credential: the page signs in to Twilio and reports whether it was let in.
 * That last one is the only check that cannot be faked by a plausible-looking
 * value, which is why it is here.
 */
export default async function Setup() {
  const staff = await requireStaff();
  if (staff?.role !== "admin") redirect("/");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const checks: Check[] = await runSetupChecks(origin);

  const bad = checks.filter((c) => c.level === "bad").length;

  return (
    <main className="audit">
      <BackLink />
      <h1>Setup check</h1>
      <p className="muted">
        {bad === 0
          ? "Everything this page can check is in order."
          : `${bad} thing${bad > 1 ? "s are" : " is"} wrong. Each one below says what to do about it.`}
      </p>
      <p className="muted" style={{ marginTop: ".4rem" }}>
        No password, token or key is shown on this page, and none is written to
        the logs it produces.
      </p>

      <ul className="checks">
        {checks.map((c) => (
          <li key={c.name} className={`check ${c.level}`}>
            <div className="ck-top">
              <span className="ck-mark" aria-hidden="true">
                {c.level === "good" ? "✓" : c.level === "bad" ? "✕" : "!"}
              </span>
              <strong>{c.name}</strong>
            </div>
            <p>{c.detail}</p>
            {c.fix && <p className="ck-fix">{c.fix}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}

