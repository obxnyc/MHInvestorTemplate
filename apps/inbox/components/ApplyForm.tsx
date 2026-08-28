"use client";
import { useState } from "react";

export type Home = {
  id: string; label: string; address: string | null;
  bedrooms: number | null; rent: number | null; availableOn: string | null;
};

type Result =
  | { outcome: "auto_approve"; bookingUrl: string }
  | { outcome: "manual_review" }
  | { outcome: "declined"; message: string };

export default function ApplyForm({ homes }: { homes: Home[] }) {
  const [unitId, setUnitId] = useState(homes[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const home = homes.find((h) => h.id === unitId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch("/api/prequal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, has_cosigner: fd.get("has_cosigner") === "on" }),
    });
    setBusy(false);
    if (!res.ok) { setError("Something went wrong. Please try again."); return; }
    setResult(await res.json());
  }

  if (result?.outcome === "auto_approve") {
    return (
      <Shell>
        <h1>You&rsquo;re prequalified</h1>
        <p className="lede">Pick a time to see {home?.label}. We&rsquo;ve texted you this link too.</p>
        <a className="cta" href={result.bookingUrl}>Choose a showing time</a>
      </Shell>
    );
  }
  if (result?.outcome === "manual_review") {
    return (
      <Shell>
        <h1>Thanks — we&rsquo;re taking a look</h1>
        <p className="lede">
          A few of your answers need a person to review them, which usually happens
          the same business day. We&rsquo;ll text you either way.
        </p>
      </Shell>
    );
  }
  if (result?.outcome === "declined") {
    return (
      <Shell>
        <h1>Not a match right now</h1>
        <pre className="decline">{result.message}</pre>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>See if you prequalify</h1>
      <p className="lede">
        Two minutes, no credit check, and no effect on your credit. If you meet our
        criteria you can book a showing straight away.
      </p>

      <form onSubmit={submit}>
        <fieldset>
          <legend>Which home?</legend>
          {homes.length === 0 && <p className="muted">Nothing available just now — please check back.</p>}
          <label htmlFor="unit_id">Home</label>
          <select id="unit_id" name="unit_id" required value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}>
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}{h.bedrooms ? ` · ${h.bedrooms} bed` : ""}
                {h.rent ? ` · $${h.rent.toLocaleString()}/mo` : ""}
              </option>
            ))}
          </select>
          {home?.rent && (
            <p className="hint">
              Rent is ${home.rent.toLocaleString()} a month
              {home.availableOn ? `, available ${new Date(home.availableOn).toLocaleDateString()}` : ""}.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>How do we reach you?</legend>
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" required autoComplete="name" />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" required autoComplete="tel"
                 placeholder="(252) 555-0100" />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" />
        </fieldset>

        <fieldset>
          <legend>Income</legend>
          <label htmlFor="monthly_income">Monthly income before tax</label>
          <input id="monthly_income" name="monthly_income" inputMode="decimal" required
                 placeholder="3200" />
          <label htmlFor="other_monthly_income">Any other monthly income</label>
          <input id="other_monthly_income" name="other_monthly_income" inputMode="decimal"
                 placeholder="0" />
          <p className="hint">
            Include everything: a second job, Social Security, disability, child
            support, a pension. It all counts.
          </p>
          <label htmlFor="monthly_assistance">Monthly rental assistance, if any</label>
          <input id="monthly_assistance" name="monthly_assistance" inputMode="decimal"
                 placeholder="0" />
          <p className="hint">
            A housing voucher or similar, paid straight to us. We only ask you to
            afford your own share of the rent.
          </p>
        </fieldset>

        <fieldset>
          <legend>Rental and credit</legend>
          <label htmlFor="credit_score">Your best guess at your credit score</label>
          <input id="credit_score" name="credit_score" inputMode="numeric" placeholder="e.g. 640" />
          <p className="hint">An estimate is fine. We are not pulling your credit here.</p>
          <label htmlFor="rental_history_months">Months of rental history you can verify</label>
          <input id="rental_history_months" name="rental_history_months" inputMode="numeric"
                 required placeholder="24" />
          <label htmlFor="eviction">Any eviction judgment against you?</label>
          <select id="eviction" name="eviction" defaultValue="never">
            <option value="never">No, never</option>
            <option value="">Yes — enter years since below</option>
          </select>
          <label htmlFor="years_since_eviction">If yes, how many years ago?</label>
          <input id="years_since_eviction" name="years_since_eviction" inputMode="numeric"
                 placeholder="" />
          <label className="check">
            <input type="checkbox" name="has_cosigner" />
            <span>A co-signer or guarantor is available if needed</span>
          </label>
        </fieldset>

        {/* honeypot */}
        <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hp" />

        <button type="submit" disabled={busy || !homes.length}>
          {busy ? "Checking…" : "Check if I prequalify"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="fineprint">
          Larabee Homes applies the same published criteria to every applicant.
          We do not ask about, and will not consider, your family status,
          disability, national origin, religion, sex, or race.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="apply">
      <p className="brand">Larabee Homes</p>
      {children}
    </main>
  );
}
