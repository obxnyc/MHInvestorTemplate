"use client";
import { useCallback, useEffect, useState } from "react";
import SignaturePad from "@/components/SignaturePad";

type Said = {
  title: string; toName: string; pack: string;
  signedAt: string | null; signedName: string | null;
  places: number; expiresAt: string;
};

/**
 * Reading it, and signing it.
 *
 * The documents are shown in full before anything can be signed, because
 * that is the whole of what a signature means. Nothing on this page
 * regenerates them: what is drawn is the text that was frozen when it was
 * sent, and after signing it is the text that was signed.
 */
export default function SignHere({ token }: { token: string }) {
  const [said, setSaid] = useState<Said | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [ink, setInk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/sign/${token}`, { cache: "no-store" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setStopped(out.error ?? "This link does not work."); return; }
      setSaid(out);
      setName((n) => n || out.toName || "");
    } catch {
      setStopped("These documents could not be loaded. Try again in a moment.");
    }
  }, [token]);
  useEffect(() => { void read(); }, [read]);

  const sign = async () => {
    if (!ink) return;
    setBusy(true); setWrong(null);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ png: ink, name, agreed }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        setWrong(out.error ?? "That did not go through. Nothing has been signed.");
        return;
      }
      /* Nothing is called signed until the server says it is, and what is
         then shown is the copy it sent back -- the one it is holding. */
      setSaid((was) => was && { ...was, pack: out.pack,
        signedAt: new Date().toISOString(), signedName: name });
    } catch (e) {
      setWrong(e instanceof Error ? e.message
        : "That did not go through. Nothing has been signed.");
    } finally { setBusy(false); }
  };

  if (stopped) {
    return (
      <div className="signpage">
        <h1>Larabee Homes</h1>
        <p className="err">{stopped}</p>
      </div>
    );
  }
  if (!said) return <div className="signpage"><p className="dim">Reading…</p></div>;

  const done = Boolean(said.signedAt);

  return (
    <div className="signpage">
      <header className="noprint">
        <h1>{said.title}</h1>
        {done ? (
          <p className="signdone">
            Signed by <strong>{said.signedName}</strong> on{" "}
            {new Date(said.signedAt as string).toLocaleDateString("en-US",
              { dateStyle: "long" })}. This copy is yours to keep — print it
            or save it as a PDF from your browser.
          </p>
        ) : (
          <p className="dim">
            {said.toName}, please read these and sign at the bottom. There
            {said.places === 1 ? " is one place" : ` are ${said.places} places`}{" "}
            for your signature and they are all filled in at once. Nothing is
            signed until you press the button.
          </p>
        )}
      </header>

      <div className="paper" dangerouslySetInnerHTML={{ __html: said.pack }} />

      {!done && (
        <div className="signbox noprint">
          <h2>Your signature</h2>
          {ink ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="signhave" src={ink} alt="Your signature" />
              <button type="button" className="btn" disabled={busy}
                      onClick={() => setInk(null)}>
                Do it again
              </button>
            </>
          ) : (
            <SignaturePad png={null} busy={false} said={null}
                          defaultName={said.toName}
                          onSave={(v) => setInk(v)}
                          onClear={() => setInk(null)} />
          )}

          <label className="signname">Your full name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          {/* Intent, asked for in words. A mark without it is a picture of
              a signature. */}
          <label className="papertickone">
            <input type="checkbox" checked={agreed}
                   onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              I have read these documents and I intend this to be my
              signature on them, with the same effect as signing on paper.
            </span>
          </label>

          <div className="paperacts">
            <button type="button" className="btn pri"
                    disabled={busy || !ink || !agreed || name.trim().length < 2}
                    onClick={() => void sign()}>
              {busy ? "Signing…" : "Sign these documents"}
            </button>
            {wrong && <span className="err">{wrong}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
