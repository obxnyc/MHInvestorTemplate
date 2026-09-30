"use client";
import { isImagePath, nameOf } from "@/lib/attachments";

/**
 * One attachment, rendered as the thing it is.
 *
 * A photograph is the message -- a cracked pipe is not described, it is
 * shown -- so it renders inline and opens full size in a new tab. Everything
 * else is a file somebody needs to open in another application, and a 400
 * pixel grey rectangle pretending to be a preview helps nobody; it renders as
 * a line with its name on it.
 *
 * `src` is a signed URL with minutes on it. When it is missing -- because the
 * thread was left open past the expiry, or because the object is gone -- the
 * row still appears, saying so. An attachment that silently vanishes from a
 * maintenance thread is worse than one that says it cannot be fetched.
 */
export default function Attachment({ path, src }: { path: string; src?: string }) {
  const name = nameOf(path);

  if (!src) return <span className="mms-gone">{name} — unavailable</span>;

  if (isImagePath(path)) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="shot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="mms" loading="lazy" />
      </a>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="filechip"
       // Named for the person saving it, rather than the storage key.
       download={name}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
           fill="none" stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v5h5" /><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2Z" />
      </svg>
      {name}
    </a>
  );
}
