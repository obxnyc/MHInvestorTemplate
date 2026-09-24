import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "attachments";

/** Twilio serves inbound MMS from its own domain, behind your account
 *  credentials, and deletes it when the message is deleted. So a media URL is
 *  not a photograph you own -- it is a loan, and one that renders as a broken
 *  image in any <img> tag because the browser has no credentials to send.
 *
 *  Every inbound picture is therefore copied into our own private bucket on
 *  receipt, and the Twilio URL is not kept. */

/** What a phone can actually send, and nothing else. The list is deliberately
 *  short: this bucket is read back into an <img> on a staff member's phone, and
 *  anything outside these types has no business being rendered there. */
const ACCEPTED = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/3gpp",
]);

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/3gpp": "3gp",
};

/** Carriers cap MMS well below this; the headroom is for the video a modern
 *  handset will happily send. The cap exists so a malformed or hostile
 *  Content-Length cannot pull an unbounded body into a serverless function. */
const MAX_BYTES = 16 * 1024 * 1024;

export type StoredMedia = { paths: string[]; failed: number };

/** A Twilio media URL, narrowly. Anything else in NumMedia is not ours to
 *  fetch: the webhook body is signed, but a signature only proves Twilio sent
 *  the request, not that every URL inside it points back at Twilio. Fetching
 *  an arbitrary URL from the server with credentials attached is how a
 *  server-side request forgery starts. */
function isTwilioMedia(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:"
      && (u.hostname === "api.twilio.com" || u.hostname.endsWith(".twilio.com"));
  } catch {
    return false;
  }
}

/** Copy one message's media into storage, returning the paths to record.
 *
 *  A failure here must never cost the message. A maintenance request that
 *  arrives without its photograph is a nuisance; one that is dropped because
 *  the photograph could not be fetched is a repair nobody knows about. So each
 *  item fails on its own and the count comes back for the caller to note. */
export async function storeInboundMedia(
  db: SupabaseClient,
  conversationId: string,
  messageSid: string,
  urls: string[],
): Promise<StoredMedia> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

  const paths: string[] = [];
  let failed = 0;

  for (const [i, url] of urls.entries()) {
    if (!isTwilioMedia(url)) {
      // Worth a line of its own. Every other failure here is an accident; a
      // media URL that does not point at Twilio is the one that would mean
      // something is wrong upstream, and it should not be the only kind that
      // passes silently.
      console.error("refused non-Twilio media URL", { conversationId, messageSid, url });
      failed++;
      continue;
    }
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (!res.ok) throw new Error(`twilio media ${res.status}`);

      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!ACCEPTED.has(type)) throw new Error(`unsupported media type ${type}`);

      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new Error("media too large");

      const bytes = new Uint8Array(await res.arrayBuffer());
      // Checked again after reading: Content-Length is a claim, not a promise.
      if (bytes.byteLength > MAX_BYTES) throw new Error("media too large");

      const path = `conversations/${conversationId}/${messageSid}/${i}.${EXTENSION[type]}`;
      const { error } = await db.storage.from(BUCKET)
        .upload(path, bytes, { contentType: type, upsert: true });
      if (error) throw error;

      paths.push(path);
    } catch (e) {
      // Logged, counted, and then stepped over.
      console.error("media copy failed", { conversationId, messageSid, index: i, e });
      failed++;
    }
  }

  return { paths, failed };
}

/** Signed URLs for rendering. Short-lived on purpose: the link ends up in
 *  browser history, in the page source, and in whatever a phone does with an
 *  image cache, so it should stop working long before any of those are
 *  interesting to anyone. */
export async function signMedia(
  db: SupabaseClient, paths: string[], seconds = 300,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;

  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, seconds);
  if (error) {
    console.error("signing media failed", error);
    return out;
  }
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}
