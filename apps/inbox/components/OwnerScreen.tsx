"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULTS, pack, money0, type Terms, type Home } from "@/lib/papers";

type Held = {
  saleId: string; unitId: string | null; lot: string;
  parkId: string | null; parkName: string; parkAddress: string | null;
  soldOn: string | null;
  priceCents: number; downCents: number; financed: boolean;
  monthlyCents: number | null; rateBps: number | null; termMonths: number | null;
  firstDueOn: string | null;
  homeYear: number | null; homeMake: string | null; homeSerial: string | null;
  lotRentCents: number | null; consultingCents: number | null;
  warrantyCents: number | null; tenantRentCents: number | null;
  lateFeeCents: number | null; ownerInsures: boolean | null;
  note: string | null;
};

const dollars = (cents: number | null | undefined) => (cents ?? 0) / 100;
const asMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${money0(cents / 100)}`;

/** The paragraph that identifies a home on a bill of sale. */
export function describe(h: {
  homeYear: number | null; homeMake: string | null; homeSerial: string | null;
}): string {
  const bits = [
    h.homeYear ? String(h.homeYear) : "",
    h.homeMake ?? "",
    h.homeSerial ? `Serial# ${h.homeSerial}` : "",
  ].filter(Boolean);
  return bits.join(" ");
}

/**
 * One investor's page.
 *
 * Everything about a relationship rather than about a lot: what they
 * own across every park, what they are charged every month, and the
 * papers for a sale. Eight homes to one trust is one conversation and
 * sixteen documents, and until now it was eight trips through a
 * standalone generator with twenty-four boxes typed again each time.
 */
export default function OwnerScreen({ ownerId }: { ownerId: string }) {
  const [owner, setOwner] = useState<{ name: string; legal_name: string | null } | null>(null);
  const [homes, setHomes] = useState<Held[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(true);

  /** Which homes the papers are being drawn for. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [papers, setPapers] = useState(false);
  const [which, setWhich] = useState<"both" | "purchase" | "lease">("both");
  const [terms, setTerms] = useState<Terms>(DEFAULTS);
  /** Set once from the first sale, so re-rendering does not overwrite
   *  what somebody has typed. */
  const [seeded, setSeeded] = useState(false);

  const load = useCallback(async () => {
    setAsking(true);
    const res = await fetch(`/api/owners/${ownerId}`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    setAsking(false);
    if (!res.ok) { setError(out.error ?? "Could not load this owner."); return; }
    setOwner(out.owner ?? null);
    setHomes(out.homes ?? []);
  }, [ownerId]);
  useEffect(() => { void load(); }, [load]);

  // The deal's own terms, taken from the homes themselves. A rate typed
  // once and read back from eight sales is a rate nobody re-keys.
  useEffect(() => {
    if (seeded || !owner || !homes.length) return;
    const first = homes[0];
    const today = new Date().toISOString().slice(0, 10);
    setTerms((was) => ({
      ...was,
      buyer: owner.legal_name?.trim() || owner.name,
      parkName: first.parkName || was.parkName,
      agreedOn: first.soldOn ?? today,
      leaseFrom: first.soldOn ?? today,
      financed: first.financed,
      ratePct: first.rateBps != null ? first.rateBps / 100 : was.ratePct,
      termYears: first.termMonths ? Math.round(first.termMonths / 12) : was.termYears,
      lotRent: first.lotRentCents != null ? dollars(first.lotRentCents) : was.lotRent,
      consulting: first.consultingCents != null
        ? dollars(first.consultingCents) : was.consulting,
      lateFee: first.lateFeeCents != null ? dollars(first.lateFeeCents) : was.lateFee,
    }));
    setPicked(Object.fromEntries(homes.map((h) => [h.saleId, true])));
    setSeeded(true);
  }, [seeded, owner, homes]);

  const chosen = useMemo(
    () => homes.filter((h) => picked[h.saleId]), [homes, picked]);

  /** Every month, what this investor is charged and what their homes let for. */
  const monthly = useMemo(() => {
    let owes = 0, rent = 0;
    for (const h of homes) {
      owes += (h.monthlyCents ?? 0) + (h.lotRentCents ?? 0)
        + (h.consultingCents ?? 0) + (h.warrantyCents ?? 0);
      rent += h.tenantRentCents ?? 0;
    }
    return { owes, rent, net: rent - owes };
  }, [homes]);

  const built = useMemo(() => {
    if (!chosen.length) return "";
    const list: Home[] = chosen.map((h) => ({
      lot: h.lot,
      describedAs: describe(h),
      price: dollars(h.priceCents),
      down: dollars(h.downCents),
    }));
    return pack(terms, list, which);
  }, [chosen, terms, which]);

  /**
   * What the browser calls this page while the papers are up.
   *
   * Chrome and Safari print the page's title and its URL into the page
   * margin unless the tick box is cleared, and a contract headed
   * `file:///Users/.../Downloads/mobilehomedocumentgenerator (4).html`
   * does not look like a contract. The tick box is the real answer --
   * there is no CSS for it, and the one trick that works, a zero page
   * margin, takes the top and bottom margin off every continuation page
   * with it. But a title that reads as the document costs nothing and
   * is the difference between an odd header and an embarrassing one.
   */
  useEffect(() => {
    if (!papers || !owner) return;
    const was = document.title;
    const what = which === "purchase" ? "Purchase Agreement"
      : which === "lease" ? "Park Land Lease"
      : "Purchase Agreement and Park Land Lease";
    document.title = `${what} — ${terms.buyer || owner.name}`;
    return () => { document.title = was; };
  }, [papers, owner, which, terms.buyer]);

  const set = (change: Partial<Terms>) => setTerms((was) => ({ ...was, ...change }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  if (asking && !owner) return <p className="parkhint">Reading…</p>;
  if (error) return <p className="err">{error}</p>;
  if (!owner) return <p className="parkhint">No such owner.</p>;

  return (
    <div className="parkpage ownerpage">
      <header className="parkhead noprint">
        <h1>{owner.name}</h1>
        {owner.legal_name && owner.legal_name !== owner.name && (
          <span className="parkkept">{owner.legal_name}</span>
        )}
        <div className="parkacts">
          <button type="button" className={papers ? "btn pri" : "btn"}
                  onClick={() => setPapers((v) => !v)}
                  disabled={!homes.length}>
            {papers ? "Done" : "Sale papers"}
          </button>
        </div>
      </header>

      {!homes.length ? (
        <p className="parkhint noprint">
          Nothing is recorded against this owner yet. A home becomes theirs
          when a sale is recorded on its lot card.
        </p>
      ) : (
        <p className="parktally noprint">
          <strong>{homes.length} home{homes.length === 1 ? "" : "s"}</strong>{" "}
          across {new Set(homes.map((h) => h.parkName)).size} park
          {new Set(homes.map((h) => h.parkName)).size === 1 ? "" : "s"}. They
          are charged <strong>{asMoney(monthly.owes)}</strong> a month;
          the homes let for {asMoney(monthly.rent)}, so net to them is{" "}
          <strong className={monthly.net < 0 ? "parkbad" : "parkok"}>
            {asMoney(monthly.net)}
          </strong>{" "}
          before anything we spend on their behalf.
        </p>
      )}

      {homes.length > 0 && (
        <div className="ownerlist noprint">
          <table className="ownertbl">
            <thead>
              <tr>
                {papers && <th aria-label="Include" />}
                <th>Park</th><th>Lot</th><th>Home</th><th>Sold</th>
                <th>Price</th><th>Mortgage</th><th>Lot fee</th>
                <th>Consultancy</th><th>Rent in</th>
              </tr>
            </thead>
            <tbody>
              {homes.map((h) => (
                <tr key={h.saleId}>
                  {papers && (
                    <td>
                      <input type="checkbox" checked={Boolean(picked[h.saleId])}
                             onChange={(e) => setPicked((was) => (
                               { ...was, [h.saleId]: e.target.checked }))} />
                    </td>
                  )}
                  <td>
                    {h.parkId
                      ? <a href={`/properties/${h.parkId}/plan`}>{h.parkName}</a>
                      : h.parkName}
                  </td>
                  <td><strong>{h.lot}</strong></td>
                  <td>{describe(h) || <span className="dim">not recorded</span>}</td>
                  <td>{h.soldOn ?? "—"}</td>
                  <td>{asMoney(h.priceCents)}</td>
                  <td>{h.financed ? asMoney(h.monthlyCents) : <span className="dim">paid</span>}</td>
                  <td>{asMoney(h.lotRentCents)}</td>
                  <td>{asMoney(h.consultingCents)}</td>
                  <td>{asMoney(h.tenantRentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {papers && (
        <>
          <div className="papersetup noprint">
            <p className="parkhint">
              {chosen.length} of {homes.length} ticked —{" "}
              <strong>
                {which === "both" ? chosen.length * 2 : chosen.length} document
                {(which === "both" ? chosen.length * 2 : chosen.length) === 1 ? "" : "s"}
              </strong>. Everything below is filled from the sales already
              recorded; change it here and the papers change with it.
              Nothing typed here is written back to a lot.
            </p>

            <div className="tabsrow">
              {(["both", "purchase", "lease"] as const).map((k) => (
                <button key={k} type="button"
                        className={which === k ? "chip on" : "chip"}
                        onClick={() => setWhich(k)}>
                  {k === "both" ? "Both documents"
                    : k === "purchase" ? "Purchase only" : "Lease only"}
                </button>
              ))}
            </div>

            <div className="papergrid">
              <label>Seller entity
                <input value={terms.seller}
                       onChange={(e) => set({ seller: e.target.value })} /></label>
              <label>Park owner
                <input value={terms.parkOwner}
                       onChange={(e) => set({ parkOwner: e.target.value })} /></label>
              <label>Purchaser
                <input value={terms.buyer}
                       onChange={(e) => set({ buyer: e.target.value })} /></label>
              <label>Park name
                <input value={terms.parkName}
                       onChange={(e) => set({ parkName: e.target.value })} /></label>
              <label>Governing law
                <input value={terms.state}
                       onChange={(e) => set({ state: e.target.value })} /></label>
              <label>Agreement date
                <input type="date" value={terms.agreedOn}
                       onChange={(e) => set({ agreedOn: e.target.value })} /></label>
              <label>Lease from
                <input type="date" value={terms.leaseFrom}
                       onChange={(e) => set({ leaseFrom: e.target.value })} /></label>
              <label>Rate %/yr
                <input inputMode="decimal" value={terms.ratePct}
                       onChange={(e) => set({ ratePct: num(e.target.value) })} /></label>
              <label>Term (yrs)
                <input inputMode="numeric" value={terms.termYears}
                       onChange={(e) => set({ termYears: num(e.target.value) })} /></label>
              <label>Lot rent $/mo
                <input inputMode="numeric" value={terms.lotRent}
                       onChange={(e) => set({ lotRent: num(e.target.value) })} /></label>
              <label>Consulting $/mo
                <input inputMode="numeric" value={terms.consulting}
                       onChange={(e) => set({ consulting: num(e.target.value) })} /></label>
              <label>Reserve $
                <input inputMode="numeric" value={terms.reserve}
                       onChange={(e) => set({ reserve: num(e.target.value) })} /></label>
              <label>Notice (days)
                <input inputMode="numeric" value={terms.noticeDays}
                       onChange={(e) => set({ noticeDays: num(e.target.value) })} /></label>
              <label>First refusal (days)
                <input inputMode="numeric" value={terms.rofrDays}
                       onChange={(e) => set({ rofrDays: num(e.target.value) })} /></label>
              <label>Escalation %/yr
                <input inputMode="decimal" value={terms.escalatePct}
                       onChange={(e) => set({ escalatePct: num(e.target.value) })} /></label>
              <label>Grace (days)
                <input inputMode="numeric" value={terms.graceDays}
                       onChange={(e) => set({ graceDays: num(e.target.value) })} /></label>
              <label>Late fee $
                <input inputMode="numeric" value={terms.lateFee}
                       onChange={(e) => set({ lateFee: num(e.target.value) })} /></label>
            </div>

            <div className="papertick">
              {([
                ["financed", "Seller-financed"],
                ["amortise", "Attach amortisation schedule"],
                ["escalate", "Annual rent escalation"],
                ["late", "Late fee and default"],
                ["security", "Seller keeps a lien until paid"],
                ["insure", "Homeowner insures, Seller loss payee"],
                ["notary", "Notary block"],
              ] as const).map(([key, say]) => (
                <label key={key} className="papertickone">
                  <input type="checkbox" checked={Boolean(terms[key])}
                         onChange={(e) => set({ [key]: e.target.checked } as Partial<Terms>)} />
                  <span>{say}</span>
                </label>
              ))}
            </div>

            <div className="paperacts">
              <button type="button" className="btn pri"
                      disabled={!chosen.length}
                      onClick={() => window.print()}>
                Print / save as PDF
              </button>
              <span className="dim">
                Save each one and send it off for signing as you do now.
              </span>
            </div>
          </div>

          {chosen.length > 0 && (
            <div className="paper" dangerouslySetInnerHTML={{ __html: built }} />
          )}
        </>
      )}
    </div>
  );
}
