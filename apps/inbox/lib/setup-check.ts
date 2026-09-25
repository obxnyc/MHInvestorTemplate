/** What is actually wired up on this deployment, and what is not.
 *
 *  This exists because the useful facts about a running deployment live in
 *  places nobody can see. A hosting dashboard stores secrets write-only, so the
 *  value in the box can never be read back. A webhook failure is recorded as a
 *  status code in one console and a truncated log line in another. The result
 *  is that diagnosing "my text did not arrive" turns into pasting credentials
 *  again and hoping, which is guessing with extra steps.
 *
 *  So the server -- which can see all of it -- answers the questions directly.
 *
 *  No secret is ever returned. What is reported is shape (a Twilio auth token
 *  is 32 hex characters), presence, and the outcome of actually using the
 *  credential: it signs in to Twilio and says whether it was let in. That last
 *  one is the only check a plausible-looking wrong value cannot pass, which is
 *  why it is here.
 *
 *  Kept out of the page component and read by both the page and a JSON route.
 *  A diagnostic is only useful if it can be reached when something is broken,
 *  and in production a server component that throws renders as an opaque digest
 *  with the message stripped -- so the same checks are also served as JSON,
 *  where the failure explains itself. */
import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type Level = "good" | "bad" | "warn";
export type Check = { name: string; level: Level; detail: string; fix?: string };

/** The top-level entry point. It cannot throw: every check is guarded, and the
 *  guards are not decoration. The first version of this crashed on a malformed
 *  account SID -- the Twilio client validates its arguments in the constructor
 *  -- which meant the one thing that could not survive a bad credential was the
 *  page whose whole job is to explain one. */
export async function runSetupChecks(
  origin: string,
  asUser?: SupabaseClient,
): Promise<Check[]> {
  return [
    buildCheck(),
    ...guard("Required settings", envChecks),
    ...(await guardAsync("Twilio", () => twilioChecks(origin))),
    ...(await guardAsync("Anthropic", anthropicChecks)),
    ...(await guardAsync("Delivery", deliveryChecks)),
    ...(await guardAsync("Database", databaseChecks)),
    ...(asUser ? await guardAsync("Visibility", () => visibilityChecks(asUser)) : []),
  ];
}

function guard(name: string, run: () => Check[]): Check[] {
  try {
    return run();
  } catch (e) {
    return [{ name, level: "bad", detail: `This check could not run: ${(e as Error).message}` }];
  }
}

async function guardAsync(name: string, run: () => Promise<Check[]>): Promise<Check[]> {
  try {
    return await run();
  } catch (e) {
    return [{ name, level: "bad", detail: `This check could not run: ${(e as Error).message}` }];
  }
}

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

/**
 * Whether the key WORKS, not whether a string is present.
 *
 * Presence is the answer to a question nobody has. A key can be in Vercel and
 * absent from the running build because settings are read when a build is
 * made; it can be present and rejected; it can be present and out of credit.
 * All three produce untranslated Spanish and no drafted replies, and all three
 * are fixed differently -- so this asks Anthropic rather than asking
 * process.env.
 *
 * It sends a real one-token message rather than listing models. Listing models
 * authenticates without touching the paid path, so an account with no billing
 * -- Console's free "Evaluation access" plan -- passes that and then fails
 * every actual call. A check that goes green while the feature stays dark is
 * worse than no check. This costs a fraction of a cent and answers the
 * question that was actually asked.
 */
async function anthropicChecks(): Promise<Check[]> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const OFF = "Spanish is not translated, replies cannot be drafted, and the"
    + " classifier falls back to keyword matching.";

  if (!key) {
    return [{
      name: "ANTHROPIC_API_KEY", level: "warn",
      detail: `Not in this build. ${OFF} Nothing is broken — those three are off.`,
      fix: "If it is already in Vercel, it was added after the last deploy:"
        + " settings are read at build time, so redeploy. Otherwise add it —"
        + " Vercel → Settings → Environment Variables, Type SECRET, all three"
        + " environments — then redeploy.",
    }];
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    await new Anthropic({ apiKey: key }).messages.create({
      model: "claude-opus-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return [{
      name: "ANTHROPIC_API_KEY", level: "good",
      detail: "Present, accepted, and the account can actually make calls."
        + " Translation, drafted replies and the classifier are live.",
    }];
  } catch (e) {
    const status = (e as { status?: number }).status;
    const said = String((e as Error).message ?? "");
    // The one that does not look like what it is. An account on Console's free
    // evaluation plan has a valid key and no billing, and the refusal mentions
    // the credit balance rather than saying "set up billing".
    const noCredit = /credit balance|billing|purchase|too low/i.test(said);

    return [{
      name: "ANTHROPIC_API_KEY", level: "bad",
      detail: noCredit
        ? `The key works, but the Anthropic account has no billing set up. ${OFF}`
        : `Present (${shape(key)}) but the call failed`
          + `${status ? ` with ${status}` : ""}. ${OFF}`,
      fix: noCredit
        ? "console.anthropic.com → Set up billing, add a card and buy credit."
          + " The free Evaluation access plan cannot call the API. No redeploy"
          + " needed afterwards — it starts working straight away."
        : status === 401
          ? "The key is wrong or revoked. Make a new one at console.anthropic.com →"
            + " API keys, paste the WHOLE value, redeploy."
          : status === 429
            ? "Rate limited. Wait, or check console.anthropic.com → Billing."
            : `Anthropic said: ${said.slice(0, 160)}`,
    }];
  }
}

/** The checks that require asking Twilio rather than looking at a string. */
async function twilioChecks(origin: string): Promise<Check[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const mg = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!sid || !token) return [];

  const out: Check[] = [];

  // The constructor validates: a SID that is not AC + 32 hex throws here, not
  // at the first request. That throw is the whole reason this is guarded.
  let client: ReturnType<typeof twilio>;
  try {
    client = twilio(sid, token);
  } catch (e) {
    return [{ name: "Twilio sign-in", level: "bad",
      detail: `The credentials are malformed, so no request was attempted: ${(e as Error).message}`,
      fix: "Re-copy the Account SID and the Auth Token from Twilio Console home → Account Info, paste both into Vercel, then redeploy." }];
  }

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
      // The OTHER callback, and the one that decides whether a message ever
      // stops saying "Sending". Twilio posts a delivery receipt per message;
      // if that post goes somewhere this deployment does not answer, the row
      // stays queued for ever and the portal quietly claims a message is still
      // in flight days later.
      //
      // The reply routes pass a statusCallback per message, which wins. A
      // service-level one pointing somewhere stale is still worth seeing,
      // because it is what a message sent by anything else will use.
      const onService = (svc.statusCallback ?? "").trim();
      const wantStatus = `${origin}/api/twilio/status`;
      out.push(!onService
        ? { name: "Delivery receipts", level: "warn",
            detail: "No status callback on the Messaging Service. Messages sent"
              + " from this app carry their own, so receipts should still arrive;"
              + " anything sent another way will not report delivery.",
            fix: `Optional, but set it: Twilio Console → Messaging → Services → your service → Integration → Status callback → ${wantStatus}` }
        : onService === wantStatus
          ? { name: "Delivery receipts", level: "good",
              detail: `Twilio reports delivery to ${onService}.` }
          : { name: "Delivery receipts", level: "warn",
              detail: `Twilio reports delivery to ${onService}, but this deployment answers at ${wantStatus}.`,
              fix: "If messages sit on \"Sending\" and never say Delivered, this is"
                + " the first thing to fix: Twilio Console → Messaging → Services →"
                + " your service → Integration → Status callback." });
    } catch (e) {
      out.push({ name: "Inbound webhook URL", level: "warn",
        detail: `Could not read the Messaging Service (${(e as Error).message}).` });
    }
  }

  return out;
}


/**
 * Are delivery receipts actually arriving?
 *
 * Every other check here asks a service how it is configured. This one asks
 * our own data whether the configuration is working, which is a different
 * question and the only one that matters: a message still sitting on "queued"
 * twenty minutes after it was accepted means Twilio's receipt never landed,
 * whatever the console says the URL is.
 */
async function deliveryChecks(): Promise<Check[]> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();

  const [{ count: stuck }, { count: settled }] = await Promise.all([
    db.from("messages").select("id", { count: "exact", head: true })
      .eq("direction", "outbound").eq("status", "queued").lt("created_at", cutoff),
    db.from("messages").select("id", { count: "exact", head: true })
      .eq("direction", "outbound").in("status", ["delivered", "sent", "undelivered", "failed"]),
  ]);

  if (!stuck) {
    return [{ name: "Delivery receipts arriving", level: "good",
      detail: settled
        ? `Nothing stuck. ${settled} message${settled === 1 ? " has" : "s have"} reported back.`
        : "Nothing stuck, and nothing has been sent yet to report back." }];
  }

  return [{
    name: "Delivery receipts arriving", level: "bad",
    detail: `${stuck} outbound message${stuck === 1 ? "" : "s"} still say "Sending"`
      + ` twenty minutes after being accepted by Twilio.`
      + (settled ? ` ${settled} others did report back.` : " None have ever reported back.")
      + " Twilio accepted them, so they probably went out; the receipt is what is missing.",
    fix: "Twilio Console → Monitor → Logs → Messaging, find one of them and look"
      + " at the delivery-callback attempts. A 403 there means the signature check"
      + " is rejecting it; a 404 or a redirect means the URL points somewhere else.",
  }];
}

/** The half of the pipeline the Twilio console cannot see.
 *
 *  A webhook that passes its signature check and then cannot write is
 *  indistinguishable, from the outside, from one that was never called: the
 *  text simply does not appear. These two checks separate those cases, which
 *  is the difference between re-pasting a key and going to look at the list. */
async function databaseChecks(): Promise<Check[]> {
  const out: Check[] = [];

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  // The shape first, because the commonest failure is a truncated paste and it
  // can be named without asking anyone anything. A Supabase key is either a
  // JWT (three dot-separated parts, starting "eyJ") or the newer sb_secret_
  // format. Anything else is not a key.
  const looksJwt = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key);
  const looksNew = key.startsWith("sb_secret_");
  if (!looksJwt && !looksNew) {
    return [{ name: "SUPABASE_SERVICE_ROLE_KEY", level: "bad",
      detail: key
        ? `Not shaped like a Supabase key: ${key.length} characters, ${key.split(".").length} part(s). A service_role key is a JWT beginning "eyJ" with three parts, or begins "sb_secret_".`
        : "Not set.",
      fix: "Supabase → Project Settings → API Keys → the Legacy tab → service_role. Use the copy button, paste into Vercel, then redeploy." }];
  }

  // Then ask the database, over plain HTTP rather than through the client
  // library -- which reports a refused key as an error object with an empty
  // message, and an empty message is how an evening gets spent. The status code
  // and the body are what actually say what happened.
  let probe: { status: number; body: string };
  try {
    const res = await fetch(`${url}/rest/v1/staff?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    probe = { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch (e) {
    return [{ name: "Database (service role)", level: "bad",
      detail: `Could not reach ${url}: ${(e as Error).message}`,
      fix: "Check NEXT_PUBLIC_SUPABASE_URL in Vercel — it should look like https://xxxxxxxx.supabase.co." }];
  }

  if (probe.status !== 200) {
    return [{ name: "Database (service role)", level: "bad",
      detail: `The database refused the server's key. HTTP ${probe.status}: ${probe.body}`,
      fix: probe.status === 401
        ? "That key is not accepted. Supabase → Project Settings → API Keys → Legacy tab → service_role, copy it whole, paste into Vercel, redeploy. It is a long JWT — make sure none of it is missing."
        : "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." }];
  }

  const db = supabaseAdmin();
  out.push({ name: "Database (service role)", level: "good",
    detail: "The server can read and write." });

  // Whether anything has actually arrived. This is the question being asked
  // when someone says "I texted it and nothing came up", and it has two very
  // different answers.
  const { data: recent } = await db
    .from("messages")
    .select("created_at, body")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1);

  const last = recent?.[0];
  out.push(last
    ? { name: "Inbound texts", level: "good",
        detail: `The most recent one arrived ${new Date(last.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })} and reads "${String(last.body).slice(0, 60)}". Texts are landing; if one is not visible, it is the list that is hiding it, not the webhook.` }
    : { name: "Inbound texts", level: "warn",
        detail: "No inbound text has ever been stored. Twilio is reaching the webhook, but nothing has made it into the database.",
        fix: "Send one now and reload this page. If it still says none, the webhook is failing after the signature check — the reason will be in Vercel → Logs." });

  return out;
}

/** What the signed-in person can actually see, as opposed to what is stored.
 *
 *  Row-level security is invisible when it is wrong: a policy that matches
 *  nothing returns an empty list, which is indistinguishable from an empty
 *  table. A thread that stores six messages and displays none looks like a
 *  rendering bug and is not one. So this compares the two counts directly --
 *  what the service role can see, and what this person can -- and reports the
 *  query error that the page throws away. */
async function visibilityChecks(asUser: SupabaseClient): Promise<Check[]> {
  const admin = supabaseAdmin();

  const { data: newest } = await admin
    .from("conversations").select("id")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1);
  const id = newest?.[0]?.id;
  if (!id) {
    return [{ name: "Thread visibility", level: "warn",
      detail: "No conversation exists yet, so there is nothing to compare." }];
  }

  const stored = await admin
    .from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", id);

  // Deliberately the same shape the thread page uses, embedded author and all:
  // a policy can permit the row and a column grant still refuse the join, and
  // those two failures look identical from the outside.
  const seen = await asUser
    .from("messages")
    .select("id, direction, body, status, channel, created_at, media_paths, staff:sent_by(full_name)")
    .eq("conversation_id", id);

  if (seen.error) {
    return [{ name: "Thread visibility", level: "bad",
      detail: `The thread query fails for a signed-in user: ${seen.error.message}${seen.error.hint ? ` (${seen.error.hint})` : ""}${seen.error.code ? ` [${seen.error.code}]` : ""}`,
      fix: "This is an application bug, not a setting. Nothing to paste." }];
  }

  const storedCount = stored.count ?? 0;
  const seenCount = seen.data?.length ?? 0;
  return [seenCount === storedCount
    ? { name: "Thread visibility", level: "good",
        detail: `The newest conversation holds ${storedCount} message${storedCount === 1 ? "" : "s"}, and you can see all of them.` }
    : { name: "Thread visibility", level: "bad",
        detail: `The newest conversation holds ${storedCount} message${storedCount === 1 ? "" : "s"}, but you can see ${seenCount}. Row-level security is hiding them.`,
        fix: "Run docs/shared-line/rls-messages.sql in the Supabase SQL editor." }];
}

/** Which build is actually being served.
 *
 *  Added after an evening spent asking "is it deployed yet" and answering from
 *  the wrong side of the wire. A fix that exists in the repository and a fix
 *  that is running are different things, and confusing them cost more time here
 *  than any bug did. The hosting platform puts the commit in the environment;
 *  it just has to be shown. */
function buildCheck(): Check {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
  const msg = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  return {
    name: "Running build",
    level: "good",
    detail: sha
      ? `Commit ${sha}${msg ? ` — ${msg.split("\n")[0]}` : ""}.`
      : "This deployment does not report a commit (running locally, or built outside the hosting platform).",
  };
}