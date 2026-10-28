"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where somebody's signature comes from.
 *
 * Drawn with a finger or a mouse, or a photograph of one on paper. Both,
 * because a phone is the easiest thing in the world to sign on with a
 * finger and the least like the signature somebody actually uses.
 *
 * It is kept once and drawn onto the Seller and Park Owner lines of every
 * document after that. The buyer's line is never touched.
 */
export default function SignaturePad(
  { png, busy, onSave, onClear, said }: {
    png: string | null;
    busy: boolean;
    onSave: (png: string) => void;
    onClear: () => void;
    said: string | null;
  },
) {
  const box = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  /** Whether anything has been drawn since the pad was last cleared. */
  const [marked, setMarked] = useState(false);
  const [tooBig, setTooBig] = useState<string | null>(null);

  /* The canvas is sized in device pixels and scaled down in CSS, so a
     signature drawn on a phone is not four times softer than the same
     signature drawn on a laptop. */
  const fit = useCallback(() => {
    const c = box.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (c.width === Math.round(r.width * dpr)) return;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#101828";
  }, []);
  useEffect(() => { fit(); }, [fit]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const g = () => box.current?.getContext("2d") ?? null;

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = g(); if (!c) return;
    const { x, y } = at(e);
    c.beginPath(); c.moveTo(x, y);
    setDrawing(true); setMarked(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const c = g(); if (!c) return;
    const { x, y } = at(e);
    c.lineTo(x, y); c.stroke();
  };
  const up = () => setDrawing(false);

  const wipe = () => {
    const c = g(), el = box.current;
    if (c && el) c.clearRect(0, 0, el.width, el.height);
    setMarked(false); setTooBig(null);
  };

  /** Only what was drawn, with the empty paper round it cut away. */
  const trimmed = (): string | null => {
    const el = box.current, c = g();
    if (!el || !c) return null;
    const { data, width, height } = c.getImageData(0, 0, el.width, el.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    const cut = document.createElement("canvas");
    cut.width = x1 - x0 + 1; cut.height = y1 - y0 + 1;
    cut.getContext("2d")?.drawImage(el, x0, y0, cut.width, cut.height,
      0, 0, cut.width, cut.height);
    return cut.toDataURL("image/png");
  };

  /** A photograph of a signature, shrunk to the size one is printed at. */
  const fromFile = async (file: File) => {
    setTooBig(null);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((done, fail) => {
        const i = new Image();
        i.onload = () => done(i);
        i.onerror = () => fail(new Error("That file could not be read as a picture."));
        i.src = url;
      });
      /* 600px across is three times what it prints at, which is as much
         detail as a signature can use and small enough to live in every
         document. */
      const w = Math.min(600, img.naturalWidth || 600);
      const h = Math.round((img.naturalHeight || 1) * (w / (img.naturalWidth || 1)));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")?.drawImage(img, 0, 0, w, h);
      onSave(c.toDataURL("image/png"));
    } catch (e) {
      setTooBig(e instanceof Error ? e.message : "That file could not be read.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="signwrap">
      {png ? (
        <>
          <p className="dim">This is the mark that goes on the Seller and
            Park Owner lines. The buyer still signs for themselves.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="signhave" src={png} alt="Your signature" />
          <div className="paperacts">
            <button type="button" className="btn" disabled={busy}
                    onClick={onClear}>
              {busy ? "Working…" : "Use a different signature"}
            </button>
            {said && <span className="err">{said}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="dim">Sign in the box with a finger or a mouse, or
            upload a photograph of your signature on paper.</p>
          <canvas ref={box} className="signpad"
                  onPointerDown={down} onPointerMove={move}
                  onPointerUp={up} onPointerLeave={up} />
          <div className="paperacts">
            <button type="button" className="btn pri"
                    disabled={!marked || busy}
                    onClick={() => {
                      const out = trimmed();
                      if (!out) { setTooBig("Nothing was drawn."); return; }
                      onSave(out);
                    }}>
              {busy ? "Keeping…" : "Keep this signature"}
            </button>
            <button type="button" className="btn" disabled={busy}
                    onClick={wipe}>Start again</button>
            <label className="btn signfile">
              Upload a photograph
              <input type="file" accept="image/*"
                     onChange={(e) => {
                       const f = e.target.files?.[0];
                       e.target.value = "";
                       if (f) void fromFile(f);
                     }} />
            </label>
            {(said ?? tooBig) && <span className="err">{said ?? tooBig}</span>}
          </div>
        </>
      )}
    </div>
  );
}
