"use client";

import { useState } from "react";

/**
 * "Something is broken."
 *
 * Read on a phone, often at night, often by somebody annoyed. So: five boxes,
 * plain words, and no account to make.
 *
 * The one rule that is not cosmetic -- NOTHING IS CLEARED UNTIL THE SERVER
 * SAYS IT TOOK IT. A form that empties itself and shows nothing is a repair
 * the tenant believes was reported and nobody has. They ring in a week angry,
 * and they are right to.
 */
export default function ReportForm({ places }: { places: string[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [property, setProperty] = useState("");
  const [lot, setLot] = useState("");
  const [problem, setProblem] = useState("");
  const [entry, setEntry] = useState("");
  const [company, setCompany] = useState("");          // honeypot
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/intake/report", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, phone, property, lot, problem, entry, company }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(out.error ?? "That did not send. Please try again, or ring the office.");
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <main className="rep">
        <h1>Thank you</h1>
        <p className="replede">
          Your repair has been logged and somebody will be in touch. If this is
          an emergency — no heat, no water, a leak you cannot stop, or a smell
          of gas — please ring the office now rather than waiting on this.
        </p>
      </main>
    );
  }

  return (
    <main className="rep">
      <h1>Report a repair</h1>
      <p className="replede">
        Tell us what is wrong and we will get somebody out. If it is an
        emergency — no heat, no water, a leak you cannot stop, or a smell of
        gas — ring the office instead of filling this in.
      </p>

      {error ? <p className="repbad" role="alert">{error}</p> : null}

      <form className="repform" onSubmit={send}>
        <div className="tsfield">
          <label htmlFor="pr">What is wrong?</label>
          <textarea id="pr" rows={4} required value={problem}
                    placeholder="The kitchen tap drips all the time and the handle is loose."
                    onChange={(e) => setProblem(e.target.value)} />
        </div>

        <div className="tsfield">
          <label htmlFor="pp">Which property?</label>
          <select id="pp" value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="">Choose</option>
            {places.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="tsfield">
          <label htmlFor="lo">Lot or unit number</label>
          <input id="lo" value={lot} inputMode="numeric" placeholder="51"
                 onChange={(e) => setLot(e.target.value)} />
        </div>

        <div className="tsfield">
          <label htmlFor="nm">Your name</label>
          <input id="nm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="tsfield">
          <label htmlFor="ph">Phone number</label>
          <input id="ph" type="tel" required value={phone} placeholder="(910) 555-0142"
                 onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="tsfield">
          <label htmlFor="en">Can we let ourselves in if you are out?</label>
          <select id="en" value={entry} onChange={(e) => setEntry(e.target.value)}>
            <option value="">Choose</option>
            <option value="Yes, any time">Yes, any time</option>
            <option value="Yes, but ring first">Yes, but ring first</option>
            <option value="No, I need to be home">No, I need to be home</option>
          </select>
        </div>

        {/* Hidden from people, filled in by bots. */}
        <input className="repbot" tabIndex={-1} autoComplete="off" aria-hidden="true"
               value={company} onChange={(e) => setCompany(e.target.value)} />

        <button className="tsact go" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send it"}
        </button>
      </form>
    </main>
  );
}
