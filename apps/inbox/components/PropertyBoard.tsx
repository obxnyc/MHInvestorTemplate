"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import BackLink from "@/components/BackLink";
import { money } from "@/lib/prices";

export type Unit = {
  id: string; label: string; bedrooms: number | null;
  monthly_rent: number | null; is_vacant: boolean; available_on: string | null;
};
export type Property = {
  id: string; name: string; address: string | null; color: string | null; units: Unit[];
};

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
                  {p.units.length} {p.units.length === 1 ? "lot" : "lots"}
                  {vacant ? <span className="pill warn">{vacant} empty</span> : null}
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
                          <span className="ubeds">
                            {u.bedrooms ? `${u.bedrooms} bed` : "—"}
                          </span>
                          <span className="urent">
                            {u.monthly_rent ? `${money(Number(u.monthly_rent) * 100)}/mo` : "—"}
                          </span>
                          <span className={`ustate ${u.is_vacant ? "isvacant" : ""}`}>
                            {u.is_vacant ? "Empty" : "Let"}
                          </span>
                          {canEdit && (
                            <button className="mini" disabled={busy}
                                    onClick={() => call(`/api/units/${u.id}`, "PATCH",
                                                        { isVacant: !u.is_vacant })}>
                              {u.is_vacant ? "Mark let" : "Mark empty"}
                            </button>
                          )}
                          {canDelete && (
                            <button className="mini" disabled={busy}
                                    onClick={() => call(`/api/units/${u.id}`, "DELETE")}>
                              Remove
                            </button>
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
  { busy: boolean; onAdd: (b: Record<string, string>) => void; onCancel: () => void },
) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [color, setColor] = useState("#405981");
  return (
    <form className="addbox" onSubmit={(e) => { e.preventDefault(); onAdd({ name, address, color }); }}>
      <h2>Add a property</h2>
      <label htmlFor="pn">Name</label>
      <input id="pn" value={name} onChange={(e) => setName(e.target.value)} autoFocus
             placeholder="Oak Grove" required />
      <label htmlFor="pa">Address <span className="opt">— optional</span></label>
      <input id="pa" value={address} onChange={(e) => setAddress(e.target.value)}
             placeholder="1200 Halstead Blvd, Elizabeth City NC" />
      <label htmlFor="pc">
        Colour <span className="opt">— how it is tinted in the inbox</span>
      </label>
      <input id="pc" type="color" className="colorin"
             value={color} onChange={(e) => setColor(e.target.value)} />
      <div className="acts">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn pri" disabled={busy || name.trim().length < 2}>
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
