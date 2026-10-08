"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "@/lib/invoices";
import type { Lot } from "./ParkPlan";

type Owner = { id: string; name: string };
type Sale = {
  id: string; sold_on: string; price_cents: number; down_cents: number;
  financed: boolean; monthly_cents: number | null; rate_bps: number | null;
  term_months: number | null; first_due_on: string | null;
  home_year: number | null; home_make: string | null;
  home_serial: string | null; ended_on: string | null; ended_why: string | null;
  note: string | null; owners: { id: string; name: string } | null;
  // `management_cents` is what the column has been called since 032.
  // The charge is a CONSULTANCY fee and is called that everywhere a
  // person reads it, here and on an owner statement. Renaming the column
  // is a migration that buys nothing; renaming it on screen is the whole
  // of what matters.
  /** The owner carries their own insurance, so there is no warranty fee
   *  to charge. Not the same as the fee being blank, which means nobody
   *  has said yet. */
  owner_insures?: boolean | null;
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
/** The last sale recorded in this park, offered as a starting point. */
type LastAny = {
  id: string; sold_on: string; price_cents: number; down_cents: number;
  financed: boolean; monthly_cents: number | null; rate_bps: number | null;
  term_months: number | null; first_due_on: string | null;
  home_year: number | null; home_make: string | null;
  lot_rent_cents: number | null; management_cents: number | null;
  warranty_cents: number | null; tenant_rent_cents: number | null;
  pet_fee_cents: number | null; late_fee_cents: number | null;
  units: { label: string } | null;
  owners: { id: string; name: string } | null;
};
/** Something we paid for on this home, and whose cheque it comes off. */
type Spend = {
  id: string; sale_id: string | null; spent_on: string; what: string;
  amount_cents: number; from_owner: boolean; bills_on: string | null;
  note: string | null;
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
  const [spends, setSpends] = useState<Spend[]>([]);
  /** Whether 034 has been run, so the card can say what is missing. */
  const [spend, setSpend] = useState(true);
  const [lastAny, setLastAny] = useState<LastAny | null>(null);
  const [recent, setRecent] = useState<LastAny[]>([]);
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
  /** Correcting a sale already on file, rather than ending it. */
  const [fixing, setFixing] = useState(false);
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
    setSpends(out.expenses ?? []);
    setSpend(out.spend !== false);
    setLastAny(out.lastAny ?? null);
    setRecent(out.recent ?? []);
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
    setSelling(false); setEnding(false); setFixing(false);
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
            {!ending && !fixing ? (
              <div className="invacts">
                {/* Typing a bill of sale gets a digit wrong, and ending
                    the sale to retype it would put a line in the history
                    saying the home changed hands when it did not. */}
                <button type="button" className="btn" onClick={() => setFixing(true)}>
                  Edit
                </button>
                <button type="button" className="btn" onClick={() => setEnding(true)}>
                  End ownership
                </button>
              </div>
            ) : fixing ? (
              <SaleForm owners={owners} memory={null} lastAny={null}
                        recent={[]} busy={busy}
                        editing={live}
                        ownerId={ownerId || live.owners?.id || ""}
                        onOwner={(o) => { setOwnerId(o); }}
                        onCancel={() => setFixing(false)}
                        onSave={(payload) => post({ ...payload, action: "amend" })} />
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
                  <button type="submit" className="btn pri" disabled={busy}>Save</button>
                </div>
              </form>
            )}
          </>
        ) : !selling ? (
          <>
            <p className="dim">Nobody is recorded as owning this home.</p>
            <button type="button" className="btn pri" onClick={() => setSelling(true)}>
              Add owner
            </button>
          </>
        ) : (
          <SaleForm owners={owners} memory={memory} lastAny={lastAny}
                    recent={recent} busy={busy}
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

      {/* What we have spent on the home, and what that leaves the owner.
          This is the whole arrangement: the tenant's rent comes to us,
          everything the owner owes comes out of it, what we have paid
          for comes out of it, and the remainder is theirs. Without the
          expenses the figure at the bottom is fiction. */}
      {live && (
        <section className="lotbit">
          <h3>What we have spent</h3>
          <Spending
            spends={spends} live={Boolean(live)} busy={busy || !spend}
            onAdd={(p) => post({ action: "spend", ...p })}
            onDrop={(spendId) => post({ action: "unspend", spendId })} />
          {!spend && (
            <p className="parkhint">
              Migration 034 hasn&rsquo;t been run, so there is nowhere to
              record this yet.
            </p>
          )}
        </section>
      )}

      {live && <Settles sale={live} spends={spends} />}

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
          <button type="submit" className="btn" disabled={busy}>Add meter</button>
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
  const [insures, setInsures] = useState(Boolean(sale.owner_insures));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setInsures(Boolean(sale.owner_insures)); }, [sale.owner_insures]);

  return (
    <form className="saleform" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const ok = await onSave({
        lotRent: f.get("lotRent"), management: f.get("management"),
        warranty: insures ? "" : f.get("warranty"), ownerInsures: insures,
        tenantRent: f.get("tenantRent"),
        petFee: f.get("petFee"), lateFee: f.get("lateFee"),
      });
      if (ok) {
        setSaved(true);
        timer.current = setTimeout(() => setSaved(false), 2500);
      }
    }}>
      <p className="memory">The owner pays the park</p>
      {sale.financed && sale.monthly_cents ? (
        <p className="dim">
          Mortgage {money(sale.monthly_cents)} a month, from the note above.
        </p>
      ) : null}
      <div className="three">
        <label>Lot fee<input name="lotRent" inputMode="decimal" defaultValue={d(sale.lot_rent_cents)} /></label>
        <label>Consultancy<input name="management" inputMode="decimal" defaultValue={d(sale.management_cents)} /></label>
        {!insures && (
          <label>Warranty<input name="warranty" inputMode="decimal"
                                defaultValue={d(sale.warranty_cents)} /></label>
        )}
      </div>
      {/* Their own insurance is an answer, not a blank. A warranty fee
          left empty could mean either, and on a statement those are not
          the same thing. */}
      <label className="check">
        <input type="checkbox" name="ownerInsures" checked={insures}
               onChange={(e) => setInsures(e.target.checked)} />
        They carry their own insurance
      </label>
      <p className="memory">The tenant pays</p>
      <div className="three">
        <label>Rent<input name="tenantRent" inputMode="decimal" defaultValue={d(sale.tenant_rent_cents)} /></label>
        <label>Pet fee<input name="petFee" inputMode="decimal" defaultValue={d(sale.pet_fee_cents)} /></label>
        <label>Late fee<input name="lateFee" inputMode="decimal" defaultValue={d(sale.late_fee_cents)} /></label>
      </div>
      <div className="invacts">
        {saved && <span className="dim">Saved</span>}
        <button type="submit" className="btn pri" disabled={busy}>Save</button>
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
        <button type="submit" className="btn pri" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

/**
 * The buyer, found by typing.
 *
 * A dropdown is fine with eight owners and useless with eighty: the
 * list is alphabetical and the person is looking for "Habberstad",
 * which means scrolling past everything that is not. Typing three
 * letters is how anybody expects to find a name.
 *
 * It is a combobox rather than a plain input with a `datalist`, because
 * what the form has to carry is the owner's id and a datalist hands
 * back only the text -- and two investors can be "Smith Holdings" with
 * different ids.
 *
 * Adding a buyer who is not there is folded in rather than being a
 * separate control. Nobody wants to be told their investor is not on
 * the list and be left to find a second button.
 */
function OwnerPick(
  { owners, value, onPick, onNew }:
  {
    owners: Owner[]; value: string;
    onPick: (id: string) => void;
    onNew: (name: string) => Promise<void>;
  },
) {
  const picked = owners.find((o) => o.id === value) ?? null;
  const [text, setText] = useState(picked?.name ?? "");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);

  // The name follows the id when the id is set from outside -- recalling
  // terms, or a buyer just created.
  useEffect(() => {
    const now = owners.find((o) => o.id === value);
    if (now) setText(now.name);
  }, [value, owners]);

  // Clicking away is how somebody dismisses a list they did not want.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const typed = text.trim();
  const hits = typed
    ? owners.filter((o) => o.name.toLowerCase().includes(typed.toLowerCase())).slice(0, 8)
    : owners.slice(0, 8);
  // An exact name already on file is not something to offer to create
  // again -- that is how a second "Habberstad Norse Ventures LLC" gets
  // made, and then half the park is filed under each.
  const known = owners.some((o) => o.name.toLowerCase() === typed.toLowerCase());
  const canAdd = Boolean(typed) && !known;

  function take(o: Owner) {
    onPick(o.id);
    setText(o.name);
    setOpen(false);
  }

  return (
    <div className="ownerpick" ref={box}>
      <label>Who bought it
        <input
          value={text}
          autoComplete="off"
          placeholder="Start typing their name or LLC"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setAt(0);
            // Typing past a chosen buyer un-chooses them, so the form
            // cannot save an id that no longer matches what is on screen.
            if (value) onPick("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault(); setOpen(true);
              setAt((i) => Math.min(i + 1, hits.length - (canAdd ? 0 : 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault(); setAt((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Enter picks from the list; it does not submit a form
              // that has not got a buyer yet.
              if (open && hits[at]) { e.preventDefault(); take(hits[at]); }
              else if (open && canAdd && at >= hits.length) {
                e.preventDefault(); void onNew(typed); setOpen(false);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }} />
      </label>
      {/* What the form actually carries. The box above is for finding a
          buyer; this is the answer. */}
      <input type="hidden" name="ownerId" value={value} />

      {open && (hits.length > 0 || canAdd) && (
        <ul className="ownerhits">
          {hits.map((o, i) => (
            <li key={o.id}>
              <button type="button" className={i === at ? "on" : ""}
                      onMouseEnter={() => setAt(i)}
                      onClick={() => take(o)}>
                {o.name}
              </button>
            </li>
          ))}
          {canAdd && (
            <li>
              <button type="button"
                      className={at >= hits.length ? "on make" : "make"}
                      onMouseEnter={() => setAt(hits.length)}
                      onClick={() => { void onNew(typed); setOpen(false); }}>
                Add &ldquo;{typed}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
      {!value && typed && (
        <p className="dim">Pick them from the list, or add them.</p>
      )}
    </div>
  );
}

/**
 * What we have paid for on this home.
 *
 * We front the cost and take it off what we send the owner, so each one
 * is a line on their statement and has to be in words they will
 * recognise -- "Water heater", not a job number.
 *
 * Not everything is theirs. A repair covered by the warranty they are
 * paying us for is ours, and so is damage we caused, so the tick is
 * asked separately rather than assumed from the fact that we paid it.
 */
function Spending(
  { spends, live, busy, onAdd, onDrop }:
  {
    spends: Spend[]; live: boolean; busy: boolean;
    onAdd: (p: Record<string, unknown>) => Promise<boolean>;
    onDrop: (id: string) => Promise<boolean>;
  },
) {
  const [mine, setMine] = useState(true);
  return (
    <>
      {spends.length > 0 && (
        <ul className="lotlist">
          {spends.map((sp) => (
            <li key={sp.id}>
              <strong>{money(sp.amount_cents)}</strong> {sp.what}
              <span className="dim"> · {sp.spent_on}</span>
              {!sp.from_owner && <span className="dim"> · ours, not deducted</span>}
              <button type="button" className="aslink" disabled={busy}
                      onClick={() => onDrop(sp.id)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="rowform" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        const ok = await onAdd({
          what: f.get("what"), amount: f.get("amount"),
          on: f.get("on"), fromOwner: mine,
        });
        if (ok) { form.reset(); setMine(true); }
      }}>
        <div className="three">
          <label>What<input name="what" placeholder="Water heater" required /></label>
          <label>Cost<input name="amount" inputMode="decimal" placeholder="485" required /></label>
          <label>When<input name="on" type="date" /></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={mine} disabled={!live}
                 onChange={(e) => setMine(e.target.checked)} />
          Take it off the owner
        </label>
        <button type="submit" className="btn" disabled={busy}>Add expense</button>
      </form>
    </>
  );
}

/**
 * What the owner is actually owed this month.
 *
 * The arrangement written out: the tenant's rent comes to us, the
 * mortgage, the lot fee, the consultancy fee and the warranty come out
 * of it, what we have spent comes out of it, and what is left is sent
 * on. It is the only figure on the card nobody can work out in their
 * head, and the one an owner will ring about.
 *
 * On the charges, not on receipts. Nothing here knows whether October's
 * rent arrived, so the line says so rather than letting a number that
 * assumes it go out looking like a fact.
 */
function Settles({ sale, spends }: { sale: Sale; spends: Spend[] }) {
  const n = (v: number | null | undefined) => v ?? 0;
  const inAll = n(sale.tenant_rent_cents);
  const owes = n(sale.monthly_cents) + n(sale.lot_rent_cents)
             + n(sale.management_cents) + n(sale.warranty_cents);
  const paid = spends.filter((s) => s.from_owner)
                     .reduce((t, s) => t + s.amount_cents, 0);
  const net = inAll - owes - paid;
  if (!inAll && !owes && !paid) return null;

  return (
    <section className="lotbit">
      <h3>What we send them</h3>
      <dl className="lotfacts">
        <dt>Rent in</dt><dd>{money(inAll)}</dd>
        <dt>They owe</dt>
        <dd>
          {money(owes)}
          <span className="dim">
            {" "}
            {[
              sale.financed && sale.monthly_cents ? "mortgage" : null,
              sale.lot_rent_cents ? "lot fee" : null,
              sale.management_cents ? "consultancy" : null,
              sale.warranty_cents ? "warranty" : null,
            ].filter(Boolean).join(" + ") || "nothing recorded"}
          </span>
        </dd>
        <dt>We spent</dt><dd>{money(paid)}</dd>
        <dt>Net to them</dt>
        <dd><strong className={net < 0 ? "parkbad" : "parkok"}>{money(net)}</strong></dd>
      </dl>
      <p className="dim">
        On the agreed charges, not on what has actually come in — nothing
        here knows yet whether the rent arrived.
      </p>
    </section>
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
  { owners, memory, lastAny, recent, editing, busy, ownerId, onOwner, onCancel, onSave }:
  {
    owners: Owner[]; busy: boolean; ownerId: string;
    /** A sale already on file, being corrected rather than recorded. */
    editing?: Sale | null;
    memory: { price_cents: number; down_cents: number; financed: boolean;
              monthly_cents: number | null; rate_bps: number | null;
              term_months: number | null } | null;
    /** The last sale recorded in this park, whoever bought it. */
    lastAny: LastAny | null;
    /** The last few, so a recall can name which one. */
    recent: LastAny[];
    onOwner: (id: string) => void;
    onCancel: () => void;
    onSave: (p: Record<string, unknown>) => Promise<boolean>;
  },
) {
  /**
   * Terms recalled from an earlier sale.
   *
   * Ten homes sold on the same terms is the same form ten times, and the
   * buyer memory only helps when it is the same buyer. This is the deal
   * rather than the person: price, note and the monthly charges, with
   * the buyer and the date left blank, because those are the two things
   * that are never the same twice.
   *
   * The form is uncontrolled, so recalling remounts it through `key`
   * rather than reaching into the DOM to set values.
   */
  const [recall, setRecall] = useState<LastAny | null>(null);
  const [picking, setPicking] = useState(false);
  // Correcting beats recalling beats remembering beats blank.
  const from = (editing as unknown as LastAny | null) ?? recall ?? null;
  const was = editing ? null : memory;

  const [financed, setFinanced] = useState(
    editing ? Boolean(editing.financed) : memory?.financed ?? true);
  const [problem, setProblem] = useState<string | null>(null);
  const d = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

  async function addOwner(name: string) {
    const res = await fetch("/api/owners", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setProblem(out.error ?? "Could not add them."); return; }
    onOwner(out.owner?.id ?? out.id ?? "");
  }

  return (
    <form className="saleform" key={recall?.id ?? "blank"} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      await onSave({
        ownerId: f.get("ownerId"), soldOn: f.get("soldOn"),
        price: f.get("price"), down: f.get("down"),
        financed, monthly: f.get("monthly"), ratePct: f.get("ratePct"),
        termMonths: f.get("termMonths"), firstDueOn: f.get("firstDueOn"),
        homeYear: f.get("homeYear"), homeMake: f.get("homeMake"),
        homeSerial: f.get("homeSerial"), note: f.get("note"),
        // The monthly charges come over with the terms, so ten identical
        // homes do not need the charges typed ten times either.
        lotRent: f.get("lotRent"), management: f.get("management"),
        warranty: f.get("warranty"), tenantRent: f.get("tenantRent"),
        petFee: f.get("petFee"), lateFee: f.get("lateFee"),
      });
    }}>
      {editing && (
        <p className="memory">
          Correcting what is on file. This does not change hands — if the
          home has been sold on, close this and use{" "}
          <strong>End ownership</strong> instead.
        </p>
      )}
      {/* Ten homes to one investor on one day is one form filled in and
          nine recalled. Everything comes over -- the buyer and the date
          included, because when a recall is wanted at all those are
          usually the same too, and changing one date is quicker than
          typing fourteen fields. */}
      {!editing && recent.length > 0 && !recall && (
        <div className="recall">
          <p>Copy a sale you have already recorded here.</p>
          {!picking ? (
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              Recall
            </button>
          ) : (
            <ul className="recalls">
              {recent.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => {
                    setRecall(r);
                    setPicking(false);
                    setFinanced(Boolean(r.financed));
                    if (r.owners?.id) onOwner(r.owners.id);
                  }}>
                    <strong>{r.units?.label ?? "another lot"}</strong>
                    <span className="dim">
                      {" "}{r.owners?.name ?? "no buyer"} · {r.sold_on}
                      {" · "}{money(r.price_cents)}
                      {r.financed && r.monthly_cents
                        ? ` · ${money(r.monthly_cents)}/mo` : " · outright"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {recall && !editing && (
        <p className="memory">
          Copied from {recall.units?.label ?? "an earlier sale"} — buyer,
          date, terms and charges. The serial is this home&rsquo;s own.
          Change whatever differs.{" "}
          <button type="button" className="aslink" onClick={() => {
            setRecall(null);
            setPicking(false);
            onOwner("");
          }}>
            start blank
          </button>
        </p>
      )}
      {problem && <p className="err">{problem}</p>}
      <OwnerPick owners={owners} value={ownerId} onPick={onOwner} onNew={addOwner} />

      {memory && (
        <p className="memory">
          Their last deal: {money(memory.price_cents)}
          {memory.financed
            ? `, financed at ${money(memory.monthly_cents ?? 0)} a month over ${memory.term_months} months`
            : ", paid outright"}. Filled in below.
        </p>
      )}

      <div className="three">
        <label>Sold on<input name="soldOn" type="date"
                              defaultValue={editing?.sold_on ?? recall?.sold_on ?? ""} /></label>
        <label>Price<input name="price" inputMode="decimal" required
                           defaultValue={d(from?.price_cents ?? was?.price_cents)} /></label>
        <label>Down<input name="down" inputMode="decimal"
                          defaultValue={d(from?.down_cents ?? was?.down_cents)} /></label>
      </div>

      <label className="check">
        <input type="checkbox" checked={financed} onChange={(e) => setFinanced(e.target.checked)} />
        We hold the note
      </label>
      {financed && (
        <>
          <div className="three">
            <label>Monthly<input name="monthly" inputMode="decimal"
                                 defaultValue={d(from?.monthly_cents ?? was?.monthly_cents)} /></label>
            <label>Rate %<input name="ratePct" inputMode="decimal"
                                defaultValue={(() => {
                                  const bps = from?.rate_bps ?? was?.rate_bps;
                                  return bps ? (bps / 100).toFixed(2) : "";
                                })()} /></label>
            <label>Months<input name="termMonths" inputMode="numeric"
                                defaultValue={from?.term_months ?? was?.term_months ?? ""} /></label>
          </div>
          <label>First payment due<input name="firstDueOn" type="date"
                                         defaultValue={from?.first_due_on ?? ""} /></label>
        </>
      )}

      {/* Set here as well as on the card afterwards. On ten homes let on
          the park's standard terms these six are identical every time,
          and filling them in with the sale is the difference between one
          form and eleven.
          Not while correcting a sale: the charges have their own form
          further down the card, and showing them twice is two places to
          change one number. */}
      {!editing && <>
      <p className="memory">Every month, from the day it sells</p>
      <div className="three">
        <label>Lot fee<input name="lotRent" inputMode="decimal"
                             defaultValue={d(from?.lot_rent_cents)} /></label>
        <label>Consultancy<input name="management" inputMode="decimal"
                                 defaultValue={d(from?.management_cents)} /></label>
        <label>Warranty<input name="warranty" inputMode="decimal"
                              defaultValue={d(from?.warranty_cents)} /></label>
      </div>
      <div className="three">
        <label>Tenant rent<input name="tenantRent" inputMode="decimal"
                                 defaultValue={d(from?.tenant_rent_cents)} /></label>
        <label>Pet fee<input name="petFee" inputMode="decimal"
                             defaultValue={d(from?.pet_fee_cents)} /></label>
        <label>Late fee<input name="lateFee" inputMode="decimal"
                              defaultValue={d(from?.late_fee_cents)} /></label>
      </div>
      </>}

      <div className="three">
        <label>Year<input name="homeYear" inputMode="numeric"
                          defaultValue={from?.home_year ?? ""} /></label>
        <label>Make<input name="homeMake" defaultValue={from?.home_make ?? ""} /></label>
        {/* Never recalled. Two homes can be the same year and make; no
            two share a serial, and a copied one is a wrong one on a
            bill of sale. */}
        <label>Serial<input name="homeSerial" defaultValue={editing?.home_serial ?? ""}
                            placeholder={recall ? "this home's own" : undefined} /></label>
      </div>
      <label>Note<textarea name="note" rows={2} defaultValue={editing?.note ?? ""} /></label>

      <div className="invacts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn pri" disabled={busy}>
          {editing ? "Save" : "Save sale"}
        </button>
      </div>
    </form>
  );
}
