"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Friday: what each man is owed, crew by crew, and a way through paying them.
 *
 * Zelle and Cash App do not let a business send money from software -- there
 * is no API for either -- so this cannot press "send" for you. What it does
 * is the rest: the amounts, worked out from the clock; a tap per man that
 * opens Cash App or Venmo with the amount already in; and one press that
 * records everybody you have paid, so nobody is paid twice and nobody is
 * missed.
 *
 * Nothing is marked paid until the server says it took it, and the amount is
 * worked out on the server -- not taken from this page.
 */

type Line = {
  staffId: string; name: string; crewId: string | null; crew: string;
  hours: number; regular: number; overtime: number;
  rateCents: number | null; amountCents: number | null;
  method: string | null; handle: string | null;
  openShifts: number; unsigned: number; payLink: string | null;
};
type Crew = { id: string | null; name: string; hours: number; amountCents: number; people: number };
type Data = {
  week: string; overtime: boolean; lines: Line[]; crews: Crew[]; totalCents: number;
  missingRates: number;
  paid: Record<string, { amountCents: number; paidAt: string; method: string | null }>;
  migrationMissing: boolean;
};

const METHOD_SAID: Record<string, string> = {
  zelle: "Zelle", cashapp: "Cash App", venmo: "Venmo", cash: "Cash", check: "Check", other: "Other",
};
const usd = (c: number | null) => c === null ? "—"
  : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const hhmm = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const label = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function PayBoard() {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const off = () => new Date().getTimezoneOffset();

  const load = useCallback(async (w: string | null) => {
    const res = await fetch(`/api/pay?offset=${off()}${w ? `&week=${w}` : ""}`).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (!res?.ok || !out) { setProblem(out?.error ?? "Could not load the pay week."); return; }
    setData(out);
    // Everybody owed and not yet paid starts ticked: the usual Friday is
    // "all of them", and unticking the odd one is the exception.
    setPicked(new Set((out.lines as Line[])
      .filter((l) => l.amountCents && !out.paid[l.staffId]).map((l) => l.staffId)));
  }, []);

  useEffect(() => { void load(week); }, [load, week]);

  const owing = useMemo(() => data?.lines.filter((l) => picked.has(l.staffId)
    && l.amountCents && !data.paid[l.staffId]) ?? [], [data, picked]);
  const owingCents = owing.reduce((a, l) => a + (l.amountCents ?? 0), 0);

  const markPaid = async () => {
    if (!data || !owing.length) return;
    if (!confirm(`Record ${owing.length} payment${owing.length === 1 ? "" : "s"} totalling `
      + `${usd(owingCents)} for the week of ${label(data.week)}? Only do this once the money has gone.`)) return;
    setBusy(true); setProblem(null); setDone(null);
    const res = await fetch("/api/pay", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ week: data.week, staffIds: owing.map((l) => l.staffId), offset: off() }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res?.ok) { setProblem(out.error ?? "That did not go through. Nothing was recorded."); return; }
    setDone(`${out.marked} recorded as paid.`);
    await load(data.week);
  };

  const sheet = () => {
    if (!data) return;
    const rows = [["Crew", "Employee", "Hours", "Regular", "Overtime", "Rate", "Amount",
                   "Paid by", "Handle", "Paid", "Not finished shifts"]];
    for (const l of data.lines) {
      rows.push([l.crew, l.name, l.hours.toFixed(2), l.regular.toFixed(2), l.overtime.toFixed(2),
        l.rateCents === null ? "" : (l.rateCents / 100).toFixed(2),
        l.amountCents === null ? "" : (l.amountCents / 100).toFixed(2),
        METHOD_SAID[l.method ?? ""] ?? "", l.handle ?? "",
        data.paid[l.staffId] ? "Yes" : "No", String(l.openShifts)]);
    }
    rows.push([]);
    for (const c of data.crews) rows.push([c.name, "TOTAL", c.hours.toFixed(2), "", "", "", (c.amountCents / 100).toFixed(2)]);
    rows.push(["ALL CREWS", "TOTAL", "", "", "", "", (data.totalCents / 100).toFixed(2)]);
    const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `pay-week-of-${data.week}.csv`;
    a.click();
  };

  if (!data) {
    return <main className="wrap crewwrap">{problem
      ? <p className="tsalert" role="alert">{problem}</p>
      : <p className="tsloading">Loading&hellip;</p>}</main>;
  }

  const open = data.lines.filter((l) => l.openShifts).length;
  const unsigned = data.lines.reduce((a, l) => a + l.unsigned, 0);

  return (
    <main className="wrap crewwrap">
      <div className="tshead">
        <h1>Friday Pay</h1>
        <span className="tsrow">
          <a className="tslink" href="/timesheets">Timesheets</a>
          <a className="tslink" href="/crew">Crews &amp; rates</a>
        </span>
      </div>

      <p className="leadsay">
        Week of {label(data.week)} – {label(addDays(data.week, 6))}
        {" · "}{usd(data.totalCents)} across {data.lines.filter((l) => l.hours).length} people
      </p>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}
      {done ? <p className="tsdone" role="status">{done}</p> : null}
      {data.migrationMissing ? (
        <p className="tsalert">Migration 051 has not been run, so payments cannot be recorded yet.</p>
      ) : null}
      {data.missingRates ? (
        <p className="tsnudge loud">
          {data.missingRates} {data.missingRates === 1 ? "person has" : "people have"} hours and no
          hourly rate, so no amount. Set it on Crews &amp; rates.{" "}
          <a className="tslink" href="/crew">Set rates &rarr;</a>
        </p>
      ) : null}
      {open ? (
        <p className="tsnudge loud">
          {open} {open === 1 ? "person has a shift" : "people have shifts"} nobody clocked out of.
          Those hours are not in the amounts until the shift is closed with a correction.
        </p>
      ) : null}
      {unsigned ? (
        <p className="tsnudge">
          {unsigned} finished shift{unsigned === 1 ? " has" : "s have"} not been agreed by the
          person who worked {unsigned === 1 ? "it" : "them"}. Paying is still allowed.
        </p>
      ) : null}

      <div className="tsrow">
        <button className="tslink" onClick={() => setWeek(addDays(data.week, -7))}>&larr; Earlier</button>
        <button className="tslink" onClick={() => setWeek(addDays(data.week, 7))}>Later &rarr;</button>
        <button className="tslink" onClick={sheet}>Download pay sheet</button>
      </div>

      {data.crews.map((c) => (
        <section key={c.id ?? "none"} className="tscard">
          <div className="tscardhead">
            <h2>{c.name}</h2>
            <span className="tsnum">{hhmm(c.hours)} · {usd(c.amountCents)}</span>
          </div>
          <ul className="paylines">
            {data.lines.filter((l) => l.crewId === c.id).map((l) => {
              const paid = data.paid[l.staffId];
              return (
                <li key={l.staffId} className={paid ? "paid" : ""}>
                  <label className="paypick">
                    <input type="checkbox" disabled={!!paid || !l.amountCents}
                           checked={!paid && picked.has(l.staffId)}
                           onChange={(e) => setPicked((p) => {
                             const n = new Set(p);
                             if (e.target.checked) n.add(l.staffId); else n.delete(l.staffId);
                             return n;
                           })} />
                    <span className="tsspan">{l.name}</span>
                  </label>
                  <span className="payamt">{usd(l.amountCents)}</span>
                  <span className="paymath">
                    {hhmm(l.hours)} hrs
                    {l.overtime ? ` (${hhmm(l.overtime)} overtime)` : ""}
                    {l.rateCents !== null ? ` × ${usd(l.rateCents)}` : " · no rate"}
                  </span>
                  <span className="payhow">
                    {paid
                      ? `Paid ${new Date(paid.paidAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
                        + (paid.amountCents !== l.amountCents
                          ? ` · ${usd(paid.amountCents)} sent, hours have changed since` : "")
                      : l.method
                      ? `${METHOD_SAID[l.method] ?? l.method}${l.handle ? ` · ${l.handle}` : ""}`
                      : "How paid not set"}
                  </span>
                  {!paid && l.payLink ? (
                    <a className="tsminor paygo" href={l.payLink} target="_blank" rel="noreferrer">
                      Open {METHOD_SAID[l.method ?? ""]} with {usd(l.amountCents)}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="tscard">
        <div className="tscardhead">
          <h2>Record Payments</h2>
          <span className="tsnum">{owing.length} · {usd(owingCents)}</span>
        </div>
        <p className="tsnote">
          Send the money first — Cash App and Venmo open with the amount filled in; Zelle
          goes through your bank&rsquo;s app. Then record it here so nobody is paid twice.
        </p>
        <button className="tsact" disabled={busy || !owing.length} onClick={markPaid}>
          {busy ? "Recording…" : `Mark ${owing.length} as paid`}
        </button>
      </section>
    </main>
  );
}
