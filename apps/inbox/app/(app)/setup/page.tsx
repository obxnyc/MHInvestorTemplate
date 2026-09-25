import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import twilio from "twilio";

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

  const checks = [
    ...envChecks(),
    ...(await twilioChecks(origin)),
  ];

  const bad = checks.filter((c) => c.level === "bad").length;

  return (
    <main className="audit">
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

type Level = "good" | "bad" | "warn";
type Check = { name: string; level: Level; detail: string; fix?: string };

/** A Twilio auth token is 32 hex characters. An Account SID is AC + 32 hex and
 *  sits directly above it on the same console panel, which is how it ends up
 *  in the wrong box. */
const HEX32 = /^[0-9a-f]{32}$/i;

function shape(raw: string | undefined): string {
  if (!raw) return "missing";
  const v = raw.trim();
  if (v !== raw) return "has whitespace around it";
  if (v.startsWith("AC")) return "starts with AC — that is an Account SID";
  if (v.startsWith("SK")) return "starts with SK — that is an API key SID";
  return `${v.length} characters`;
}

function envChecks(): Check[] {
  const out: Check[] = [];

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
    "TWILIO_MESSAGING_SERVICE_SID",
  ];
  const missing = required.filter((k) => !process.env[k]?.trim());
  out.push(missing.length === 0
    ? { name: "Required settings", level: "good",
        detail: `All ${required.length} are present.` }
    : { name: "Required settings", level: "bad",
        detail: `Missing: ${missing.join(", ")}.`,
        fix: "Add each one in Vercel → Settings → Environment Variables, then redeploy." });

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  out.push(sid && /^AC[0-9a-f]{32}$/i.test(sid)
    ? { name: "TWILIO_ACCOUNT_SID", level: "good", detail: "Correctly shaped." }
    : { name: "TWILIO_ACCOUNT_SID", level: "bad",
        detail: `Expected AC followed by 32 hex characters; got ${shape(process.env.TWILIO_ACCOUNT_SID)}.`,
        fix: "Twilio Console home → Account Info → Account SID." });

  const tok = process.env.TWILIO_AUTH_TOKEN;
  out.push(tok && HEX32.test(tok.trim())
    ? { name: "TWILIO_AUTH_TOKEN", level: "good",
        detail: "Correctly shaped (32 hex characters). Whether it is the RIGHT one is the next check." }
    : { name: "TWILIO_AUTH_TOKEN", level: "bad",
        detail: `Expected 32 hex characters; got ${shape(tok)}.`,
        fix: "Twilio Console home → Account Info → Auth Token → Show → Copy. Paste it into Vercel, then redeploy." });

  const mg = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  out.push(mg && /^MG[0-9a-f]{32}$/i.test(mg)
    ? { name: "TWILIO_MESSAGING_SERVICE_SID", level: "good", detail: "Correctly shaped." }
    : { name: "TWILIO_MESSAGING_SERVICE_SID", level: "bad",
        detail: `Expected MG followed by 32 hex characters; got ${shape(process.env.TWILIO_MESSAGING_SERVICE_SID)}.`,
        fix: "Twilio Console → Messaging → Services → your service → the SID at the top." });

  return out;
}

/** The checks that require asking Twilio rather than looking at a string. */
async function twilioChecks(origin: string): Promise<Check[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const mg = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!sid || !token) return [];

  const client = twilio(sid, token);
  const out: Check[] = [];

  // The whole point. A token can be perfectly shaped and still belong to a
  // different account, and nothing short of using it will say so.
  let signedIn = false;
  try {
    const acct = await client.api.v2010.accounts(sid).fetch();
    signedIn = true;
    out.push({ name: "Twilio sign-in", level: "good",
      detail: `Accepted. Account "${acct.friendlyName}", status ${acct.status}.` });
  } catch (e) {
    const status = (e as { status?: number }).status;
    out.push({ name: "Twilio sign-in", level: "bad",
      detail: status === 401
        ? "Twilio refused these credentials. The SID and the auth token do not go together."
        : `Could not reach Twilio to check (${(e as Error).message}).`,
      fix: status === 401
        ? "Re-copy BOTH from Twilio Console home → Account Info: the Account SID and the Auth Token, from the same account. Paste both into Vercel, then redeploy. This is the cause of a webhook that returns 'signature did not match'."
        : undefined });
  }

  if (signedIn && mg) {
    try {
      const svc = await client.messaging.v1.services(mg).fetch();
      const configured = (svc.inboundRequestUrl ?? "").trim();
      const expected = `${origin}/api/twilio/sms`;

      out.push(configured
        ? {
            name: "Inbound webhook URL",
            level: configured === expected ? "good" : "warn",
            detail: `Twilio is configured to call ${configured}. This deployment answers at ${expected}.`,
            fix: configured === expected ? undefined
              : "These differ. That is usually fine — the signature is checked against whichever address the request actually arrives on — but if texts are not landing, make them identical in Twilio Console → Messaging → Services → your service → Integration.",
          }
        : {
            name: "Inbound webhook URL",
            level: "bad",
            detail: svc.useInboundWebhookOnNumber
              ? "The Messaging Service is set to defer to each phone number's own webhook, and no service-level URL is set."
              : "No inbound request URL is set on the Messaging Service.",
            fix: `Twilio Console → Messaging → Services → your service → Integration → "Send a webhook", and set the request URL to ${expected}.`,
          });
    } catch (e) {
      out.push({ name: "Inbound webhook URL", level: "warn",
        detail: `Could not read the Messaging Service (${(e as Error).message}).` });
    }
  }

  return out;
}
