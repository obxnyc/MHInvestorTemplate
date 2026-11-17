/**
 * Whether this deployment can send an email at all.
 *
 * Kept out of `setup-check.ts` so the four answers below can be asked of it
 * directly. Each one is a different real state with a different fix, and
 * three of them are invisible from outside.
 */

/** The same three levels the setup page uses. Repeated rather than imported
 *  so this file stays loadable on its own. */
export type Level = "good" | "bad" | "warn";
export type Check = { name: string; level: Level; detail: string; fix?: string };

/** What a credential looks like, never what it is. */
function shape(raw: string | undefined): string {
  if (!raw) return "missing";
  const v = raw.trim();
  if (v !== raw) return "has whitespace around it";
  return `${v.length} characters`;
}

/**
 * Whether this deployment can send an email at all.
 *
 * NOTHING ASKED THIS UNTIL TODAY. Fifteen checks came back green on a
 * deployment where `POSTMARK_SERVER_TOKEN` was not set, which means the
 * morning delinquency report, every vendor invoice, and every decline
 * explanation were going nowhere. The report had in fact built correctly
 * twice and failed to send twice, with the reason written into
 * `report_runs.detail` -- a sentence nobody reads, because the page that
 * people do read said everything was fine.
 *
 * The bookkeeper check even said so in its own `fix` text -- "POSTMARK_
 * SERVER_TOKEN has to be set as well, since it is what actually sends" --
 * and then did not test it. **A green line is worse than a missing one.**
 *
 * So this asks Postmark, the way the Anthropic and Twilio checks ask their
 * services, because presence is the one thing a plausible wrong value also
 * has. `GET /server` is the cheapest call that needs the credential, and its
 * answer carries two things worth saying out loud: the server's name, and
 * whether it is still in Sandbox, where mail is accepted and delivered to
 * nobody.
 */
export async function postmarkChecks(): Promise<Check[]> {
  const token = (process.env.POSTMARK_SERVER_TOKEN ?? "").trim();
  const OFF = "The morning delinquency report, vendor invoices and decline"
    + " explanations are all built correctly and then not sent.";

  if (!token) {
    return [{
      name: "No email can be sent", level: "bad",
      detail: `POSTMARK_SERVER_TOKEN is not set on this build. ${OFF}`
        + " Inbound email is unaffected — that is a different credential, and"
        + " requests are still arriving — so the forward working is not"
        + " evidence that sending does.",
      fix: "Postmark → Servers → the server → API Tokens, copy the SERVER"
        + " token (not the Account token), add it to Vercel as"
        + " POSTMARK_SERVER_TOKEN for Production, and redeploy.",
    }];
  }

  try {
    const res = await fetch("https://api.postmarkapp.com/server", {
      headers: { Accept: "application/json", "X-Postmark-Server-Token": token },
    });
    if (!res.ok) {
      return [{
        name: "Email cannot be sent", level: "bad",
        detail: `POSTMARK_SERVER_TOKEN is present (${shape(token)}) and Postmark`
          + ` refused it with ${res.status}. ${OFF}`,
        fix: res.status === 401
          ? "That is the wrong token. Postmark has an ACCOUNT token and a"
            + " SERVER token and they are not interchangeable; this one has to"
            + " be the server's, from Servers → the server → API Tokens."
          : "Postmark → Activity will say what it refused and why.",
      }];
    }

    const server = await res.json() as { Name?: string; DeliveryType?: string };
    /* Sandbox accepts every send and delivers none of it, so a sandbox
       server and a working one look identical from this end -- the same
       silence-and-success shape as everything else in this file. */
    if (server.DeliveryType === "Sandbox") {
      return [{
        name: "Email is accepted and thrown away", level: "bad",
        detail: `The Postmark server "${server.Name ?? "unnamed"}" is in Sandbox`
          + ` mode. Every send is accepted and delivered to nobody. ${OFF}`,
        fix: "Postmark → Servers → the server → Settings, change Delivery Type"
          + " to Live. That needs the account approved and the sending domain"
          + " verified first.",
      }];
    }

    return [{
      name: "Email can be sent", level: "good",
      detail: `Postmark accepts this token and the server "${server.Name ?? "unnamed"}"`
        + " is live, so the morning report, vendor invoices and decline"
        + " explanations go out.",
    }];
  } catch (e) {
    return [{
      name: "Email sending could not be checked", level: "warn",
      detail: "POSTMARK_SERVER_TOKEN is set, but asking Postmark whether it is"
        + ` any good failed: ${(e as Error).message}. That is this check being`
        + " unable to reach Postmark, not proof that sending is broken.",
    }];
  }
}

