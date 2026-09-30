/**
 * What counts as an attachment, by name and by type.
 *
 * Kept apart from lib/media on purpose. That module reads Twilio credentials
 * and talks to storage, and a browser component importing one pure function
 * from it would pull the whole thing into the client bundle. These are string
 * and lookup-table decisions with no I/O in them, so both sides can import
 * this and neither drags the other along.
 */

/**
 * Two lists, because there are two different questions.
 *
 * A carrier decides the first one. MMS is specified for JPEG, PNG and GIF;
 * Twilio will carry a PDF and a vCard on top of that, and everything else is
 * transcoded if we are lucky and silently dropped if we are not. Sending a
 * spreadsheet to a phone is not a thing that works, however much the file
 * picker implies otherwise.
 *
 * We decide the second. A lease, a ledger, a spreadsheet of a tenant's
 * payment history -- these belong on the conversation even though no phone
 * will ever receive them, because the next person to pick up the thread needs
 * them. Those attach to notes, which are internal and go nowhere.
 *
 * Both are allowlists rather than a blocklist, and both refuse the scriptable
 * types. This bucket is read back through signed URLs that a browser opens
 * directly, and Supabase serves an object with the content type it was stored
 * under, so accepting text/html or image/svg+xml would be accepting a script
 * that runs on our own origin whenever somebody clicks an attachment.
 */
const SENDABLE: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "application/pdf": "pdf",
  "text/vcard": "vcf", "text/x-vcard": "vcf",
};

/** Everything above, plus what we will hold but never put on a wire. */
const KEEPABLE: Record<string, string> = {
  ...SENDABLE,
  "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "image/bmp": "bmp", "image/tiff": "tif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/3gpp": "3gp",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg",
  "text/plain": "txt", "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/rtf": "rtf",
  "application/zip": "zip",
};

/** Twilio's own ceiling is 5 MB for a whole message. Carriers are far meaner
 *  -- most cut off near 600 KB and simply do not deliver what is bigger, with
 *  no error anybody sees -- so the browser shrinks photographs before they get
 *  here, and this is the backstop for everything that arrives another way. */
export const MAX_SEND_BYTES = 5 * 1024 * 1024;

/** A file kept for the team rather than sent to a phone can be bigger, because
 *  nothing but our own storage has to carry it. Still bounded: an unbounded
 *  upload is a way to fill a bucket. */
export const MAX_KEEP_BYTES = 25 * 1024 * 1024;

const clean = (t: string) => t.split(";")[0].trim().toLowerCase();

/** The extension for a type, or null for one we will not take. Returns null
 *  rather than throwing because the caller wants to tell somebody which file
 *  was refused, by name. */
export function keepableExtension(type: string): string | null {
  return KEEPABLE[clean(type)] ?? null;
}

/** Whether a carrier will actually carry it. Separate from whether we will
 *  store it -- see the two lists above. */
export function isSendable(type: string): boolean {
  return clean(type) in SENDABLE;
}

/** True for a path a carrier can carry, worked out from the extension because
 *  by the time a message is being sent the MIME type is long gone. */
export function pathIsSendable(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return Object.values(SENDABLE).includes(ext);
}

export function sendableTypes(): string[] {
  return Object.keys(SENDABLE);
}

export function keepableTypes(): string[] {
  return Object.keys(KEEPABLE);
}

/** A filename that is safe as a storage key and still recognisable to a
 *  person.
 *
 *  Keeping the name at all is the point. An attachment called `0.pdf` is a
 *  file nobody opens twice; `March-ledger.pdf` is the thing somebody was
 *  looking for. It rides in the path because `media_paths` is a text array
 *  that four other pieces of code already read, and widening that into a
 *  table of file records to carry one string would be a migration for a
 *  label.
 *
 *  Everything outside [A-Za-z0-9._-] goes, which takes with it the slash that
 *  would create a folder, the `..` that would climb out of one, and the
 *  unicode that makes a filename render as something it is not. */
export function safeName(name: string, ext: string): string {
  const base = (name.replace(/\.[^.]*$/, "") || "file")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return `${base || "file"}.${ext}`;
}

/** The name back out of a path, for showing next to the attachment. */
export function nameOf(path: string): string {
  const last = path.split("/").pop() ?? path;
  // Stored as `<n>-<name>.<ext>`; the index is ours and means nothing to a
  // person looking at a list of files.
  return last.replace(/^\d+-/, "") || last;
}

/** Whether to render it as a picture or as something to open. */
export function isImagePath(path: string): boolean {
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(path);
}

/** Is this storage path one of THIS conversation's attachments?
 *
 *  The browser sends back paths it was given by the attach route, and a
 *  browser can send back anything. Without this check, replying to your own
 *  conversation while naming another conversation's path would text a
 *  stranger's photographs to your own phone -- an authorization hole that
 *  reads, in the code, as merely passing a string along. */
export function belongsToConversation(path: string, conversationId: string): boolean {
  return path.startsWith(`conversations/${conversationId}/`)
    && !path.includes("..");
}
