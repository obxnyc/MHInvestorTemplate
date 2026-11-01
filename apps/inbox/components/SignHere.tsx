"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * SIXTEEN SIGNATURES, ONE AT A TIME. The first version put a single pad at
 * the bottom and filled every slot from it, and the owner's words for that
 * were "it only allows you to sign at the bottom and one blanket
 * signature". Nobody signing a stack of papers signs once at the end; they
 * are walked to each line. So this takes the signature once, then steps to
 * each place in turn and will not finish until every one has been visited
 * and put down.
 *
 * What that changes is the ceremony, not the document. The server still
 * fills every slot from the one signature, as it always did, which is why
 * finishing requires all of them placed: a screen that let somebody skip
 * the fourth would be describing a document that cannot exist.
 *
 * The placing is done on the DOM inside the frozen pack rather than by
 * rebuilding it. The pack is the document of record and this page may not
 * rewrite it -- what goes on screen is a preview of where the mark lands,
 * and the signed copy comes back from the server.
 */
export default function SignHere({ token }: { token: string }) {
  const [said, setSaid] = useState<Said | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [ink, setInk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  /** Today, in the browser's own calendar rather than the server's. */
  const today = new Date().toLocaleDateString("en-CA");
  const [on, setOn] = useState(today);

  /** Asking for the signature, before any of it can be placed. */
  const [asking, setAsking] = useState(false);
  /** How many slots there are, and how many have been put down. */
  const [slots, setSlots] = useState(0);
  const [placed, setPlaced] = useState(0);

  const paper = useRef<HTMLDivElement | null>(null);
  /* The adopted signature, reachable from a DOM handler that was attached
     once and must not close over a stale copy of it. */
  const inkNow = useRef<string | null>(null);
  useEffect(() => { inkNow.current = ink; }, [ink]);

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

  const done = Boolean(said?.signedAt);

  /** Every place still waiting, in the order they appear on the page. */
  const empties = useCallback((): HTMLElement[] => {
    const el = paper.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>("span.signslot"))
      .filter((s) => !s.classList.contains("inked"));
  }, []);

  const show = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Mark the one waiting next, so there is somewhere to look. */
  const aim = useCallback(() => {
    const el = paper.current;
    if (!el) return;
    el.querySelectorAll(".signslot.here")
      .forEach((s) => s.classList.remove("here"));
    const next = empties()[0];
    if (next) next.classList.add("here");
    return next;
  }, [empties]);

  /** Put the adopted signature into one place. */
  const put = useCallback((slot: HTMLElement) => {
    const png = inkNow.current;
    if (!png || slot.classList.contains("inked")) return;
    const img = document.createElement("img");
    img.className = "sigink";
    img.src = png;
    img.alt = "Your signature";
    slot.replaceChildren(img);
    slot.classList.add("inked");
    slot.classList.remove("here");
    setPlaced((n) => n + 1);
    const next = aim();
    if (next) show(next);
  }, [aim]);

  /* The slots are inside HTML this page did not write, so they are wired
     once the pack is on screen rather than as JSX. Clicking one is the
     ordinary way to sign it; Next below walks the same path for anybody
     who would rather not aim at a line on a phone. */
  useEffect(() => {
    const el = paper.current;
    if (!el || !said || done) return;
    const found = Array.from(el.querySelectorAll<HTMLElement>("span.signslot"));
    setSlots(found.length);
    const onClick = (ev: Event) => {
      const slot = (ev.currentTarget as HTMLElement);
      if (!inkNow.current) { setAsking(true); return; }
      put(slot);
    };
    found.forEach((s) => {
      s.setAttribute("role", "button");
      s.setAttribute("tabindex", "0");
      s.addEventListener("click", onClick);
    });
    return () => found.forEach((s) => s.removeEventListener("click", onClick));
  }, [said, done, put]);

  /** Once there is a signature, point at the first place and go there. */
  useEffect(() => {
    if (!ink || done) return;
    const next = aim();
    if (next) show(next);
  }, [ink, done, aim]);

  const sign = async () => {
    if (!ink) return;
    setBusy(true); setWrong(null);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ png: ink, name, agreed, on }),
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

  const left = Math.max(0, slots - placed);
  const all = slots > 0 && left === 0;

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
            {said.toName}, please read these and sign in each place marked.
            There {slots === 1 ? "is one place" : `are ${slots || said.places} places`}{" "}
            for your signature. Nothing is signed until you press the button
            at the end.
          </p>
        )}
      </header>

      {/* The bar that walks them through it. It stays in view, because the
          thing it is counting is further down the page than the thing it
          is counting it on. */}
      {!done && (
        <div className="signwalk noprint">
          {!ink ? (
            <>
              <span className="walksays">Start by choosing your signature.</span>
              <button type="button" className="btn pri"
                      onClick={() => setAsking(true)}>
                Sign
              </button>
            </>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="walkink" src={ink} alt="Your signature" />
              <span className="walksays">
                {all
                  ? `All ${slots} signed. Finish at the bottom.`
                  : `${placed} of ${slots} signed`}
              </span>
              {!all && (
                <button type="button" className="btn pri"
                        onClick={() => {
                          const next = empties()[0];
                          if (next) { show(next); next.classList.add("here"); }
                        }}>
                  Next signature
                </button>
              )}
              <button type="button" className="btn"
                      onClick={() => setAsking(true)}>
                Change
              </button>
            </>
          )}
        </div>
      )}

      {asking && !done && (
        <div className="signask noprint">
          <h2>Your signature</h2>
          <SignaturePad png={null} busy={false} said={null}
                        defaultName={said.toName}
                        onSave={(v) => { setInk(v); setAsking(false); }}
                        onClear={() => setInk(null)} />
          <button type="button" className="btn" onClick={() => setAsking(false)}>
            Never mind
          </button>
        </div>
      )}

      <div className="paper" ref={paper}
           dangerouslySetInnerHTML={{ __html: said.pack }} />

      {!done && (
        <div className="signbox noprint">
          <h2>Finish</h2>

          <label className="signname">Your full name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          {/* THE DATE IS THEIRS. It goes into every date line in the pack,
              and it defaults to today rather than being today. */}
          <label className="signname">Date of signature
            <input type="date" value={on} max={today}
                   onChange={(e) => setOn(e.target.value)} />
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
                    disabled={busy || !ink || !all || !agreed
                              || name.trim().length < 2}
                    onClick={() => void sign()}>
              {busy ? "Signing…" : "Sign these documents"}
            </button>
            {/* Why the button is off, rather than a button that is off. */}
            {!busy && ink && !all && (
              <span className="dim">
                {left === 1 ? "One place is" : `${left} places are`} still
                waiting for your signature.
              </span>
            )}
            {wrong && <span className="err">{wrong}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
