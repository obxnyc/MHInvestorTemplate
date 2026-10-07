"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/invoices";
import type { Lot } from "./ParkPlan";

type Owner = { id: string; name: string };
type Sale = {
  id: string; sold_on: string; price_cents: number; down_cents: number;
  financed: boolean; monthly_cents: number | null; rate_bps: number | null;
  term_months: number | null; home_year: number | null; home_make: string | null;
  home_serial: string | null; ended_on: string | null; ended_why: string | null;
  note: string | null; owners: { id: string; name: string } | null;
};

/**
 * One pad, opened.
 *
 * Three questions in the order people ask them: whose home is this, who is
 * living in it, and what was the deal. The history underneath, because a lot
 * that has changed hands twice is a lot where the last sale alone is
 * misleading.
 */
export default function LotCard(
  { lot, onClose, onChanged }:
  { lot: Lot; onClose: () => void; onChanged: () => void },
) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [pending, setPending] = useState(false);
  const [selling, setSelling] = useState(false);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The buyer's own last deal, which pre-fills the form. An investor with
  // nine homes buys the tenth on the same terms as the ninth, and retyping
  // them is how a rate ends up different on one lot for no reason anybody
  // can explain two years later.
  const [ownerId, setOwnerId] = useState("");
  const [memory, setMemory] = useState<{
    price_cents: number; down_cents: number; financed: boolean;
    monthly_cents: number | null; rate_bps: number | null; term_months: number | null;
  } | null>(null);

  async function load(owner?: string) {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    const res = await fetch(`/api/units/${lot.id}/sale${q}`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (out.pending) { setPending(true); return; }
    setOwners(out.owners ?? []);
    setSales(out.sales ?? []);
    setMemory(out.lastFor ?? null);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lot.id]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/units/${lot.id}/sale`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't save."); return false; }
    setSelling(false); setEnding(false);
    await load();
    onChanged();
    return true;
  }

  const live = sales.find((s) => !s.ended_on) ?? null;
  const past = sales.filter((s) => s.ended_on);

  return (
    <aside className="lotcard">
      <header>
        <h2>Lot {lot.label}</h2>
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </header>

      {pending ? (
        <p className="dashnone">
          Migration 030 hasn&rsquo;t been run, so ownership can&rsquo;t be
          recorded yet. The pad itself is fine.
        </p>
      ) : (
        <>
          <dl className="lotfacts">
            <dt>Home</dt>
            <dd>
              {live?.owners?.name
                ? <><strong>{live.owners.name}</strong> owns it</>
                : <span className="muted">Bare pad — no home sold here</span>}
              {live?.home_year || live?.home_make ? (
                <span className="dim">
                  {" "}· {[live.home_year, live.home_make].filter(Boolean).join(" ")}
                  {live.home_serial ? ` · ${live.home_serial}` : ""}
                </span>
              ) : null}
            </dd>

            <dt>Living there</dt>
            <dd>{lot.tenant ?? <span className="muted">Nobody</span>}</dd>

            <dt>Lot rent</dt>
            <dd>{lot.rent ? money(Number(lot.rent) * 100) : <span className="muted">Not set</span>}</dd>

            {live && (
              <>
                <dt>Sold</dt>
                <dd>
                  {money(live.price_cents)} on {live.sold_on}
                  {live.down_cents ? ` · ${money(live.down_cents)} down` : ""}
                </dd>
                {live.financed && (
                  <>
                    <dt>We carry</dt>
                    <dd>
                      {live.monthly_cents ? `${money(live.monthly_cents)}/mo` : "—"}
                      {live.term_months ? ` · ${live.term_months} months` : ""}
                      {live.rate_bps ? ` · ${(live.rate_bps / 100).toFixed(2)}%` : ""}
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>

          {error && <p className="err">{error}</p>}

          {!live && !selling && (
            <button type="button" className="btn pri" onClick={() => setSelling(true)}>
              Record a sale
            </button>
          )}
          {live && !ending && (
            <button type="button" className="btn" onClick={() => setEnding(true)}>
              This home changed hands
            </button>
          )}

          {selling && (
            <form className="saleform" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await post({
                ownerId: f.get("ownerId"),
                soldOn: f.get("soldOn"),
                price: f.get("price"),
                down: f.get("down"),
                financed: f.get("financed") === "on",
                monthly: f.get("monthly"),
                termMonths: f.get("termMonths"),
                ratePct: f.get("ratePct"),
                homeYear: f.get("homeYear"),
                homeMake: f.get("homeMake"),
                homeSerial: f.get("homeSerial"),
                note: f.get("note"),
              });
            }}>
              <label>
                Buyer
                <select name="ownerId" required value={ownerId}
                        onChange={(e) => { setOwnerId(e.target.value); void load(e.target.value); }}>
                  <option value="">Choose…</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              {memory && (
                <p className="memory">
                  Their last home: {money(memory.price_cents)}
                  {memory.financed && memory.monthly_cents
                    ? `, ${money(memory.monthly_cents)}/mo over ${memory.term_months} months` : ", cash"}
                  . Filled in below — change anything that differs.
                </p>
              )}

              <div className="two">
                <label>Price<input name="price" inputMode="decimal" required
                  defaultValue={memory ? String(memory.price_cents / 100) : ""} /></label>
                <label>Down<input name="down" inputMode="decimal"
                  defaultValue={memory ? String(memory.down_cents / 100) : "0"} /></label>
              </div>

              <label className="check">
                <input type="checkbox" name="financed" defaultChecked={memory?.financed ?? true} />
                We carry the note
              </label>

              <div className="three">
                <label>Monthly<input name="monthly" inputMode="decimal"
                  defaultValue={memory?.monthly_cents ? String(memory.monthly_cents / 100) : ""} /></label>
                <label>Months<input name="termMonths" inputMode="numeric"
                  defaultValue={memory?.term_months ?? ""} /></label>
                <label>Rate %<input name="ratePct" inputMode="decimal"
                  defaultValue={memory?.rate_bps ? String(memory.rate_bps / 100) : ""} /></label>
              </div>

              <div className="three">
                <label>Year<input name="homeYear" inputMode="numeric" /></label>
                <label>Make<input name="homeMake" /></label>
                <label>Serial<input name="homeSerial" /></label>
              </div>

              <label>Sold on<input type="date" name="soldOn"
                defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Note<textarea name="note" rows={2} /></label>

              <div className="invacts">
                <button type="button" className="btn" onClick={() => setSelling(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={busy}>
                  {busy ? "Saving…" : "Record it"}
                </button>
              </div>
            </form>
          )}

          {ending && (
            <form className="saleform" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await post({ action: "end", why: f.get("why"), on: f.get("on") });
            }}>
              <label>What happened
                <input name="why" required minLength={3}
                       placeholder="Sold on to another investor" /></label>
              <label>When<input type="date" name="on"
                defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <div className="invacts">
                <button type="button" className="btn" onClick={() => setEnding(false)}>Cancel</button>
                <button type="submit" className="btn pri" disabled={busy}>Save</button>
              </div>
            </form>
          )}

          {past.length > 0 && (
            <div className="lothist">
              <h3>Before</h3>
              <ul>
                {past.map((s) => (
                  <li key={s.id}>
                    <strong>{s.owners?.name ?? "Unknown"}</strong>
                    {" "}{s.sold_on} → {s.ended_on} · {money(s.price_cents)}
                    {s.ended_why ? <span className="dim"> · {s.ended_why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
