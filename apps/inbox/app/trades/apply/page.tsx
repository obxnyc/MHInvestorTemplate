"use client";
import { useEffect, useState } from "react";

type Opt = { id: string; label?: string; name?: string };

/**
 * A contractor putting themselves forward.
 *
 * Public, and deliberately short: a plumber fills this in on a phone between
 * jobs, and every field that is not needed to ring them back is a field that
 * loses somebody halfway. Insurance and licence are recorded as what they say,
 * because that is what they are until the office checks.
 */
export default function TradeApply() {
  const [lists, setLists] = useState<{ trades: Opt[]; markets: Opt[] }>({ trades: [], markets: [] });
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [trades, setTrades] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [insured, setInsured] = useState(false);
  const [licensed, setLicensed] = useState(false);
  const [licenseRef, setLicenseRef] = useState("");
  const [website, setWebsite] = useState("");   // honeypot
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/trades/apply").then((r) => r.json()).then(setLists).catch(() => {});
  }, []);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/trades/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName, company, phone, email, trades, markets, notes,
        insured, licensed, licenseRef, website,
      }),
    });
    if (!res.ok) {
      setState("error");
      setMessage((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <main className="apply">
        <p className="brand">Larabee Homes</p>
        <h1>Thanks — we have it</h1>
        <p className="lede">
          Someone in the office will look at this and be in touch. If we take you
          on you&rsquo;ll get a text with a link to your jobs; there&rsquo;s no
          account to set up and no password to remember.
        </p>
      </main>
    );
  }

  return (
    <main className="apply">
      <p className="brand">Larabee Homes</p>
      <h1>Work with us</h1>
      <p className="lede">
        We rent and maintain mobile homes in north-eastern North Carolina. If you
        take on repair work, tell us what you do and where, and we&rsquo;ll be in
        touch.
      </p>

      <form onSubmit={submit}>
        <fieldset>
          <legend>You</legend>

          <label htmlFor="n">Your name</label>
          <input id="n" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

          <label htmlFor="c">Company <span className="hint">if you have one</span></label>
          <input id="c" value={company} onChange={(e) => setCompany(e.target.value)} />

          <label htmlFor="p">Mobile number</label>
          <input id="p" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                 placeholder="(252) 555-0142" required />
          <p className="hint">This is how we&rsquo;d send you work.</p>

          <label htmlFor="e">Email <span className="hint">optional</span></label>
          <input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          {/* Not shown to anyone with eyes. */}
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
                 value={website} onChange={(e) => setWebsite(e.target.value)}
                 placeholder="Leave this empty" />
        </fieldset>

        <fieldset>
          <legend>What you do</legend>
          <div className="chipset">
            {lists.trades.map((t) => (
              <button key={t.id} type="button"
                      className={`chip${trades.includes(t.id) ? " on" : ""}`}
                      aria-pressed={trades.includes(t.id)}
                      onClick={() => toggle(trades, setTrades, t.id)}>{t.label}</button>
            ))}
          </div>

          <p className="fieldlab">Where you work</p>
          <div className="chipset">
            {lists.markets.map((m) => (
              <button key={m.id} type="button"
                      className={`chip${markets.includes(m.id) ? " on" : ""}`}
                      aria-pressed={markets.includes(m.id)}
                      onClick={() => toggle(markets, setMarkets, m.id)}>{m.name}</button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Insurance and licence</legend>
          <label className="check">
            <input type="checkbox" checked={insured}
                   onChange={(e) => setInsured(e.target.checked)} />
            <span>I carry liability insurance</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={licensed}
                   onChange={(e) => setLicensed(e.target.checked)} />
            <span>I hold a licence for the work I do</span>
          </label>
          <label htmlFor="lr">Licence number <span className="hint">if you have one</span></label>
          <input id="lr" value={licenseRef} onChange={(e) => setLicenseRef(e.target.value)} />
          <p className="hint">
            We&rsquo;ll ask to see the paperwork before sending you a job. Saying
            so here doesn&rsquo;t stand in for it.
          </p>

          <label htmlFor="nt">Anything else <span className="hint">optional</span></label>
          <input id="nt" value={notes} onChange={(e) => setNotes(e.target.value)}
                 placeholder="Hours, call-out rate, what you'd rather not take on" />
        </fieldset>

        {state === "error" && <p className="error">{message}</p>}
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send it"}
        </button>
        <p className="fineprint">
          We&rsquo;ll only use this to contact you about work. Nothing here is
          shared with anyone else.
        </p>
      </form>
    </main>
  );
}
