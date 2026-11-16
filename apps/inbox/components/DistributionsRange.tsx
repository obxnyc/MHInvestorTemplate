"use client";

import { useEffect, useRef, useState } from "react";
import { rangeLabel, usd, type SummaryRow } from "@/lib/distribute";

/**
 * The month at the top of the distributions screen, as a picker: the twelve
 * months of a year in a 4×3 grid, the year itself a button that turns the
 * grid into years, and below them the summaries -- year to date, a whole
 * year, or any from/to -- which add up every statement in the range.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const todayNY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export type Range = { from: string; to: string };

export function MonthPicker({ month, range, onMonth, onRange, label }: {
  month: string; range: Range | null; label: string;
  onMonth: (m: string) => void; onRange: (r: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [years, setYears] = useState(false);
  const [from, setFrom] = useState(range?.from ?? `${month.slice(0, 4)}-01`);
  const [to, setTo] = useState(range?.to ?? month);
  const box = useRef<HTMLDivElement>(null);
  const now = todayNY().slice(0, 7), thisYear = Number(now.slice(0, 4));

  useEffect(() => { if (open) { setYear(Number((range?.to ?? month).slice(0, 4))); setYears(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);

  const pick = (r: Range) => { onRange(r); setOpen(false); };
  const firstYear = year - 8;

  return (
    <div className="mpick" ref={box}>
      <button className="mpickbtn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>{label}</strong> <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="mpickpop" role="dialog" aria-label="Choose a month or a range">
          <div className="mpickyear">
            <button className="tslink" aria-label={years ? "Earlier years" : "Previous year"} onClick={() => setYear(year - (years ? 12 : 1))}>&larr;</button>
            <button className="mpickyearbtn" aria-label={`Choose a year, now ${year}`} onClick={() => setYears(!years)}>
              {years ? `${firstYear}–${firstYear + 11}` : year} <span aria-hidden>▾</span>
            </button>
            <button className="tslink" aria-label={years ? "Later years" : "Next year"} onClick={() => setYear(year + (years ? 12 : 1))}>&rarr;</button>
          </div>
          <div className="mpickgrid">
            {years
              ? Array.from({ length: 12 }, (_, i) => firstYear + i).map((y) => (
                  <button key={y} className={y === Number(month.slice(0, 4)) ? "on" : y === thisYear ? "now" : ""}
                    onClick={() => { setYear(y); setYears(false); }}>{y}</button>
                ))
              : MON.map((m, i) => {
                  const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button key={m} className={!range && key === month ? "on" : key === now ? "now" : ""}
                      onClick={() => { onMonth(key); setOpen(false); }}>{m}</button>
                  );
                })}
          </div>
          <div className="mpicksum">
            <span className="mpicklabel">Add up several months</span>
            <div className="mpickquick">
              <button className="btn" onClick={() => pick({ from: `${thisYear}-01`, to: now })}>Year to date</button>
              <button className="btn" onClick={() => pick({ from: `${year}-01`, to: `${year}-12` })}>All of {year}</button>
              {year !== thisYear - 1 ? <button className="btn" onClick={() => pick({ from: `${thisYear - 1}-01`, to: `${thisYear - 1}-12` })}>All of {thisYear - 1}</button> : null}
            </div>
            <div className="mpickcustom">
              <label>From <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>To <input type="month" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <button className="btn pri" disabled={!from || !to || from > to} onClick={() => pick({ from, to })}>Show</button>
            </div>
            {from && to && from > to ? <small className="tsnote">The start has to be on or before the end.</small> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Summary = { from: string; to: string; label: string; months: string[]; withData: string[]; rows: SummaryRow[] };
const money = (c: number) => (c < 0 ? `(${usd(-c)})` : usd(c));
const mon = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Every statement in the range, added up per property, with its houses under it. */
export function RangeSummary({ range, onBack }: { range: Range; onBack: () => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setProblem(null);
    fetch(`/api/distributions/summary?from=${range.from}&to=${range.to}`).then(async (r) => {
      const text = await r.text();
      let j: Summary | { error: string };
      try { j = JSON.parse(text); } catch { if (live) setProblem(`The server answered ${r.status} and not with data.`); return; }
      if (!live) return;
      if (!r.ok) setProblem((j as { error: string }).error); else setData(j as Summary);
    }).catch(() => live && setProblem("Could not reach the server."));
    return () => { live = false; };
  }, [range.from, range.to]);

  const label = data?.label ?? rangeLabel(range.from, range.to, todayNY());
  if (problem) return <p className="tsalert" role="alert">{problem}</p>;
  if (!data) return <p className="tsnote">Adding up {label}…</p>;

  const owners = [...new Set(data.rows.map((r) => r.owner))];
  const rows = owner ? data.rows.filter((r) => r.owner === owner) : data.rows;
  const sum = (k: "revenueCents" | "expenseCents" | "netCents" | "paidCents") => rows.reduce((a, r) => a + r[k], 0);
  const groups = owners.filter((o) => !owner || o === owner).map((o) => [o, rows.filter((r) => r.owner === o)] as const);
  const xlsx = `/api/distributions/summary?from=${data.from}&to=${data.to}&format=xlsx${owner ? `&owner=${encodeURIComponent(owner)}` : ""}`;
  const missing = data.months.filter((m) => !data.withData.includes(m));

  return (
    <>
      <dl className="disttotals">
        <div><dt>Revenue</dt><dd>{usd(sum("revenueCents"))}</dd></div>
        <div><dt>Expenses</dt><dd>{money(sum("expenseCents"))}</dd></div>
        <div><dt>Net cashflow</dt><dd>{money(sum("netCents"))}</dd></div>
        <div><dt>Paid out</dt><dd>{usd(sum("paidCents"))}</dd></div>
      </dl>
      <section className="tscard">
        <div className="tscardhead">
          <h2>{label}{owner ? ` · ${owner}` : ""}</h2>
          <span className="tsnum">{rows.length} propert{rows.length === 1 ? "y" : "ies"}</span>
        </div>
        {missing.length ? (
          <p className="tsnote">
            Statements are on file here for {data.withData.length ? data.withData.map(mon).join(", ") : "none of these months"}.{" "}
            {missing.length === data.months.length ? "" : `${missing.length} month${missing.length === 1 ? " has" : "s have"} none, so ${missing.length === 1 ? "it is" : "they are"} not in these totals.`}
          </p>
        ) : null}
        <div className="tsrow distsumtools">
          <label className="tsfield distsumowner">
            <span>Owner</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Everyone</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <a className="btn" href={xlsx} download>Download for Excel</a>
          <button className="btn" onClick={onBack}>Back to the month</button>
        </div>
        {!rows.length ? <p className="tsnote">No statements in {label}.</p> : (
          <div className="distsum" role="table" aria-label={`Summary, ${label}`}>
            <div className="distsumrow distsumhead" role="row">
              <span role="columnheader">Property</span><span role="columnheader" className="num">Revenue</span>
              <span role="columnheader" className="num">Expenses</span><span role="columnheader" className="num">Net</span>
              <span role="columnheader" className="num">Paid out</span>
            </div>
            {groups.map(([o, list]) => (
              <div key={o} className="distsumgroup">
                <div className="distsumowner">{o}</div>
                {list.map((r) => {
                  const houses = r.lots.length > 1 || r.lots[0]?.lot != null;
                  const isOpen = openRow === r.payeeId;
                  return (
                    <div key={r.payeeId}>
                      <button className="distsumrow distsumprop" role="row" aria-expanded={houses ? isOpen : undefined}
                        onClick={() => houses && setOpenRow(isOpen ? null : r.payeeId)}>
                        <span role="cell">{houses ? <span aria-hidden className="distsumcaret">{isOpen ? "▾" : "▸"}</span> : null}
                          {r.place}<small> · {r.months.length} month{r.months.length === 1 ? "" : "s"}</small></span>
                        <span data-k="Revenue" role="cell" className="num">{usd(r.revenueCents)}</span>
                        <span data-k="Expenses" role="cell" className="num distneg">{money(r.expenseCents)}</span>
                        <span data-k="Net" role="cell" className="num"><strong>{money(r.netCents)}</strong></span>
                        <span data-k="Paid out" role="cell" className="num">{usd(r.paidCents)}</span>
                      </button>
                      {isOpen ? r.lots.map((l) => (
                        <div key={String(l.lot)} className="distsumrow distsumlot" role="row">
                          <span role="cell">{l.lot === null ? "Property-wide" : `Lot ${l.lot}`}</span>
                          <span data-k="Revenue" role="cell" className="num">{usd(l.revenueCents)}</span>
                          <span data-k="Expenses" role="cell" className="num distneg">{money(l.expenseCents)}</span>
                          <span data-k="Net" role="cell" className="num">{money(l.netCents)}</span>
                          <span role="cell" />
                        </div>
                      )) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
