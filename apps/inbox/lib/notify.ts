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
