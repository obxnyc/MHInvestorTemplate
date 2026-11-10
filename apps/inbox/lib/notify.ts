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

/** Optional: set POSTMARK_SERVER_TOKEN to also email. A decline explanation
 *  reads better in email than in a 160-character text. */
export async function sendEmail(to: string, subject: string, text: string) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token || !to) return;
  try {
    await fetch("https://api.postmarkapp.com/email", {
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
  } catch (e) {
    console.error("email send failed", e);
  }
}

/**
 * Email that says whether it went.
 *
 * `sendEmail` above is best-effort on purpose -- it sits in request paths
 * that must not fail because a mail server hiccupped. A scheduled report is
 * the opposite case: nobody is watching it go, so if it did not go, the
 * only place that can say so is the answer this returns. A missing token
 * and a refused send both come back as reasons rather than as silence.
 */
export async function sendEmailChecked(
  to: string[], subject: string, text: string, html?: string,
): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { ok: false, detail: "POSTMARK_SERVER_TOKEN is not set, so nothing can be emailed." };
  if (!to.length) return { ok: false, detail: "Nobody is on the list for today." };
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: process.env.POSTMARK_FROM ?? "leasing@larabeehomesllc.com",
        To: to.join(", "), Subject: subject, TextBody: text,
        ...(html ? { HtmlBody: html } : {}),
        MessageStream: "outbound",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    // Postmark answers 200 with ErrorCode 0 on success; anything else is a
    // refusal whose Message says why (an unverified sender, most often).
    let code: number | null = null;
    let message = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { ErrorCode?: number; Message?: string };
      code = typeof j.ErrorCode === "number" ? j.ErrorCode : null;
      message = j.Message ?? message;
    } catch { /* not JSON; the text is the detail */ }
    if (res.ok && (code === 0 || code === null)) return { ok: true, detail: `sent to ${to.join(", ")}` };
    return { ok: false, detail: `Postmark refused it (${res.status}${code !== null ? `, code ${code}` : ""}): ${message}` };
  } catch (e) {
    return { ok: false, detail: `could not reach Postmark: ${(e as Error).message}` };
  }
}
