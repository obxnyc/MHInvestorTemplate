"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HOME, clamp, nextLabel } from "@/lib/park";

export type Lot = {
  id: string;
  label: string;
  x: number | null;
  y: number | null;
  rot: number;
  vacant: boolean;
  rent: number | null;
  tenant: string | null;
  sale: {
    ownerId: string | null; owner: string | null; soldOn: string;
    priceCents: number; financed: boolean; monthlyCents: number | null;
    homeYear: number | null; homeMake: string | null; homeSerial: string | null;
  } | null;
};

/** What a pad is, at a glance, from across the office.
 *
 *  Four states and not more. "Investor-owned and let" is the ordinary case
 *  and should be the quiet colour; the two that cost money -- an empty home
 *  and a bare pad -- are the ones worth seeing without reading a label. */
function stateOf(lot: Lot): "let" | "empty" | "bare" | "ours" {
  if (!lot.sale) return lot.tenant ? "ours" : "bare";
  return lot.tenant ? "let" : "empty";
}

const LABEL: Record<string, string> = {
  let: "Owned and let", empty: "Owned, nobody in it",
  bare: "Bare pad", ours: "Our home, let",
};

/**
 * The park, drawn.
 *
 * An SVG with a 0..1 coordinate space, which is the same space the positions
 * are stored in, so there is no conversion to get wrong and the plan looks
 * identical on a phone and a monitor.
 *
 * Every home is the same rectangle. That is not a simplification -- they are
 * the same home. What varies is where it sits, which way it faces, and who is
 * in it.
 */
export default function ParkPlan(
  { lots, selected, onSelect, onMove, onAdd, editing }:
  {
    lots: Lot[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    onMove: (id: string, x: number, y: number) => void;
    onAdd: (label: string, x: number, y: number) => void;
    editing: boolean;
  },
) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const placed = lots.filter((l) => l.x !== null && l.y !== null);

  /** Where in the 0..1 space a pointer event landed. Read off the SVG's own
   *  box rather than the window, so it stays right inside a scrolled page. */
  const at = useCallback((e: { clientX: number; clientY: number }) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: clamp((e.clientX - box.left) / box.width),
      y: clamp((e.clientY - box.top) / box.height),
    };
  }, []);

  // Dragging is tracked on the window, not the rectangle. A pointer that
  // leaves a 20-pixel shape mid-drag is the normal case, and a listener on
  // the shape drops the home wherever it happened to lose track of it.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = at(e);
      onMove(drag.id, clamp(p.x - drag.dx), clamp(p.y - drag.dy));
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, at, onMove]);

  return (
    <div className="parkwrap">
      <svg
        ref={svg} className={`park${editing ? " editing" : ""}`}
        viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => editing && setGhost(at(e))}
        onPointerLeave={() => setGhost(null)}
        onClick={(e) => {
          if (!editing) { onSelect(null); return; }
          const p = at(e);
          const label = window.prompt(
            "Lot number for the new pad",
            nextLabel(lots.map((l) => l.label)),
          );
          if (label?.trim()) onAdd(label.trim(), p.x, p.y);
        }}
      >
        {placed.map((lot) => {
          const cx = lot.x! * 1600;
          const cy = lot.y! * 1000;
          const w = HOME.w * 1600;
          const h = HOME.h * 1000;
          const state = stateOf(lot);
          const on = lot.id === selected;
          return (
            <g key={lot.id}
               transform={`translate(${cx} ${cy}) rotate(${lot.rot})`}
               className={`pad pad-${state}${on ? " on" : ""}`}
               onPointerDown={(e) => {
                 if (!editing) return;
                 e.stopPropagation();
                 const p = at(e);
                 setDrag({ id: lot.id, dx: p.x - lot.x!, dy: p.y - lot.y! });
               }}
               onClick={(e) => { e.stopPropagation(); onSelect(lot.id); }}>
              <title>
                {`Lot ${lot.label} — ${LABEL[state]}`}
                {lot.sale?.owner ? `\nHome owned by ${lot.sale.owner}` : ""}
                {lot.tenant ? `\n${lot.tenant} lives here` : ""}
              </title>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} />
              {/* The number is counter-rotated so it reads horizontally
                  however the home is turned. A label at 30 degrees is a
                  label nobody reads from across a desk. */}
              <text transform={`rotate(${-lot.rot})`} dy="0.32em">{lot.label}</text>
            </g>
          );
        })}

        {editing && ghost && (
          <rect className="ghost"
                x={ghost.x * 1600 - HOME.w * 800} y={ghost.y * 1000 - HOME.h * 500}
                width={HOME.w * 1600} height={HOME.h * 1000} rx={2} />
        )}
      </svg>

      <ul className="parkkey">
        {(["let", "empty", "bare", "ours"] as const).map((k) => (
          <li key={k}><span className={`sw sw-${k}`} />{LABEL[k]}</li>
        ))}
      </ul>
    </div>
  );
}
