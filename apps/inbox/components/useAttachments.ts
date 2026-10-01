"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { shrink } from "@/lib/shrink";

export type Attached = {
  /** The storage path, which is what a send carries. */
  path: string;
  /** What the person called it. */
  name: string;
  /** Whether a carrier will take it. False for a spreadsheet, which is a
   *  perfectly good note and an impossible text. */
  sendable: boolean;
  /** An object URL for images, so a thumbnail appears the instant the file is
   *  picked rather than after a round trip. */
  preview?: string;
};

const isImage = (f: File) => f.type.startsWith("image/");

/** Ten is Twilio's own ceiling for media on one message, and well past what
 *  anybody sends deliberately. */
const LIMIT = 10;

/**
 * Files picked, shrunk, and uploaded -- before anybody presses send.
 *
 * The upload runs on choosing, not on sending. Joining the two would mean the
 * send button does nothing visible for eight seconds on a phone in a
 * crawlspace, and the person presses it again, which is how a tenant gets the
 * same photograph twice.
 *
 * A hook rather than a component because three different things have to feed
 * it: the paperclip, a drag onto the composer, and a paste. The paste is the
 * one that matters most and is missing from nearly everything -- a screenshot
 * of a ledger goes Cmd+Shift+4, Cmd+V, and never touches a disk.
 */
export function useAttachments(endpoint: string) {
  const [items, setItems] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  // Revoked when this unmounts rather than per item: an object URL revoked
  // while its <img> is still on screen leaves a broken thumbnail, and the
  // handful of bytes are not worth that.
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);

  // Read inside `take` through a ref so that adding files does not need a new
  // callback every time the list changes -- otherwise every paste handler and
  // drop listener is re-registered on each upload.
  const current = useRef(items);
  current.current = items;

  const take = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setProblem(null);

    const room = LIMIT - current.current.length;
    if (room <= 0) { setProblem(`${LIMIT} attachments is the limit.`); return; }
    const batch = files.slice(0, room);
    if (batch.length < files.length) setProblem(`Only the first ${room} were taken.`);

    setBusy((n) => n + batch.length);
    try {
      // Shrunk first, in parallel, and only then sent. A photograph becomes
      // roughly a tenth of its size here, which is the difference between a
      // send that works on one bar and one that times out.
      const ready = await Promise.all(batch.map(shrink));

      const form = new FormData();
      for (const f of ready) form.append("file", f, f.name);

      const res = await fetch(endpoint, { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setProblem(out.error ?? "That didn't upload. Try again."); return; }

      // Indexes line up with `ready` because the route keeps refused files in
      // a separate list and never reorders what it accepted.
      const added: Attached[] = (out.files ?? []).map(
        (f: { path: string; name: string; sendable: boolean }, i: number) => {
          const src = ready[i];
          let preview: string | undefined;
          if (src && isImage(src)) {
            preview = URL.createObjectURL(src);
            urls.current.push(preview);
          }
          return { ...f, preview };
        });

      if (out.refused?.length) {
        setProblem(out.refused
          .map((r: { name: string; why: string }) => `${r.name}: ${r.why}`)
          .join(" · "));
      }
      if (added.length) setItems((prev) => [...prev, ...added]);
    } catch {
      setProblem("That didn't upload. Try again.");
    } finally {
      setBusy((n) => Math.max(0, n - batch.length));
    }
  }, [endpoint]);

  const remove = useCallback((path: string) => {
    setItems((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const clear = useCallback(() => { setItems([]); setProblem(null); }, []);

  return { items, busy, problem, take, remove, clear, setProblem };
}
