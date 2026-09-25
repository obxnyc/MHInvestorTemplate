"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import BackLink from "@/components/BackLink";
import AddressPicker, { type Place } from "@/components/AddressPicker";
import { money } from "@/lib/prices";

export type Unit = {
  id: string; label: string; bedrooms: number | null; bathrooms: number | null;
  square_feet: number | null; monthly_rent: number | null;
  is_vacant: boolean; available_on: string | null;
  home_owner: "ours" | "theirs" | "none";
  home_year: number | null; home_make: string | null; home_serial: string | null;
};
export type Property = {
  id: string; name: string; address: string | null; color: string | null;
  kind: Kind; lat: number | null; lng: number | null; confirmed_at: string | null;
  units: Unit[];
};

export type Kind = "sfh" | "mh" | "duplex" | "triplex" | "multi" | "mhp" | "lot";

export const KINDS: [Kind, string][] = [
  ["sfh", "Single-family home"],
  ["mh", "Mobile home"],
  ["duplex", "Duplex"],
  ["triplex", "Triplex"],
  ["multi", "Multi-family"],
  ["mhp", "Mobile home park"],
  ["lot", "Lot"],
];

const KIND_LABEL = Object.fromEntries(KINDS) as Record<Kind, string>;

/** What a "unit" is called depends on what it sits in. In a park they are
 *  lots, everywhere else they are units, and calling a lot a unit to somebody
 *  who runs parks reads as software written by someone who has not been to one. */
const lotWord = (k: Kind, n: number) =>
  k === "mhp" ? (n === 1 ? "lot" : "lots") : (n === 1 ? "unit" : "units");

/**
 * Every property, and every lot in it.
 *
 * One screen rather than a list that opens a page per park, because the useful
 * question is nearly always comparative -- which ones are empty, what is the
 * rent roll, where is the hole -- and an accordion answers it without a
 * navigation each time.
 *
 * Vacancy is editable from the row. It is the field the dashboard prices, and
 * there is no import feeding it yet, so a lot that has been let has to be
 * markable by the person who let it.
 */
export default function PropertyBoard(
  { properties, canEdit, canDelete }:
  { properties: Property[]; canEdit: boolean; canDelete: boolean },
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState<string | null>(properties[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => start(() => router.refresh());

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true); setError(null); setDone(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't work."); return null; }
    refresh();
    return out as Record<string, unknown>;
  }

  const totals = properties.reduce((a, p) => {
    for (const u of p.units) {
      a.units++;
      if (u.is_vacant) { a.vacant++; a.lost += Number(u.monthly_rent ?? 0); }
      else a.roll += Number(u.monthly_rent ?? 0);
    }
    return a;
  }, { units: 0, vacant: 0, roll: 0, lost: 0 });

  return (
    <main className="people">
      <BackLink fallback="/home" />
      <h1 className="pagetitle">Properties</h1>
      <p className="muted">
        {properties.length
          ? `${properties.length} ${properties.length === 1 ? "property" : "properties"}`
            + ` · ${totals.units} lots · ${totals.vacant} empty`
            + ` · ${money(totals.roll * 100)}/mo let`
            + (totals.lost ? ` · ${money(totals.lost * 100)}/mo empty` : "")
          : "Nothing here yet. Add the first one below."}
      </p>

      {error && <p className="err">{error}</p>}
      {done && <p className="okmsg">{done}</p>}

      <ul className="proplist">
        {properties.map((p) => {
          const vacant = p.units.filter((u) => u.is_vacant).length;
          const isOpen = open === p.id;
          return (
            <li key={p.id} className="propcard">
              <button className="prophead" aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : p.id)}>
                <span className="pdot" style={{ background: p.color ?? "var(--faint)" }} />
                <span className="propname">
                  {p.name}
                  {p.address && <span className="propaddr">{p.address}</span>}
                </span>
                <span className="propcount">
                  <span className="kindtag">{KIND_LABEL[p.kind] ?? p.kind}</span>
                  {p.units.length} {lotWord(p.kind, p.units.length)}
                  {vacant ? <span className="pill warn">{vacant} empty</span> : null}
                  {p.lat !== null && !p.confirmed_at && (
                    <span className="pill grey" title="Nobody has checked the aerial">
                      unchecked
                    </span>
                  )}
                </span>
                <span className="propgo" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
              </button>

              {isOpen && (
                <div className="propbody">
                  {p.units.length ? (
                    <ul className="unitlist">
                      {p.units.map((u) => (
                        <li key={u.id} className={u.is_vacant ? "vacant" : ""}>
                          <span className="ulabel">{u.label}</span>
                          <span className="uspec">
                            {[u.bedrooms ? `${u.bedrooms} bed` : null,
                              u.bathrooms ? `${u.bathrooms} bath` : null,
                              u.square_feet ? `${u.square_feet.toLocaleString()} sq ft` : null]
                              .filter(Boolean).join(" · ") || "—"}
                          </span>
                          <span className="urent">
                            {u.monthly_rent ? `${money(Number(u.monthly_rent) * 100)}/mo` : "—"}
                          </span>
                          {p.kind === "mhp" && (
                            /* The distinction the whole park turns on. Shown on
                               every lot rather than only where it is unusual,
                               because "whose home is that" is the question and
                               a blank would read as an answer. */
                            <span className={`whose ${u.home_owner}`}>
                              {u.home_owner === "ours" ? "Our home"
                                : u.home_owner === "theirs" ? "Their home" : "Bare lot"}
                              {u.home_serial ? <span className="serial">{u.home_serial}</span> : null}
                            </span>
                          )}
                          <span className={`ustate ${u.is_vacant ? "isvacant" : ""}`}>
                            {u.is_vacant ? "Empty" : "Let"}
                          </span>
                          {canEdit && (
                            <>
                              <button className="mini" disabled={busy}
                                      onClick={() => call(`/api/units/${u.id}`, "PATCH",
                                                          { isVacant: !u.is_vacant })}>
                                {u.is_vacant ? "Mark let" : "Mark empty"}
                              </button>
                              <button className="mini" disabled={busy}
                                      onClick={() => setEditing(editing === u.id ? null : u.id)}>
                                {editing === u.id ? "Done" : "Details"}
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button className="mini" disabled={busy}
                                    onClick={() => call(`/api/units/${u.id}`, "DELETE")}>
                              Remove
                            </button>
                          )}
                          {editing === u.id && canEdit && (
                            <UnitDetail unit={u} isPark={p.kind === "mhp"} busy={busy}
                                        onSave={async (body) => {
                                          if (await call(`/api/units/${u.id}`, "PATCH", body)) {
                                            setEditing(null);
                                          }
                                        }} />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dashnone">No lots on this one yet.</p>
                  )}

                  {canEdit && <AddUnits propertyId={p.id} busy={busy}
                                        onAdd={async (body) => {
                                          const out = await call(
                                            `/api/properties/${p.id}`, "POST", body);
                                          if (out) {
                                            const n = Number(out.added ?? 0);
                                            const s = Number(out.skipped ?? 0);
                                            setDone(`${n} added${s ? `, ${s} already there` : ""}.`);
                                          }
                                        }} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        adding
          ? <AddProperty busy={busy} onCancel={() => setAdding(false)}
                         onAdd={async (body) => {
                           const out = await call("/api/properties", "POST", body);
                           if (out) { setAdding(false); setOpen(String(out.id)); }
                         }} />
          : <button className="btn pri addprop" onClick={() => setAdding(true)}>
              Add a property
            </button>
      )}
    </main>
  );
}

function AddProperty(
  { busy, onAdd, onCancel }:
  { busy: boolean; onAdd: (b: Record<string, unknown>) => void; onCancel: () => void },
) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("sfh");
  const [color, setColor] = useState("#405981");
  const [place, setPlace] = useState<Place>(
    { address: "", lat: null, lng: null, placeId: null, confirmed: false });

  // The name is nearly always the address for a single house, and nearly never
  // for a park. Filled in from the address only while nobody has typed a name,
  // so it helps without ever overwriting a real one.
  const touched = useRef(false);
  const nameValue = name || (touched.current ? "" : place.address.split(",")[0] ?? "");

  return (
    <form className="addbox" onSubmit={(e) => {
      e.preventDefault();
      onAdd({ name: nameValue, kind, color, address: place.address,
              lat: place.lat, lng: place.lng, placeId: place.placeId,
              confirmed: place.confirmed });
    }}>
      <h2>Add a property</h2>

      <AddressPicker value={place} onChange={setPlace} />

      <label htmlFor="pk">What is it</label>
      <select id="pk" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {kind === "mhp" && (
        <p className="hint">
          You own the dirt. Add the lots underneath, and each one records whether
          the home standing on it is yours or the resident&rsquo;s.
        </p>
      )}

      <label htmlFor="pn">
        Name <span className="opt">— what everyone calls it</span>
      </label>
      <input id="pn" value={nameValue} required
             onChange={(e) => { touched.current = true; setName(e.target.value); }}
             placeholder={kind === "mhp" ? "Oak Grove" : "118 Rosebud Ave"} />

      <label htmlFor="pc">
        Colour <span className="opt">— how it is tinted in the inbox</span>
      </label>
      <input id="pc" type="color" className="colorin"
             value={color} onChange={(e) => setColor(e.target.value)} />

      <div className="acts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn pri"
                disabled={busy || nameValue.trim().length < 2}>
          {busy ? "Adding…" : "Add it"}
        </button>
      </div>
    </form>
  );
}

function AddUnits(
  { propertyId, busy, onAdd }:
  { propertyId: string; busy: boolean; onAdd: (b: Record<string, string>) => void },
) {
  const [labels, setLabels] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [rent, setRent] = useState("");
  return (
    <form className="addunits" key={propertyId}
          onSubmit={(e) => { e.preventDefault(); onAdd({ labels, bedrooms, rent }); setLabels(""); }}>
      <label htmlFor={`u${propertyId}`}>
        Add lots <span className="opt">— &ldquo;1-24&rdquo; or &ldquo;1, 3, 5&rdquo;</span>
      </label>
      <div className="unitrow">
        <input id={`u${propertyId}`} value={labels} required
               onChange={(e) => setLabels(e.target.value)} placeholder="1-24" />
        <input value={bedrooms} onChange={(e) => setBedrooms(e.target.value)}
               inputMode="numeric" placeholder="beds" aria-label="Bedrooms" />
        <input value={rent} onChange={(e) => setRent(e.target.value)}
               inputMode="decimal" placeholder="rent" aria-label="Monthly rent" />
        <button className="btn" disabled={busy || !labels.trim()}>Add</button>
      </div>
    </form>
  );
}


/** Everything about one unit that is not worth a row of its own. Opened per
 *  lot rather than shown always: a park with ninety lots would otherwise be a
 *  wall of empty boxes. */
function UnitDetail(
  { unit, isPark, busy, onSave }:
  { unit: Unit; isPark: boolean; busy: boolean;
    onSave: (b: Record<string, unknown>) => void },
) {
  const [beds, setBeds] = useState(unit.bedrooms?.toString() ?? "");
  const [baths, setBaths] = useState(unit.bathrooms?.toString() ?? "");
  const [sqft, setSqft] = useState(unit.square_feet?.toString() ?? "");
  const [rent, setRent] = useState(unit.monthly_rent?.toString() ?? "");
  const [owner, setOwner] = useState(unit.home_owner);
  const [year, setYear] = useState(unit.home_year?.toString() ?? "");
  const [make, setMake] = useState(unit.home_make ?? "");
  const [serial, setSerial] = useState(unit.home_serial ?? "");

  return (
    <div className="udetail">
      <div className="ufields">
        <label>Beds<input value={beds} inputMode="numeric"
                          onChange={(e) => setBeds(e.target.value)} /></label>
        <label>Baths<input value={baths} inputMode="decimal"
                           onChange={(e) => setBaths(e.target.value)} /></label>
        <label>Sq ft<input value={sqft} inputMode="numeric"
                           onChange={(e) => setSqft(e.target.value)} /></label>
        <label>Rent<input value={rent} inputMode="decimal"
                          onChange={(e) => setRent(e.target.value)} /></label>
      </div>

      {isPark && (
        <>
          <label className="ufull">
            Whose home is on it
            <select value={owner} onChange={(e) => setOwner(e.target.value as Unit["home_owner"])}>
              <option value="ours">Ours — we own the home too</option>
              <option value="theirs">Theirs — they own the home, we rent the lot</option>
              <option value="none">Nothing on it — bare lot</option>
            </select>
          </label>
          {owner !== "none" && (
            <div className="ufields">
              <label>Year<input value={year} inputMode="numeric"
                                onChange={(e) => setYear(e.target.value)} /></label>
              <label>Make<input value={make} onChange={(e) => setMake(e.target.value)} /></label>
              <label className="uwide">
                Serial / VIN
                <input value={serial} onChange={(e) => setSerial(e.target.value)} />
              </label>
            </div>
          )}
          {owner !== "none" && (
            <p className="hint">
              The serial is what a title, an insurance policy and a transport
              permit are all keyed on, and it is the one nobody can find when
              it is needed.
            </p>
          )}
        </>
      )}

      <button className="btn pri mini" disabled={busy}
              onClick={() => onSave({
                bedrooms: beds, bathrooms: baths, squareFeet: sqft, rent,
                ...(isPark ? { homeOwner: owner, homeYear: year,
                               homeMake: make, homeSerial: serial } : {}),
              })}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
