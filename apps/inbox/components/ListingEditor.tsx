"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type ListingDraft = {
  onZillow: boolean;
  listedAt: string | null;
  headline: string;
  description: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  deposit: string;
  pets: "cats" | "dogs" | "both" | "none" | "ask";
  leaseMonths: string;
  photos: string[];
};

type Facts = { bedrooms: string; bathrooms: string; rent: string; squareFeet: string };

/**
 * One home's listing, and the button.
 *
 * Pressing "List on Zillow" saves first and then asks the server to put it
 * in the feed; the server refuses, naming what is missing, if Zillow would
 * turn the listing down. Nothing here reads "On Zillow" until the server has
 * said yes -- and even then it says "in our feed", because that is the part
 * this button controls.
 */
export default function ListingEditor(
  { unitId, title, draft, facts, onClose }:
  { unitId: string; title: string; draft: ListingDraft; facts: Facts; onClose: () => void },
) {
  const router = useRouter();
  const [d, setD] = useState<ListingDraft>(draft);
  const [f, setF] = useState<Facts>(facts);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const put = (k: keyof ListingDraft, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function send(extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/listings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId, headline: d.headline, description: d.description, street: d.street, city: d.city,
        state: d.state, zip: d.zip, deposit: d.deposit, pets: d.pets, leaseMonths: d.leaseMonths,
        photos: d.photos, bedrooms: f.bedrooms, bathrooms: f.bathrooms, rent: f.rent,
        squareFeet: f.squareFeet, ...extra,
      }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    return { ok: !!res?.ok, error: out.error as string | undefined };
  }

  async function save() {
    setBusy("save"); setSaid(null);
    const r = await send();
    setBusy(null);
    setSaid(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error ?? "That didn't save." });
    if (r.ok) router.refresh();
  }

  async function toggle(on: boolean) {
    setBusy("toggle"); setSaid(null);
    const r = await send({ onZillow: on });
    setBusy(null);
    if (!r.ok) { setSaid({ ok: false, text: r.error ?? "That didn't save." }); return; }
    setD((x) => ({ ...x, onZillow: on }));
    setSaid({ ok: true, text: on ? "In the Zillow feed. Zillow picks it up on its next read."
                                  : "Taken out of the feed. Zillow drops it on its next read." });
    router.refresh();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("photo"); setSaid(null);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file); fd.set("unitId", unitId);
      const res = await fetch("/api/listings/photo", { method: "POST", body: fd }).catch(() => null);
      const out = await res?.json().catch(() => ({})) ?? {};
      if (!res?.ok) { setSaid({ ok: false, text: `${file.name}: ${out.error ?? "did not upload"}` }); break; }
      added.push(out.url);
    }
    setBusy(null);
    if (added.length) {
      setD((x) => ({ ...x, photos: [...x.photos, ...added] }));
      setSaid({ ok: true, text: `${added.length} photo${added.length === 1 ? "" : "s"} added — press Save to keep ${added.length === 1 ? "it" : "them"}.` });
    }
  }

  const move = (i: number, by: number) => setD((x) => {
    const p = [...x.photos]; const j = i + by;
    if (j < 0 || j >= p.length) return x;
    [p[i], p[j]] = [p[j], p[i]];
    return { ...x, photos: p };
  });

  return (
    <div className="listedit">
      <div className="listhead">
        <h3>{title}</h3>
        <span className={d.onZillow ? "leadyes" : "leadquiet"}>
          {d.onZillow ? "In the Zillow feed" : "Not listed"}
        </span>
        <button className="leadout" onClick={onClose}>Close</button>
      </div>

      <div className="listgrid">
        <label>Monthly rent<input inputMode="decimal" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} /></label>
        <label>Deposit<input inputMode="decimal" value={d.deposit} onChange={(e) => put("deposit", e.target.value)} /></label>
        <label>Bedrooms<input inputMode="numeric" value={f.bedrooms} onChange={(e) => setF({ ...f, bedrooms: e.target.value })} /></label>
        <label>Bathrooms<input inputMode="decimal" value={f.bathrooms} onChange={(e) => setF({ ...f, bathrooms: e.target.value })} /></label>
        <label>Square feet<input inputMode="numeric" value={f.squareFeet} onChange={(e) => setF({ ...f, squareFeet: e.target.value })} /></label>
        <label>Lease (months)<input inputMode="numeric" value={d.leaseMonths} onChange={(e) => put("leaseMonths", e.target.value)} /></label>
        <label>Pets
          <select value={d.pets} onChange={(e) => put("pets", e.target.value)}>
            <option value="ask">Ask us</option>
            <option value="cats">Cats OK</option>
            <option value="dogs">Dogs OK</option>
            <option value="both">Cats and dogs OK</option>
            <option value="none">No pets</option>
          </select>
        </label>
      </div>

      <div className="listgrid addr">
        <label className="wide">Street address (as Zillow should show it)
          <input value={d.street} onChange={(e) => put("street", e.target.value)} placeholder="1140 Northside Rd Lot 14" />
        </label>
        <label>City<input value={d.city} onChange={(e) => put("city", e.target.value)} /></label>
        <label>State<input value={d.state} maxLength={2} onChange={(e) => put("state", e.target.value)} /></label>
        <label>ZIP<input inputMode="numeric" value={d.zip} maxLength={5} onChange={(e) => put("zip", e.target.value)} /></label>
      </div>

      <label className="listwide">Headline
        <input value={d.headline} maxLength={90} onChange={(e) => put("headline", e.target.value)}
               placeholder="3 bed, 2 bath home with a fenced yard" />
      </label>
      <label className="listwide">Description
        <textarea rows={5} value={d.description} onChange={(e) => put("description", e.target.value)}
                  placeholder="What the home is like, what's included, what's nearby. Describe the home, not who it's for." />
      </label>
      <p className="listhint">
        Fair housing: describe the home and the terms, never the people — no &ldquo;perfect for a
        young couple&rdquo;, &ldquo;great for families&rdquo; or &ldquo;no kids&rdquo;.
      </p>

      <div className="listphotos">
        {d.photos.map((p, i) => (
          <figure key={p}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt={`Photo ${i + 1}`} />
            <figcaption>
              {i === 0 ? <span>Cover</span> : <button className="leadout" onClick={() => move(i, -1)}>Earlier</button>}
              <button className="leadout" onClick={() => setD((x) => ({ ...x, photos: x.photos.filter((y) => y !== p) }))}>Remove</button>
            </figcaption>
          </figure>
        ))}
        <label className="listadd">
          {busy === "photo" ? "Uploading…" : "Add photos"}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple
                 onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      <div className="listacts">
        <button className="btn" disabled={!!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        {d.onZillow
          ? <button className="btn" disabled={!!busy} onClick={() => toggle(false)}>Take off Zillow</button>
          : <button className="btn pri" disabled={!!busy} onClick={() => toggle(true)}>
              {busy === "toggle" ? "Listing…" : "List on Zillow"}
            </button>}
        {said ? <span className={said.ok ? "leadyes" : "leadbut"}>{said.text}</span> : null}
      </div>
    </div>
  );
}
