"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Finishing a job from a phone, standing in the yard.
 *
 *  A photo or a reason -- the database refuses a job marked done with neither,
 *  and that rule is the point of the whole flow: one picture of a dry floor
 *  proves nothing without the picture of the wet one. The reason box exists
 *  because some work genuinely has nothing to show (a reset breaker, a
 *  lock-out), and a rule with no honest exception gets worked around. */
export default function JobDone({ token, jobId }: { token: string; jobId: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [why, setWhy] = useState("");
  const [showWhy, setShowWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const files = file.current?.files;
    const waiver = why.trim();
    if (!files?.length && waiver.length < 10) {
      setError(files?.length === 0 && showWhy
        ? "Please write a sentence about why there is no photo."
        : "Add a photo of the finished work, or say why there isn't one.");
      setShowWhy(true);
      return;
    }
    setBusy(true); setError(null);

    const form = new FormData();
    form.set("jobId", jobId);
    if (waiver) form.set("waiver", waiver);
    for (const f of files ?? []) form.append("photos", f);

    const res = await fetch(`/api/jobs/${token}/complete`, { method: "POST", body: form });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't go through. Try again."); return; }
    router.refresh();
  }

  return (
    <div className="jobdone">
      {error && <p className="err">{error}</p>}

      <label className="shotbtn">
        {/* capture prompts the camera directly on a phone, which is where this
            is used; on a laptop it falls back to the file picker. */}
        <input ref={file} type="file" accept="image/*" capture="environment" multiple
               onChange={(e) => setCount(e.target.files?.length ?? 0)} />
        <span>{count ? `${count} photo${count === 1 ? "" : "s"} ready` : "Add photo of finished work"}</span>
      </label>

      {showWhy && (
        <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)}
                  placeholder="No photo? Say what you did and why there's nothing to show." />
      )}

      <div className="jobacts">
        {!showWhy && (
          <button type="button" className="mini" onClick={() => setShowWhy(true)}>
            No photo?
          </button>
        )}
        <button type="button" className="mini primary" onClick={submit} disabled={busy}>
          {busy ? "Sending…" : "Mark done"}
        </button>
      </div>
    </div>
  );
}
