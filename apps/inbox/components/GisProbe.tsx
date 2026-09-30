"use client";
import { useState } from "react";

type Layer = {
  title: string; url: string; kind: string; type?: string | null;
  geometry?: string | null; geoJson?: boolean; fields?: string[]; detail?: string | null;
};
type Result = {
  appId?: string; reachable?: boolean; mapTitle?: string | null; title?: string | null;
  layers?: Layer[]; hint?: string; error?: string;
  catalogue?: number; likelyParcels?: { name: string; url: string }[];
  verdict?: { parcels: string | null; parcelsTitle: string | null;
              imagery: string | null; imageryTitle: string | null };
};

/**
 * What the county is serving, asked rather than assumed.
 *
 * An ArcGIS app is a pointer to a web map, the web map names its layers, and
 * every layer describes itself -- all of it public and machine-readable. So
 * "where are Pasquotank's parcel boundaries and their aerial photography, as
 * URLs" has an exact answer, and this goes and gets it.
 *
 * Worth doing rather than buying parcel data: the county is the source the
 * aggregators buy from, and for ground that changes monthly a county flight
 * is usually more current than anything Google has.
 */
export default function GisProbe() {
  const [url, setUrl] = useState(
    "https://pasquotankcounty.maps.arcgis.com/apps/instant/basic/index.html"
    + "?appid=38fc8f0292b04ba0a300f801f17ae902");
  const [out, setOut] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setOut(null);
    try {
      const res = await fetch("/api/gis/probe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setOut(await res.json());
    } finally { setBusy(false); }
  }

  return (
    <div className="rmmake">
      <label className="fieldlab" htmlFor="gis">
        The county map link <span className="opt">— the whole URL</span>
      </label>
      <input id="gis" value={url} onChange={(e) => setUrl(e.target.value)} />

      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn pri" disabled={busy} onClick={run}>
          {busy ? "Asking the county…" : "See what it serves"}
        </button>
        {out && (
          <button className="btn"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(out, null, 2))}>
            Copy the result
          </button>
        )}
      </div>

      {out?.error && <p className="err">{out.error}</p>}
      {out?.hint && <p className="notice">{out.hint}</p>}

      {out?.reachable && (
        <div className="rmresult">
          <p className="okmsg">
            {out.title ?? "That map"}{out.mapTitle ? ` — ${out.mapTitle}` : ""}:{" "}
            {out.layers?.length ?? 0} layers.
          </p>

          {/* The two answers being looked for, said plainly. The list below is
              the evidence, not the finding. */}
          <ul className="rmlist asked">
            <li className={out.verdict?.parcels ? "ok" : "no"}>
              <span className="rmpath">Parcel boundaries we can draw</span>
              <span className="rmstatus">
                {out.verdict?.parcels ? "yes" : "not on this map"}
              </span>
              {out.verdict?.parcels && (
                <span className="rmwhy">{out.verdict.parcelsTitle} — {out.verdict.parcels}</span>
              )}
              {!out.verdict?.parcels && out.likelyParcels && out.likelyParcels.length > 0 && (
                <span className="rmwhy">
                  But the county publishes {out.likelyParcels.length} service
                  {out.likelyParcels.length === 1 ? "" : "s"} that look like
                  parcels: {out.likelyParcels.map((p) => p.name).join(", ")}
                </span>
              )}
              {!out.verdict?.parcels && !out.likelyParcels?.length && out.catalogue
                ? <span className="rmwhy">
                    Nothing parcel-shaped among the {out.catalogue} services
                    this county publishes either.
                  </span>
                : null}
            </li>
            <li className={out.verdict?.imagery ? "ok" : "no"}>
              <span className="rmpath">Aerial photography</span>
              <span className="rmstatus">{out.verdict?.imagery ? "yes" : "none found"}</span>
              {out.verdict?.imagery && (
                <span className="rmwhy">{out.verdict.imageryTitle} — {out.verdict.imagery}</span>
              )}
            </li>
          </ul>

          <ul className="rmlist">
            {(out.layers ?? []).map((l) => (
              <li key={l.url} className={l.geoJson || l.kind === "basemap" ? "ok" : "no"}>
                <span className="rmpath">{l.title}</span>
                <span className="rmstatus">
                  {l.kind === "basemap" ? "backdrop"
                    : l.geoJson ? l.geometry?.replace("esriGeometry", "") ?? "shapes"
                    : l.detail ?? "no shapes"}
                </span>
                {l.fields && l.fields.length > 0 && (
                  <details className="rmshape">
                    <summary>{l.fields.length} fields</summary>
                    <p>{l.fields.join(", ")}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
