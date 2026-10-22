"use client";
import { useState } from "react";
import { say, type Lang } from "@/lib/say";

/**
 * Choosing your own PIN. Used on the setup link and again from the clock.
 *
 * TYPED TWICE. The single most expensive mistake available here is a PIN
 * nobody knows -- mistyped once, saved, and the man is locked out of the
 * thing he clocks in on with no email to recover by. Two entries that must
 * agree costs four seconds and removes that entirely.
 *
 * `inputMode="numeric"` rather than `type="number"`: a number input drops
 * leading zeros, and 0417 is a perfectly good PIN. `type="password"` so it is
 * not readable over a shoulder in a yard.
 */
export default function PinChoose({
  lang, submit, cta,
}: {
  lang: Lang;
  /** Returns an error to show, or null when it saved. */
  submit: (pin: string) => Promise<string | null>;
  cta?: string;
}) {
  const s = (k: Parameters<typeof say>[0]) => say(k, lang);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setProblem(null);
    if (!/^[0-9]{4,8}$/.test(pin)) { setProblem(s("pinTooShort")); return; }
    if (pin !== again) { setProblem(s("pinsDoNotMatch")); return; }
    setBusy(true);
    const err = await submit(pin);
    setBusy(false);
    /* Nothing is cleared or called done until the server has answered. A
       refusal that empties the boxes looks exactly like a save. */
    if (err) { setProblem(err); return; }
    setPin(""); setAgain(""); setDone(true);
  }

  return (
    <div className="pinchoose">
      <p className="authnote">{s("choosePinWhy")}</p>

      <label htmlFor="pin1">{s("choosePin")}</label>
      <input id="pin1" type="password" inputMode="numeric" autoComplete="new-password"
             maxLength={8} value={pin} disabled={busy}
             onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setDone(false); }} />

      <label htmlFor="pin2">{s("confirmPin")}</label>
      <input id="pin2" type="password" inputMode="numeric" autoComplete="new-password"
             maxLength={8} value={again} disabled={busy}
             onChange={(e) => { setAgain(e.target.value.replace(/\D/g, "")); setDone(false); }} />

      {problem ? <p className="authbad">{problem}</p> : null}
      {done ? <p className="tsgood">{s("pinSaved")}</p> : null}

      <button className="authgo" type="button" onClick={save}
              disabled={busy || !pin || !again}>
        {busy ? s("saving") : (cta ?? s("savePin"))}
      </button>
    </div>
  );
}
