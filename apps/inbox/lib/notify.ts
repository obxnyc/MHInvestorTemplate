import { twilioClient } from "./twilio";

/** Best-effort outbound SMS. Never throws into a request path: an applicant
 *  who has just filled in a form must still see their result even if the
 *  carrier hiccups. */
export async function sendSms(to: string, body: string): Promise<string | null> {
  if (!to || !process.env.TWILIO_MESSAGING_SERVICE_SID) return null;
  try {
    const msg = await twilioClient().messages.create({
      to, body,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallback: `${process.env.PUBLIC_BASE_URL}/api/twilio/status`,
    });
    return msg.sid;
  } catch (e) {
    console.error("sms send failed", e);
    return null;
  }
}

/**
 * Send an email, and say whether it went.
 *
 * This used to return nothing and swallow everything. Three ways it could
 * fail silently, and all three read to the caller exactly like a send that
 * worked:
 *
 *   POSTMARK_SERVER_TOKEN not set -- an early return, so on a deployment
 *   where it was never configured NOTHING has ever been emailed and every
 *   message was recorded as sent.
 *
 *   Postmark answering 422 or 401 -- the fetch resolves, so a rejected
 *   message (unsigned sender, inactive recipient, bad token) was a success.
 *
 *   The fetch throwing -- caught, logged to a console nobody is reading, and
 *   returned as though it had gone.
 *
 * That last one is why the reply route's `try { await sendEmail(...);
 * status = "sent" }` could never have recorded a failure: there was nothing
 * to catch. A tenant replied to by email, on a deployment with no Postmark
 * token, saw nothing -- and the office saw their own message sitting in the
 * thread marked as sent.
 *
 * The same shape as the composer that cleared the words before reading the
 * answer, and the Saving.../Saved line, and the merge that was not a
 * deployment: SILENCE AND SUCCESS LOOK IDENTICAL, and the one time they are
 * not the same is the time it matters.
 *
 * Callers that genuinely do not care may ignore the result; the ones putting
 * a message in front of a person must not.
 */
export type Sent = { ok: true } | { ok: false; why: string };

export async function sendEmail(to: string, subject: string, text: string): Promise<Sent> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!to) return { ok: false, why: "There is no email address to send to." };
  if (!token) {
    return { ok: false, why: "Email is not set up on this deployment:"
      + " POSTMARK_SERVER_TOKEN is not set, so nothing was sent." };
  }
  try {
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: process.env.POSTMARK_FROM ?? "leasing@larabeehomesllc.com",
        To: to, Subject: subject, TextBody: text,
        MessageStream: "outbound",
      }),
    });
    if (!r.ok) {
      /* Postmark's own words. Its message names the actual cause -- an
         unconfirmed sender signature, an inactive recipient, a bad token --
         and that sentence is the difference between a fix and an afternoon. */
      const said = await r.text().catch(() => "");
      let why = said.slice(0, 300);
      try {
        const j = JSON.parse(said) as { Message?: string; ErrorCode?: number };
        if (j.Message) why = `${j.Message}${j.ErrorCode ? ` (Postmark ${j.ErrorCode})` : ""}`;
      } catch { /* not JSON; the raw text is better than nothing */ }
      console.error("email send rejected", { status: r.status, why });
      return { ok: false, why: why || `Postmark answered ${r.status}.` };
    }
    return { ok: true };
  } catch (e) {
    console.error("email send failed", e);
    return { ok: false, why: `The email could not be handed over: ${(e as Error).message}` };
  }
}
