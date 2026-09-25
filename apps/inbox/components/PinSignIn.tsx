"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/format";

type Person = { id: string; full_name: string };

/** Name, then PIN — for people holding a phone in a crawlspace.
 *
 *  The name list is the fast part and the PIN is the part that means anything.
 *  Tapping a name proves nothing, which is why the audit trail waits for the
 *  four digits: "Ray closed this" has to be a fact, not an assumption about who
 *  was holding the phone. */
export default function PinSignIn({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [who, setWho] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const liveRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    fetch("/api/auth/pin/roster")
      .then((r) => r.json())
      .then((d) => setPeople(d.staff ?? []))
      .catch(() => setPeople([]));
  }, []);

  // Four digits and go. Making someone find a submit button with one thumb,
  // in the dark, is the kind of small tax that gets an app abandoned.
  useEffect(() => {
    if (pin.length !== 4 || busy || !who) return;
    void submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function submit(value: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: who!.id, pin: value }),
      });
      if (res.ok) { router.replace("/"); router.refresh(); return; }
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "That didn't work. Try again.");
      setPin("");
    } catch {
      setError("No connection. Check your signal and try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    setError("");
    setPin(pin + d);
  };

  /* ---------------------------------------------------------- pick a name */
  if (!who) {
    const list = (people ?? []).filter((p) =>
      p.full_name.toLowerCase().includes(q.trim().toLowerCase()));
    return (
      <div className="pinwrap">
        <p className="pintitle">Who's signing in?</p>
        {people === null ? (
          <p className="pinmuted">Loading…</p>
        ) : people.length === 0 ? (
          <p className="pinmuted">
            No field accounts have a PIN yet. Ask the office to set one up, or
            sign in with your work email instead.
          </p>
        ) : (
          <>
            {people.length > 6 && (
              <input className="pinsearch" value={q} placeholder="Search your name…"
                     onChange={(e) => setQ(e.target.value)} aria-label="Search your name" />
            )}
            <ul className="pinpeople">
              {list.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { setWho(p); setPin(""); setError(""); }}>
                    <span className="av">{initials(p.full_name)}</span>
                    <span>{p.full_name}</span>
                  </button>
                </li>
              ))}
              {!list.length && <li className="pinmuted pad">No name matches that.</li>}
            </ul>
          </>
        )}
        <button className="pinlink" onClick={onBack}>Use my work email instead</button>
      </div>
    );
  }

  /* -------------------------------------------------------------- the PIN */
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="pinwrap">
      <p className="pintitle">Hi, {who.full_name.split(/\s+/)[0]}</p>
      <p className="pinmuted">Enter your 4-digit PIN.</p>

      <div className="pindots" role="img"
           aria-label={`${pin.length} of 4 digits entered`}>
        {[0,1,2,3].map((i) => (
          <span key={i} className={i < pin.length ? "on" : ""} />
        ))}
      </div>

      {/* Errors are announced, not just coloured: this gets used one-handed
          with the phone at arm's length, and by people using a screen reader. */}
      <p className="pinerr" role="status" aria-live="polite" ref={liveRef}>
        {busy ? "Checking…" : error}
      </p>

      <div className="pinpad">
        {keys.map((k, i) =>
          k === "" ? <span key={i} /> : (
            <button key={i} disabled={busy}
                    onClick={() => k === "⌫" ? setPin(pin.slice(0, -1)) : press(k)}
                    aria-label={k === "⌫" ? "Delete" : k}>
              {k}
            </button>
          ))}
      </div>

      <button className="pinlink" onClick={() => { setWho(null); setPin(""); setError(""); }}>
        Not {who.full_name.split(/\s+/)[0]}?
      </button>
    </div>
  );
}
