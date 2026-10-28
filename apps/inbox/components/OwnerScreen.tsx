"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describe, homeSentence } from "@/lib/describe";
import { DEFAULTS, TEMPLATES, templateOf, pack, money0,
         type Terms, type Home } from "@/lib/papers";

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

/**
 * A home on the deal that is not a recorded sale.
 *
 * The purchase agreement is the paper that MAKES the sale, so requiring
 * the sale to be in the database before it can be drawn is asking for the
 * outcome before the cause. Price and down stay as typed rather than as
 * numbers: a field cleared on the way to a new figure is momentarily
 * empty, and an empty number field read as zero is a contract that sells
 * a home for nothing.
 */
type ByHand = { key: string; lot: string; describedAs: string; price: string; down: string };

const blank = (): ByHand => ({
  key: Math.random().toString(36).slice(2), lot: "", describedAs: "",
  price: "", down: "",
});

const asNum = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const dollars = (cents: number | null | undefined) => (cents ?? 0) / 100;
const asMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${money0(cents / 100)}`;

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
  /** Homes typed in for this deal, which no sale has been recorded for. */
  const [byHand, setByHand] = useState<ByHand[]>([]);
  /** What the papers call each recorded home, where somebody has said. */
  const [saidAs, setSaidAs] = useState<Record<string, string>>({});
  /** Making the Word file, and anything that went wrong doing it. */
  const [writing, setWriting] = useState(false);
  const [wordSaid, setWordSaid] = useState<string | null>(null);
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
    // Seeded as soon as the investor is known, not when a sale is. An
    // investor with nothing recorded yet is the one buying their first
    // home, and the buyer's name and today's date are the two things the
    // papers need most.
    if (seeded || !owner || asking) return;
    const first: Held | undefined = homes[0];
    const today = new Date().toISOString().slice(0, 10);
    setTerms((was) => ({
      ...was,
      buyer: owner.legal_name?.trim() || owner.name,
      parkName: first?.parkName || was.parkName,
      agreedOn: first?.soldOn ?? today,
      leaseFrom: first?.soldOn ?? today,
      financed: first ? first.financed : was.financed,
      ratePct: first?.rateBps != null ? first.rateBps / 100 : was.ratePct,
      termYears: first?.termMonths ? Math.round(first.termMonths / 12) : was.termYears,
      lotRent: first?.lotRentCents != null ? dollars(first.lotRentCents) : was.lotRent,
      consulting: first?.consultingCents != null
        ? dollars(first.consultingCents) : was.consulting,
      lateFee: first?.lateFeeCents != null ? dollars(first.lateFeeCents) : was.lateFee,
    }));
    setPicked(Object.fromEntries(homes.map((h) => [h.saleId, true])));
    setSeeded(true);
  }, [seeded, owner, asking, homes]);

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

  /** The homes typed in that are worth drawing: a row with nothing in it
   *  is a row somebody has not filled in yet, not a home for nothing. */
  const handed = useMemo(
    () => byHand.filter((h) => h.lot.trim() || h.describedAs.trim() || asNum(h.price)),
    [byHand]);

  const forPapers = useMemo<Home[]>(() => [
    ...chosen.map((h) => ({
      lot: h.lot,
      parkName: h.parkName || undefined,
      describedAs: saidAs[h.saleId] ?? homeSentence(h),
      price: dollars(h.priceCents),
      down: dollars(h.downCents),
    })),
    ...handed.map((h) => ({
      lot: h.lot.trim(),
      describedAs: h.describedAs.trim(),
      price: asNum(h.price),
      down: asNum(h.down),
    })),
  ], [chosen, handed, saidAs]);

  /**
   * Typed-in homes that are not ready to print.
   *
   * A price of nothing renders as $0.00 on the agreement -- a contract
   * selling a home for zero dollars, which reads exactly like a contract
   * and is not one. So printing is refused rather than producing it, the
   * same way a send that cannot keep its attachment refuses rather than
   * inserting a message nobody can see.
   */
  const notReady = useMemo(
    () => handed.filter((h) => !asNum(h.price)), [handed]);

  /**
   * The parks the ticked homes stand in.
   *
   * The terms below are the DEAL's: one rate, one lot rent, one park
   * owner. Homes in two parks at the same lot rent is a coincidence, not
   * a deal, and the screen has no way to know which of the two the typed
   * figures belong to -- so it says so rather than printing both.
   */
  const spread = useMemo(() => {
    const seen = new Set(chosen.map((h) => h.parkName).filter(Boolean));
    return [...seen].sort();
  }, [chosen]);

  const built = useMemo(() => {
    if (!forPapers.length) return "";
    return pack(terms, forPapers, which);
  }, [forPapers, terms, which]);

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

  /**
   * Nothing is claimed until the file exists.
   *
   * The whole module is loaded on the press rather than with the page --
   * it is a few hundred kilobytes of Word writer that most visits to this
   * screen never need.
   */
  const saveWord = async () => {
    setWriting(true); setWordSaid(null);
    try {
      const { packDocx, docxName } = await import("@/lib/worddoc");
      const blob = await packDocx(terms, forPapers, which);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docxName(terms.buyer || owner?.name || "", which);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setWordSaid(`The Word file could not be made: ${
        e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }
  };

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
          {/* Not disabled on an empty investor. The papers for their first
              home are the papers most worth drawing, and the home can be
              typed in below. */}
          <button type="button" className={papers ? "btn pri" : "btn"}
                  onClick={() => {
                    setPapers((v) => !v);
                    if (!papers && !homes.length && !byHand.length) {
                      setByHand([blank()]);
                    }
                  }}>
            {papers ? "Done" : "Sale papers"}
          </button>
        </div>
      </header>

      {!homes.length ? (
        <p className="parkhint noprint">
          Nothing is recorded against this owner yet. A home becomes theirs
          when a sale is recorded on its lot card — but the papers do not
          wait on that:{" "}
          {papers
            ? <>type the home in below.</>
            : <>press <strong>Sale papers</strong> and type the home in.</>}
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
              {forPapers.length === 0 && <>Nothing on the deal yet — </>}
              {homes.length > 0 && <>{chosen.length} of {homes.length} ticked</>}
              {homes.length > 0 && handed.length > 0 && ", "}
              {handed.length > 0 && (
                <>{handed.length} typed in by hand</>
              )}
              {(homes.length > 0 || handed.length > 0) && " — "}
              <strong>
                {which === "both" ? forPapers.length * 2 : forPapers.length} document
                {(which === "both" ? forPapers.length * 2 : forPapers.length) === 1 ? "" : "s"}
              </strong>.{" "}
              {homes.length > 0
                ? <>Everything below is filled from the sales already
                    recorded; change it here and the papers change with it.</>
                : <>Type the home into <strong>Homes on this deal</strong> and
                    set the terms below.</>}{" "}
              Nothing typed here is written back to a lot.
            </p>

            {spread.length > 1 && (
              <p className="err">
                The ticked homes are in {spread.length} parks —{" "}
                {spread.join(" and ")}. Each lease names its own park, but the
                lot rent, the consulting fee and the rest below are one set of
                figures across all of them. If the parks are on different
                terms, draw them as separate deals.
              </p>
            )}

            <div className="handhomes">
              <h2>Homes on this deal</h2>
              <p className="dim">
                The second column is the line that comes after
                “certain personal property, to wit:”. The sale records only
                the year, the make and the serial number, so finish it here
                with the size, the bedrooms and anything else the home is
                identified by. Nothing typed here is written back to a lot.
              </p>
              <table className="ownertbl">
                <thead>
                  <tr><th>Lot</th><th>Home, as it is described</th>
                      <th>Price $</th><th>Down $</th><th /></tr>
                </thead>
                <tbody>
                  {/* The ticked sales, with their description open to be
                      finished. It is the line after "certain personal
                      property, to wit:" and the database holds only three
                      words of it. */}
                  {chosen.map((h) => (
                    <tr key={h.saleId}>
                      <td><strong>{h.lot}</strong></td>
                      <td><input value={saidAs[h.saleId] ?? homeSentence(h)}
                                 aria-label={`Home on lot ${h.lot}`}
                                 onChange={(e) => setSaidAs((was) => (
                                   { ...was, [h.saleId]: e.target.value }))} /></td>
                      <td>{asMoney(h.priceCents)}</td>
                      <td>{asMoney(h.downCents)}</td>
                      <td>
                        {saidAs[h.saleId] != null && (
                          <button type="button" className="btn"
                                  onClick={() => setSaidAs((was) => {
                                    const next = { ...was };
                                    delete next[h.saleId];
                                    return next;
                                  })}>
                            Put back
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {byHand.map((h, i) => (
                    <tr key={h.key}>
                      <td><input value={h.lot} aria-label={`Lot, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, lot: e.target.value } : r))} /></td>
                      <td><input value={h.describedAs} aria-label={`Home ${i + 1}`}
                                 placeholder="2021 Clayton 16x76, 3/2, Serial# ..."
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, describedAs: e.target.value } : r))} /></td>
                      <td><input value={h.price} inputMode="decimal" aria-label={`Price, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, price: e.target.value } : r))} /></td>
                      <td><input value={h.down} inputMode="decimal" aria-label={`Down payment, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, down: e.target.value } : r))} /></td>
                      <td><button type="button" className="btn"
                                  onClick={() => setByHand((was) =>
                                    was.filter((r) => r.key !== h.key))}>
                        Take off
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn"
                      onClick={() => setByHand((was) => [...was, blank()])}>
                Add a home
              </button>
              {handed.some((h) => !h.describedAs.trim()) && (
                <p className="err">
                  A home with no description leaves the line that identifies
                  it blank. Year, make, size and serial number.
                </p>
              )}
            </div>

            <div className="tplrow">
              <span className="tpllabel">Template</span>
              {TEMPLATES.map((tpl) => (
                <button key={tpl.key} type="button"
                        className={templateOf(terms) === tpl.key ? "chip on" : "chip"}
                        onClick={() => tpl.key !== "custom" && set(tpl.changes)}>
                  {tpl.name}
                </button>
              ))}
            </div>
            <p className="dim tplsays">
              {TEMPLATES.find((x) => x.key === templateOf(terms))?.blurb}
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
              {/* THE FILE THE OWNER ACTUALLY SENDS. The browser's print
                  dialog writes the date and the page's address into the
                  margin of every page unless somebody clears a tick box,
                  and no stylesheet can reach it -- so for anything that
                  gets recorded or signed, the file has to be one we make
                  rather than one the browser makes. */}
              <button type="button" className="btn pri"
                      disabled={!forPapers.length || notReady.length > 0 || writing}
                      onClick={() => void saveWord()}>
                {writing ? "Making it…" : "Download Word (.docx)"}
              </button>
              <button type="button" className="btn"
                      disabled={!forPapers.length || notReady.length > 0}
                      onClick={() => window.print()}>
                Print / save as PDF
              </button>
              {notReady.length > 0 ? (
                <span className="err">
                  {notReady.length} typed-in home
                  {notReady.length === 1 ? " has" : "s have"} no price. The
                  agreement would sell {notReady.length === 1 ? "it" : "them"}{" "}
                  for nothing.
                </span>
              ) : wordSaid ? (
                <span className="err">{wordSaid}</span>
              ) : (
                <span className="dim">
                  The Word file carries nothing but the documents. Printing
                  from the browser adds the date and this page’s address to
                  every margin unless <strong>Headers and footers</strong> is
                  cleared in the print dialog.
                </span>
              )}
            </div>
          </div>

          {forPapers.length > 0 && (
            <div className="paper" dangerouslySetInnerHTML={{ __html: built }} />
          )}
        </>
      )}
    </div>
  );
}
