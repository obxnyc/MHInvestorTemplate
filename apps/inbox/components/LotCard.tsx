"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "@/lib/invoices";
import type { Lot } from "./ParkPlan";

type Owner = { id: string; name: string };
type Sale = {
  id: string; sold_on: string; price_cents: number; down_cents: number;
  financed: boolean; monthly_cents: number | null; rate_bps: number | null;
  term_months: number | null; home_year: number | null; home_make: string | null;
  home_serial: string | null; ended_on: string | null; ended_why: string | null;
  note: string | null; owners: { id: string; name: string } | null;
  // `management_cents` is what the column has been called since 032.
  // The charge is a CONSULTANCY fee and is called that everywhere a
  // person reads it, here and on an owner statement. Renaming the column
  // is a migration that buys nothing; renaming it on screen is the whole
  // of what matters.
  lot_rent_cents?: number | null; management_cents?: number | null;
  warranty_cents?: number | null; tenant_rent_cents?: number | null;
  pet_fee_cents?: number | null; late_fee_cents?: number | null;
};
type Paper = {
  id: string; kind: string; name: string | null; path: string;
  signed_on: string | null; url?: string;
};
type Meter = {
  id: string; kind: string; serial: string | null; provider: string | null;
  account_ref: string | null; fitted_on: string | null;
};
type Shed = {
  id: string; label: string | null; size: string | null;
  monthly_cents: number; started_on: string;
};

const KIND: Record<string, string> = {
  poh: "Park owned", toh: "Tenant owned", ioh: "Investor owned", none: "No home on it",
};
/** What a home we still own is for. Only the first is stock. */
const USE: [string, string][] = [
  ["to_sell", "Ours to sell"],
  ["we_rent", "We rent it out"],
  ["not_home", "Not a home"],
];
const USE_WHY: Record<string, string> = {
  to_sell: "Counted in what is left to sell. It can still be let in the meantime.",
  we_rent: "Ours, let, and we are keeping it. Not counted as stock.",
  not_home: "The office, the laundry, a storage building. We may let it, "
    + "but it is not a home and will not be sold.",
};
const PAPER: Record<string, string> = {
  bill_of_sale: "Bill of sale", lease: "Lease", note: "Promissory note",
  title: "Title", warranty: "Warranty", other: "Other",
};

/**
 * One pad, opened.
 *
 * The questions in the order somebody asks them: whose home is this, who
 * lives in it, what does each of them pay us every month, and where is the
 * paper that says so. The meters and the shed come last because they are
 * looked up rather than read -- nobody opens a lot to find out the meter
 * number, they open it holding a bill.
 *
 * Everything saves on its own. A card with one Save button at the bottom is
 * a card where correcting a lot fee means re-reading nine other fields to
 * check nothing else moved.
 */
export default function LotCard(
  { lot, onClose, onChanged }:
  { lot: Lot; onClose: () => void; onChanged: () => void },
) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [kind, setKind] = useState<string>("none");
  const [manage, setManage] = useState(false);
  /** On a home we still own: inventory, a letting, or not a home. */
  const [use, setUse] = useState<string>("to_sell");
  const [rent, setRent] = useState<{
    tenant: number | null; pet: number | null; late: number | null;
  }>({ tenant: null, pet: null, late: null });
  /** Whether 033 has been run, so the card can say what is missing. */
  const [keeps, setKeeps] = useState(true);
  const [pending, setPending] = useState(false);
  const [selling, setSelling] = useState(false);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [memory, setMemory] = useState<{
    price_cents: number; down_cents: number; financed: boolean;
    monthly_cents: number | null; rate_bps: number | null; term_months: number | null;
  } | null>(null);

  const load = useCallback(async (owner?: string) => {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    const res = await fetch(`/api/units/${lot.id}/sale${q}`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (out.pending) { setPending(true); return; }
    setOwners(out.owners ?? []);
    setSales(out.sales ?? []);
    setPapers(out.papers ?? []);
    setMeters(out.meters ?? []);
    setSheds(out.storage ?? []);
    setKind(out.unit?.kind ?? "none");
    setManage(Boolean(out.unit?.manage));
    setUse(out.unit?.use ?? "to_sell");
    setRent(out.unit?.rent ?? { tenant: null, pet: null, late: null });
    setKeeps(out.keeps !== false);
    setMemory(out.lastFor ?? null);
  }, [lot.id]);
  useEffect(() => { void load(); }, [load]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
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
  }, [lot.id, load, onChanged]);

  const live = sales.find((s) => !s.ended_on) ?? null;
  const past = sales.filter((s) => s.ended_on);

  return (
    <aside className="lotcard">
      <header>
        <h2>Lot {lot.label}</h2>
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </header>

      {pending && (
        <p className="parkhint">
          Migration 030 hasn&rsquo;t been run, so there is nowhere to record a
          sale yet.
        </p>
      )}
      {error && <p className="err">{error}</p>}

      {/* Whose home is this. The first question, and the one the map
          paints, so it is the first thing on the card. */}
      <section className="lotbit">
        <h3>The home</h3>
        <div className="kindpick">
          {(["poh", "toh", "ioh", "none"] as const).map((k) => (
            <button key={k} type="button" disabled={busy}
                    className={kind === k ? "chip on" : "chip"}
                    onClick={() => { setKind(k); void post({ action: "kind", kind: k, manage }); }}>
              {KIND[k]}
            </button>
          ))}
        </div>
        {kind !== "none" && kind !== "poh" && (
          <label className="check">
            <input type="checkbox" checked={manage} disabled={busy}
                   onChange={(e) => {
                     setManage(e.target.checked);
                     void post({ action: "kind", kind, manage: e.target.checked });
                   }} />
            We let it and look after it
          </label>
        )}

        {/* A home we still own is one of three things, and only the first
            is stock. Without this, "park owned" counts the office and the
            laundry as homes for sale. */}
        {kind === "poh" && (
          <>
            <p className="dim">We still own this one.</p>
            <div className="kindpick">
              {USE.map(([k, say]) => (
                <button key={k} type="button" disabled={busy || !keeps}
                        className={use === k ? "chip on" : "chip"}
                        onClick={() => { setUse(k); void post({ action: "use", use: k }); }}>
                  {say}
                </button>
              ))}
            </div>
            <p className="dim">{USE_WHY[use] ?? ""}</p>
            {!keeps && (
              <p className="parkhint">
                Migration 033 hasn&rsquo;t been run, so this is not saved yet.
              </p>
            )}
          </>
        )}
      </section>

      {/* Who owns it, and what they bought.
          Not on a home we still own: there is no buyer, no sale date, no
          price and no bill of sale, because nothing has been sold. Asking
          for them is asking somebody to invent an answer. A bare pad has
          no home to have been sold either. */}
      {kind !== "poh" && kind !== "none" && (
      <section className="lotbit">
        <h3>Owner</h3>
        {live ? (
          <>
            <dl className="lotfacts">
              <dt>Owner</dt><dd>{live.owners?.name ?? "—"}</dd>
              <dt>Bought</dt><dd>{live.sold_on} for {money(live.price_cents)}</dd>
              {live.financed && (
                <>
                  <dt>We hold a note</dt>
                  <dd>
                    {money(live.monthly_cents ?? 0)} a month
                    {live.rate_bps ? ` at ${(live.rate_bps / 100).toFixed(2)}%` : ""}
                    {live.term_months ? ` over ${live.term_months} months` : ""}
                  </dd>
                </>
              )}
              {(live.home_year || live.home_make) && (
                <>
                  <dt>Home</dt>
                  <dd>{[live.home_year, live.home_make].filter(Boolean).join(" ")}
                    {live.home_serial ? ` · ${live.home_serial}` : ""}</dd>
                </>
              )}
            </dl>
            {!ending ? (
              <button type="button" className="btn" onClick={() => setEnding(true)}>
                They no longer own it
              </button>
            ) : (
              <form className="saleform" onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await post({ action: "end", why: f.get("why"), on: f.get("on") });
              }}>
                <label>What happened
                  <input name="why" required placeholder="Sold on, taken back, home removed" /></label>
                <label>When<input name="on" type="date" /></label>
                <div className="invacts">
                  <button type="button" className="btn" onClick={() => setEnding(false)}>Cancel</button>
                  <button type="submit" className="btn pri" disabled={busy}>Record it</button>
                </div>
              </form>
            )}
          </>
        ) : !selling ? (
          <>
            <p className="dim">Nobody is recorded as owning this home.</p>
            <button type="button" className="btn pri" onClick={() => setSelling(true)}>
              Record who owns it
            </button>
          </>
        ) : (
          <SaleForm owners={owners} memory={memory} busy={busy}
                    onOwner={(o) => { setOwnerId(o); void load(o); }}
                    ownerId={ownerId}
                    onCancel={() => setSelling(false)}
                    onSave={(payload) => post(payload)} />
        )}
      </section>
      )}

      {/* A home we own and let. No lot rent and no consultancy fee:
          there is no second party to charge either to -- we are both
          sides of it -- so the rent is the only money there is. */}
      {kind === "poh" && (
        <section className="lotbit">
          <h3>{use === "not_home" ? "What we let it for" : "Every month"}</h3>
          <RentForm rent={rent} busy={busy || !keeps} structure={use === "not_home"}
                    onSave={(p) => post({ action: "rent", ...p })} />
        </section>
      )}

      {/* What arrives every month. Six figures that land on one statement
          and get argued about one at a time, which is why each is its own
          field rather than a total. */}
      {live && (
        <section className="lotbit">
          <h3>Every month</h3>
          <MoneyForm sale={live} busy={busy} onSave={(p) => post({ action: "money", ...p })} />
        </section>
      )}

      {/* The paper behind the figures. */}
      {live && (
        <section className="lotbit">
          <h3>Paperwork</h3>
          <Papers unitId={lot.id} papers={papers} busy={busy}
                  onFiled={() => { void load(); }}
                  onRemove={(paperId) => post({ action: "unpaper", paperId })} />
        </section>
      )}

      <section className="lotbit">
        <h3>Storage in the yard</h3>
        {sheds.length > 0 && (
          <ul className="lotlist">
            {sheds.map((sd) => (
              <li key={sd.id}>
                {sd.label || "Storage"}{sd.size ? ` · ${sd.size}` : ""}
                {" — "}{money(sd.monthly_cents)} a month
                <button type="button" className="aslink" disabled={busy}
                        onClick={() => post({ action: "unstorage", storageId: sd.id })}>
                  gone
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="rowform" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await post({
            action: "storage", label: f.get("label"),
            size: f.get("size"), monthly: f.get("monthly"),
          });
          if (ok) e.currentTarget.reset();
        }}>
          <div className="three">
            <label>What<input name="label" placeholder="Shed" /></label>
            <label>Size<input name="size" placeholder="10x12" /></label>
            <label>A month<input name="monthly" inputMode="decimal" placeholder="45" required /></label>
          </div>
          <button type="submit" className="btn" disabled={busy}>Add storage</button>
        </form>
      </section>

      <section className="lotbit">
        <h3>Meters</h3>
        {meters.length > 0 && (
          <ul className="lotlist">
            {meters.map((mt) => (
              <li key={mt.id}>
                <strong>{mt.kind}</strong> {mt.serial || "no number"}
                {mt.provider ? ` · ${mt.provider}` : ""}
                {mt.account_ref ? ` · acct ${mt.account_ref}` : ""}
              </li>
            ))}
          </ul>
        )}
        <form className="rowform" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await post({
            action: "meter", kind: f.get("kind"), serial: f.get("serial"),
            provider: f.get("provider"), account: f.get("account"),
          });
          if (ok) e.currentTarget.reset();
        }}>
          <div className="three">
            <label>Which
              <select name="kind">
                <option value="water">Water</option>
                <option value="electric">Electric</option>
                <option value="gas">Gas</option>
              </select>
            </label>
            <label>Number<input name="serial" placeholder="81-440391" /></label>
            <label>Provider<input name="provider" placeholder="PWC" /></label>
          </div>
          <label>Account reference<input name="account" /></label>
          <button type="submit" className="btn" disabled={busy}>Record the meter</button>
        </form>
        <p className="dim">
          Recording one replaces the one in service and keeps the old number.
        </p>
      </section>

      {past.length > 0 && (
        <div className="lothist">
          <h3>Before</h3>
          <ul>
            {past.map((s) => (
              <li key={s.id}>
                {s.owners?.name ?? "—"}, {s.sold_on} to {s.ended_on}
                {s.ended_why ? ` — ${s.ended_why}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

/** The six monthly figures. Saved together because they are read together
 *  and because a statement is wrong if any one of them is stale. */
function MoneyForm(
  { sale, busy, onSave }:
  { sale: Sale; busy: boolean; onSave: (p: Record<string, unknown>) => Promise<boolean> },
) {
  const d = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <form className="saleform" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const ok = await onSave({
        lotRent: f.get("lotRent"), management: f.get("management"),
        warranty: f.get("warranty"), tenantRent: f.get("tenantRent"),
        petFee: f.get("petFee"), lateFee: f.get("lateFee"),
      });
      if (ok) {
        setSaved(true);
        timer.current = setTimeout(() => setSaved(false), 2500);
      }
    }}>
      <p className="memory">The owner pays the park</p>
      <div className="three">
        <label>Lot rent<input name="lotRent" inputMode="decimal" defaultValue={d(sale.lot_rent_cents)} /></label>
        <label>Consultancy<input name="management" inputMode="decimal" defaultValue={d(sale.management_cents)} /></label>
        <label>Warranty<input name="warranty" inputMode="decimal" defaultValue={d(sale.warranty_cents)} /></label>
      </div>
      <p className="memory">The tenant pays</p>
      <div className="three">
        <label>Rent<input name="tenantRent" inputMode="decimal" defaultValue={d(sale.tenant_rent_cents)} /></label>
        <label>Pet fee<input name="petFee" inputMode="decimal" defaultValue={d(sale.pet_fee_cents)} /></label>
        <label>Late fee<input name="lateFee" inputMode="decimal" defaultValue={d(sale.late_fee_cents)} /></label>
      </div>
      <div className="invacts">
        {saved && <span className="dim">Saved</span>}
        <button type="submit" className="btn pri" disabled={busy}>Save the charges</button>
      </div>
    </form>
  );
}

/**
 * What the person living in a home WE own pays.
 *
 * Three fields, not six. A home we own and let has no owner to charge
 * lot rent to, no consultancy fee to take from ourselves and no warranty
 * to sell ourselves, and a form that asks for them anyway invites
 * somebody to fill one in.
 */
function RentForm(
  { rent, busy, structure, onSave }:
  {
    rent: { tenant: number | null; pet: number | null; late: number | null };
    busy: boolean;
    /** A storage building or the laundry rather than a home. Same three
     *  figures -- we let those too -- said in the words that fit. */
    structure?: boolean;
    onSave: (p: Record<string, unknown>) => Promise<boolean>;
  },
) {
  const d = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <form className="saleform" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const ok = await onSave({
        tenantRent: f.get("tenantRent"), petFee: f.get("petFee"),
        lateFee: f.get("lateFee"),
      });
      if (ok) {
        setSaved(true);
        timer.current = setTimeout(() => setSaved(false), 2500);
      }
    }}>
      <p className="memory">{structure ? "Whoever rents it pays" : "The tenant pays"}</p>
      <div className="three">
        <label>Rent<input name="tenantRent" inputMode="decimal"
                          defaultValue={d(rent.tenant)} /></label>
        <label>Pet fee<input name="petFee" inputMode="decimal"
                             defaultValue={d(rent.pet)} /></label>
        <label>Late fee<input name="lateFee" inputMode="decimal"
                              defaultValue={d(rent.late)} /></label>
      </div>
      <div className="invacts">
        {saved && <span className="dim">Saved</span>}
        <button type="submit" className="btn pri" disabled={busy}>Save the rent</button>
      </div>
    </form>
  );
}

/** The bill of sale, the lease and anything else. Uploaded first, filed
 *  second: the file has to exist before a row can point at it. */
function Papers(
  { unitId, papers, busy, onFiled, onRemove }:
  {
    unitId: string; papers: Paper[]; busy: boolean;
    onFiled: () => void; onRemove: (id: string) => Promise<boolean>;
  },
) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function take(files: FileList | null, kind: string) {
    if (!files?.length) return;
    setSending(true); setProblem(null);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("file", f);
    const up = await fetch(`/api/units/${unitId}/attach`, { method: "POST", body: form });
    const got = await up.json().catch(() => ({}));
    if (!up.ok) { setSending(false); setProblem(got.error ?? "That didn't upload."); return; }

    for (const f of got.files ?? []) {
      const res = await fetch(`/api/units/${unitId}/sale`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "paper", kind, path: f.path, name: f.name }),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        setProblem(out.error ?? "Filed nowhere.");
      }
    }
    setSending(false);
    onFiled();
  }

  return (
    <>
      {problem && <p className="err">{problem}</p>}
      {papers.length > 0 && (
        <ul className="lotlist">
          {papers.map((p) => (
            <li key={p.id}>
              {p.url
                ? <a href={p.url} target="_blank" rel="noreferrer">{p.name || PAPER[p.kind] || p.kind}</a>
                : (p.name || PAPER[p.kind] || p.kind)}
              <span className="dim"> {PAPER[p.kind] ?? p.kind}</span>
              <button type="button" className="aslink" disabled={busy}
                      onClick={() => onRemove(p.id)}>remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="papergrab">
        {(["bill_of_sale", "lease", "note", "other"] as const).map((k) => (
          <label key={k} className="chip">
            {PAPER[k]}
            <input type="file" hidden multiple disabled={sending}
                   onChange={(e) => { void take(e.target.files, k); e.target.value = ""; }} />
          </label>
        ))}
      </div>
      {sending && <p className="dim">Uploading…</p>}
    </>
  );
}

/** Recording a sale, with the buyer's last deal pre-filled. An investor
 *  with nine homes buys the tenth on the same terms as the ninth, and
 *  retyping them is how a rate ends up different on one lot for no reason
 *  anybody can explain two years later. */
function SaleForm(
  { owners, memory, busy, ownerId, onOwner, onCancel, onSave }:
  {
    owners: Owner[]; busy: boolean; ownerId: string;
    memory: { price_cents: number; down_cents: number; financed: boolean;
              monthly_cents: number | null; rate_bps: number | null;
              term_months: number | null } | null;
    onOwner: (id: string) => void;
    onCancel: () => void;
    onSave: (p: Record<string, unknown>) => Promise<boolean>;
  },
) {
  const [financed, setFinanced] = useState(memory?.financed ?? true);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const d = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

  async function addOwner(name: string) {
    const res = await fetch("/api/owners", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setProblem(out.error ?? "Could not add them."); return; }
    setAdding(false);
    onOwner(out.owner?.id ?? out.id ?? "");
  }

  return (
    <form className="saleform" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      await onSave({
        ownerId: f.get("ownerId"), soldOn: f.get("soldOn"),
        price: f.get("price"), down: f.get("down"),
        financed, monthly: f.get("monthly"), ratePct: f.get("ratePct"),
        termMonths: f.get("termMonths"), firstDueOn: f.get("firstDueOn"),
        homeYear: f.get("homeYear"), homeMake: f.get("homeMake"),
        homeSerial: f.get("homeSerial"), note: f.get("note"),
      });
    }}>
      {problem && <p className="err">{problem}</p>}
      <label>Who bought it
        <select name="ownerId" required value={ownerId}
                onChange={(e) => onOwner(e.target.value)}>
          <option value="">Pick a buyer…</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      {!adding ? (
        <button type="button" className="aslink" onClick={() => setAdding(true)}>
          add a buyer who isn&rsquo;t on the list
        </button>
      ) : (
        <div className="two">
          <input id="newowner" placeholder="Their name or LLC" />
          <button type="button" className="btn" onClick={() => {
            const el = document.getElementById("newowner") as HTMLInputElement | null;
            if (el?.value.trim()) void addOwner(el.value.trim());
          }}>Add them</button>
        </div>
      )}

      {memory && (
        <p className="memory">
          Their last deal: {money(memory.price_cents)}
          {memory.financed
            ? `, financed at ${money(memory.monthly_cents ?? 0)} a month over ${memory.term_months} months`
            : ", paid outright"}. Filled in below.
        </p>
      )}

      <div className="three">
        <label>Sold on<input name="soldOn" type="date" /></label>
        <label>Price<input name="price" inputMode="decimal" required
                           defaultValue={d(memory?.price_cents)} /></label>
        <label>Down<input name="down" inputMode="decimal"
                          defaultValue={d(memory?.down_cents)} /></label>
      </div>

      <label className="check">
        <input type="checkbox" checked={financed} onChange={(e) => setFinanced(e.target.checked)} />
        We hold the note
      </label>
      {financed && (
        <>
          <div className="three">
            <label>Monthly<input name="monthly" inputMode="decimal"
                                 defaultValue={d(memory?.monthly_cents)} /></label>
            <label>Rate %<input name="ratePct" inputMode="decimal"
                                defaultValue={memory?.rate_bps ? (memory.rate_bps / 100).toFixed(2) : ""} /></label>
            <label>Months<input name="termMonths" inputMode="numeric"
                                defaultValue={memory?.term_months ?? ""} /></label>
          </div>
          <label>First payment due<input name="firstDueOn" type="date" /></label>
        </>
      )}

      <div className="three">
        <label>Year<input name="homeYear" inputMode="numeric" /></label>
        <label>Make<input name="homeMake" /></label>
        <label>Serial<input name="homeSerial" /></label>
      </div>
      <label>Note<textarea name="note" rows={2} /></label>

      <div className="invacts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn pri" disabled={busy}>Record the sale</button>
      </div>
    </form>
  );
}
