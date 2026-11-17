"use client";

import { useEffect, useRef, useState } from "react";
import { SPOT_KINDS, SPOT_TAGS } from "@/lib/scout";

/**
 * Spot a property: built for a thumb, in a truck, at a stop sign.
 *
 * The GPS is awake from the moment the screen opens, so Save is instant.
 * Photos go up as they are taken (shrunk first -- a rural signal and a
 * twelve-megapixel photo do not get on), and Save only sends their names.
 * The owner comes back from the county in the same answer, so the scout
 * sees whose place it is before pulling away.
 *
 * Nothing is cleared until the server has said it kept the sighting.
 */

type Fix = { lat: number; lon: number; accuracy: number | null; at: number };
type Shot = { key: string; preview: string; path: string | null; error: string | null };
type Saved = {
  id: string; kind: string; lookup: string; owner_name: string | null; mail_address: string | null;
  site_address: string | null; county: string | null; acres: number | null; assessed: number | null; created_at: string;
  tags: string[]; note: string | null; photos: string[];
};

/** A phone photo shrunk to something a weak signal can carry. Falls back to
 *  the original when the browser cannot draw it (some HEIC files). */
async function shrink(file: File, max = 1800): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch { return file; }
}

const titleCase = (t: string | null) => t == null ? null :
  t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Lp|Inc|Mhp|Mhc|Ii|Iii|Nc|Po)\b/g, (w) => w.toUpperCase());
const money = (n: number | null) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export default function ScoutScreen() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [kind, setKind] = useState("mhp");
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [mine, setMine] = useState<Saved[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cam = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) { setGeoErr("This phone cannot share its location."); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGeoErr(null); setFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null, at: Date.now() }); },
      (e) => setGeoErr(e.code === 1 ? "Location is turned off for this site. Allow it in the phone's settings, then come back." : "Still finding you…"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  async function loadMine() {
    const r = await fetch("/api/scout", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMine((j.spots as Saved[]).slice(0, 20)); setUrls(j.urls ?? {}); }
  }
  useEffect(() => { loadMine().catch(() => {}); }, []);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const key = `${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(f);
      setShots((s) => [...s, { key, preview, path: null, error: null }]);
      try {
        const body = new FormData();
        const small = await shrink(f);
        body.append("photo", small, small === f ? f.name : "photo.jpg");
        const r = await fetch("/api/scout/photo", { method: "POST", body });
        const j = await r.json().catch(() => ({}));
        setShots((s) => s.map((x) => (x.key === key ? { ...x, path: r.ok ? j.path : null, error: r.ok ? null : (j.error ?? `failed (${r.status})`) } : x)));
      } catch {
        setShots((s) => s.map((x) => (x.key === key ? { ...x, error: "no signal; take it again" } : x)));
      }
    }
    if (cam.current) cam.current.value = "";
  }

  const uploading = shots.some((s) => !s.path && !s.error);
  const ready = shots.filter((s) => s.path).map((s) => s.path!);
  const fresh = fix && Date.now() - fix.at < 2 * 60_000;
  const canSave = !!fresh && !uploading && !busy && (ready.length > 0 || tags.length > 0 || note.trim().length > 0);

  async function save() {
    if (!fix) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/scout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, kind, tags, note, photos: ready }),
    });
    const t = await r.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(t); } catch { j = { error: `The server answered ${r.status}.` }; }
    setBusy(false);
    if (!r.ok) { setErr(String(j.error)); return; }
    setSaved(j.spot as Saved);
    setUrls((u) => ({ ...u, ...(j.urls as Record<string, string>) }));
    setMine((m) => [j.spot as Saved, ...m]);
    setTags([]); setNote(""); setShots([]);
  }

  const toggle = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  return (
    <div className="sc-shell">
      <header className="sc-head">
        <h1>Spot a property</h1>
        <p className={`sc-gps ${fresh ? (fix!.accuracy != null && fix!.accuracy <= 50 ? "good" : "fair") : "wait"}`}>
          {fresh ? `Location found${fix!.accuracy != null ? ` · within ${Math.round(fix!.accuracy)} m` : ""}` : geoErr ?? "Finding you…"}
        </p>
      </header>

      {saved ? (
        <section className="sc-result" aria-live="polite">
          <h2>Saved</h2>
          {saved.lookup === "found" ? (
            <>
              <p className="sc-owner">{titleCase(saved.owner_name) ?? "Owner not on the county record"}</p>
              <p>{titleCase(saved.site_address) ?? "No site address"}{saved.county ? ` · ${saved.county} County` : ""}</p>
              <p className="pk-faint">Mails to {saved.mail_address ?? "—"} · {saved.acres ?? "—"} ac · {money(saved.assessed)}</p>
            </>
          ) : (
            <p>{saved.lookup === "outside" ? "Outside North Carolina, so the county owner lookup does not reach it. The office will look it up."
              : saved.lookup === "none" ? "The county has no parcel right where you stood. The office will place it."
              : "The county did not answer just now. The office can ask again."}</p>
          )}
          <button className="sc-big" onClick={() => setSaved(null)}>Spot another</button>
        </section>
      ) : (
        <>
          <section>
            <h3>What is it?</h3>
            <div className="sc-chips">
              {SPOT_KINDS.map(([k, l]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}
            </div>
          </section>

          <section>
            <h3>Photos</h3>
            <input ref={cam} id="sc-cam" className="visuallyhidden" type="file" accept="image/*" capture="environment" multiple
              onChange={(e) => addPhotos(e.target.files)} />
            <div className="sc-shots">
              <label htmlFor="sc-cam" className="sc-camera"><span aria-hidden>📷</span>Take photo</label>
              {shots.map((s) => (
                <figure key={s.key} className={s.error ? "bad" : s.path ? "" : "up"}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt="" />
                  <figcaption>{s.error ?? (s.path ? "✓" : "Uploading…")}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          <section>
            <h3>What made you stop?</h3>
            <div className="sc-chips">
              {SPOT_TAGS.map(([k, l]) => <button key={k} className={tags.includes(k) ? "on" : ""} onClick={() => toggle(k)}>{l}</button>)}
            </div>
          </section>

          <section>
            <h3>Note</h3>
            <textarea id="sc-note" rows={3} placeholder="Lot count, who you talked to, anything the office should know" value={note} onChange={(e) => setNote(e.target.value)} />
          </section>

          {err ? <p className="pk-err" role="alert">{err}</p> : null}
          <button className="sc-big" disabled={!canSave} onClick={save}>
            {busy ? "Saving and looking up the owner…" : uploading ? "Waiting for photos…" : !fresh ? "Waiting for location…" : "Save"}
          </button>
        </>
      )}

      {mine.length ? (
        <section className="sc-mine">
          <h3>Your recent spots</h3>
          <ul>
            {mine.map((m) => (
              <li key={m.id}>
                {m.photos[0] && urls[m.photos[0]] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[m.photos[0]]} alt="" />
                ) : <span className="sc-noimg" />}
                <span>
                  <b>{titleCase(m.owner_name) ?? titleCase(m.site_address) ?? "Owner unknown"}</b>
                  <span className="pk-faint">{new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{m.tags.length ? ` · ${m.tags.length} ${m.tags.length === 1 ? "tag" : "tags"}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
