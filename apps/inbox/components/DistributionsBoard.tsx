"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  netCents, parseMoney, statementHtml, subjectFor, monthLabel, usd, type Line,
} from "@/lib/distribute";

/**
 * Owner distributions: one month's statements, the emails, and the Wells
 * Fargo Bill Pay payments that settle them.
 *
 * Bill Pay has no way for software to send a payment, so this cannot press
 * "pay". What it does is everything around it: the statements, sent from
 * here; a plan that keeps every day under the $25,000 limit; and a tick per
 * payment with its confirmation number, so nobody is paid twice and nobody
 * is missed.
 */

type Pay = { id: string; sendOn: string; cents: number; arrivesOn: string; paidAt: string | null; confirmation: string | null };
type Statement = {
  id: string; ownerId: string; ownerName: string; email: string; settleDays: number;
  lines: Line[]; netCents: number; note: string; hold: boolean;
  emailedAt: string | null; emailedTo: string | null; emailDetail: string | null;
  payments: Pay[]; paidCents: number; plannedCents: number;
};
type Owner = { id: string; name: string; kind: string; email: string; settleDays: number; payNote: string; homes: number };
type Data = {
  month: string; error?: string; migrationMissing?: boolean;
  run?: { id: string; capCents: number; startOn: string | null } | null;
  owners?: Owner[]; statements?: Statement[];
  pasted?: { owners: number; unmatched: string[]; mismatched: { ownerId: string; stated: number; lines: number }[]; skippedSent: number };
  sent?: { ownerName: string; ok: boolean; detail: string }[];
};

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const money = (c: number) => (c < 0 ? `(${usd(-c)})` : usd(c));
const centsText = (c: number) => (c / 100).toFixed(2);

export default function DistributionsBoard() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Data | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<Statement | null>(null);
  const [cap, setCap] = useState("25000");
  const [startOn, setStartOn] = useState("");
  const [conf, setConf] = useState<Record<string, string>>({});
  const [confirmSend, setConfirmSend] = useState(false);

  const load = useCallback(async () => {
    setProblem(null);
    const r = await fetch(`/api/distributions?month=${month}`);
    const text = await r.text();
    let j: Data | { error: string };
    try { j = JSON.parse(text); } catch { setProblem(`The server answered ${r.status} and not with data.`); return; }
    if (!r.ok) { setProblem((j as { error: string }).error); return; }
    setData(j as Data);
    const run = (j as Data).run;
    if (run) setCap(String(run.capCents / 100));
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Nothing on screen changes until the server says it took it.
  const act = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true); setProblem(null); setSaid(null);
    try {
      const r = await fetch("/api/distributions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, ...body }),
      });
      const text = await r.text();
      let j: Data & { error?: string };
      try { j = JSON.parse(text); } catch { setProblem(`The server answered ${r.status} and not with data.`); return null; }
      if (!r.ok) { setProblem(j.error ?? `Refused (${r.status})`); return null; }
      setData(j);
      if (done) setSaid(done);
      return j;
    } finally { setBusy(false); }
  };

  const statements = data?.statements ?? [];
  const ready = statements.filter((s) => !s.emailedAt && !s.hold && s.lines.length && s.email);
  const totalNet = statements.filter((s) => !s.hold).reduce((a, s) => a + s.netCents, 0);
  const paidTotal = statements.reduce((a, s) => a + s.paidCents, 0);
  const days = useMemo(() => {
    const m: Record<string, { pay: Pay; s: Statement }[]> = {};
    for (const s of statements) for (const p of s.payments) (m[p.sendOn] ??= []).push({ pay: p, s });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [statements]);
  const capCents = data?.run?.capCents ?? 2_500_000;
  const notOnStatement = (data?.owners ?? []).filter((o) => !statements.some((s) => s.ownerId === o.id) && o.kind !== "resident");

  if (!data) {
    return <main className="wrap crewwrap">{problem
      ? <p className="tsalert" role="alert">{problem}</p>
      : <p className="tsloading">Loading&hellip;</p>}</main>;
  }

  return (
    <main className="wrap crewwrap distwrap">
      <div className="tshead">
        <h1>Owner distributions</h1>
        <span className="tsrow">
          <button className="tslink" onClick={() => setMonth(shiftMonth(month, -1))}>&larr; Earlier</button>
          <button className="tslink" onClick={() => setMonth(shiftMonth(month, 1))}>Later &rarr;</button>
        </span>
      </div>
      <p className="leadsay">
        {monthLabel(`${month}-01`)}. Each owner&rsquo;s statement, emailed from here as
        &ldquo;{subjectFor(`${month}-01`)}&rdquo;, then paid through Wells Fargo Bill Pay under the daily limit.
      </p>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}
      {said ? <p className="tsdone" role="status">{said}</p> : null}

      {data.migrationMissing ? (
        <p className="tsalert">Migration 057 has not been run, so distributions cannot be saved yet.</p>
      ) : !data.run ? (
        <section className="tscard">
          <p className="tsnote">Nothing has been started for {monthLabel(`${month}-01`)}.</p>
          <button className="tsact" disabled={busy} onClick={() => act({ action: "start" }, "Started. A statement is open for every investor with a home.")}>
            Start {monthLabel(`${month}-01`)}
          </button>
        </section>
      ) : (
        <>
          {/* ---------------------------------------------------- totals */}
          <section className="tscard">
            <div className="tscardhead">
              <h2>This month</h2>
              <span className="tsnum">{statements.length} owners</span>
            </div>
            <dl className="disttotals">
              <div><dt>Net owed</dt><dd>{money(totalNet)}</dd></div>
              <div><dt>Paid</dt><dd>{usd(paidTotal)}</dd></div>
              <div><dt>Emailed</dt><dd>{statements.filter((s) => s.emailedAt).length} of {statements.length}</dd></div>
            </dl>
          </section>

          {/* ----------------------------------------------------- paste */}
          <section className="tscard">
            <div className="tscardhead"><h2>Paste the breakdown</h2></div>
            <p className="tsnote">
              Copy the rows out of Excel and paste them here. An owner&rsquo;s name on its own row, with
              their lines underneath (label, then amount), or one row per line as owner, label, amount.
              Deductions in brackets or with a minus. A &ldquo;Net&rdquo; row is checked against the lines,
              not added to them.
            </p>
            <div className="tsfield">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6}
                placeholder={"SHB Investments\nRent collected\t9,900.00\nLot rent\t(4,125.00)\nManagement fee\t(495.00)\nNet owed\t5,280.00"} />
            </div>
            <button className="tsminor" disabled={busy || !paste.trim()} onClick={async () => {
              const j = await act({ action: "paste", text: paste });
              if (j?.pasted) {
                setPaste("");
                setSaid(`Read ${j.pasted.owners} owner${j.pasted.owners === 1 ? "" : "s"}.`
                  + (j.pasted.skippedSent ? ` ${j.pasted.skippedSent} already emailed and left as sent.` : ""));
              }
            }}>Read it in</button>
            {data.pasted?.unmatched.length ? (
              <p className="tsnudge loud">Not matched to an owner, so not read: {data.pasted.unmatched.join(" · ")}</p>
            ) : null}
            {data.pasted?.mismatched.map((m) => (
              <p key={m.ownerId} className="tsnudge loud">
                {statements.find((s) => s.ownerId === m.ownerId)?.ownerName}: the lines add up to {money(m.lines)}
                {" "}but the sheet&rsquo;s Net says {money(m.stated)}. Check before sending.
              </p>
            ))}
          </section>

          {/* ------------------------------------------------ statements */}
          {statements.map((s) => (
            <StatementCard key={s.id} s={s} busy={busy} act={act} onPreview={() => setPreview(s)} />
          ))}

          {notOnStatement.length ? (
            <section className="tscard">
              <div className="tsfield">
                <label htmlFor="addowner">Add an owner to this month</label>
                <select id="addowner" value="" disabled={busy}
                  onChange={(e) => e.target.value && act({ action: "add-owner", ownerId: e.target.value })}>
                  <option value="">Choose&hellip;</option>
                  {notOnStatement.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </section>
          ) : null}

          {/* ---------------------------------------------------- email */}
          <section className="tscard">
            <div className="tscardhead">
              <h2>Email the statements</h2>
              <span className="tsnum">{ready.length} ready</span>
            </div>
            <p className="tsnote">
              Each owner gets their own email, &ldquo;{subjectFor(`${month}-01`)}&rdquo;. You get a copy of
              every one, and replies come to you. A statement on hold, with no lines, or with no email
              address is not sent.
            </p>
            {!confirmSend ? (
              <button className="tsact" disabled={busy || !ready.length} onClick={() => setConfirmSend(true)}>
                Email {ready.length} statement{ready.length === 1 ? "" : "s"}
              </button>
            ) : (
              <>
                <p className="tsnudge loud">
                  Send to: {ready.map((s) => `${s.ownerName} (${money(s.netCents)})`).join(" · ")}
                </p>
                <div className="tsrow">
                  <button className="tsact" disabled={busy} onClick={async () => {
                    setConfirmSend(false);
                    const j = await act({ action: "send", statementIds: ready.map((s) => s.id) });
                    if (j?.sent) {
                      const ok = j.sent.filter((x) => x.ok).length;
                      const bad = j.sent.filter((x) => !x.ok);
                      setSaid(`${ok} emailed.`);
                      if (bad.length) setProblem(bad.map((x) => `${x.ownerName}: ${x.detail}`).join(" · "));
                    }
                  }}>Yes, send them</button>
                  <button className="tsminor" onClick={() => setConfirmSend(false)}>Not yet</button>
                </div>
              </>
            )}
          </section>

          {/* ------------------------------------------------- payments */}
          <section className="tscard">
            <div className="tscardhead">
              <h2>Pay through Wells Fargo</h2>
              <span className="tsnum">{usd(capCents)} a day</span>
            </div>
            <p className="tsnote">
              The plan keeps each day under the limit, sends first to owners whose bank takes longest,
              and keeps a payment whole unless it is bigger than a day allows. Paid payments stay put
              when you plan again.
            </p>
            <div className="distplanform">
              <div className="tsfield">
                <label htmlFor="cap">Daily limit ($)</label>
                <input id="cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
              </div>
              <div className="tsfield">
                <label htmlFor="start">First day to send</label>
                <input id="start" type="date" value={startOn || data.run.startOn || ""} onChange={(e) => setStartOn(e.target.value)} />
              </div>
            </div>
            <button className="tsminor" disabled={busy} onClick={() => {
              const c = parseMoney(cap);
              if (!c || c <= 0) { setProblem("The daily limit has to be an amount."); return; }
              act({ action: "plan", capCents: c, startOn: startOn || data.run?.startOn || "" }, "Planned.");
            }}>{days.length ? "Plan again" : "Plan the payments"}</button>

            {days.map(([d, rows]) => {
              const total = rows.reduce((a, r) => a + r.pay.cents, 0);
              return (
                <div key={d} className="distday">
                  <div className="distdayhead">
                    <strong>{day(d)}</strong>
                    <span className={`tsnum${total > capCents ? " over" : ""}`}>{usd(total)} of {usd(capCents)}</span>
                  </div>
                  <ul className="distpays">
                    {rows.map(({ pay, s }) => (
                      <li key={pay.id} className={pay.paidAt ? "paid" : ""}>
                        <span className="distwho">
                          <strong>{s.ownerName}</strong>
                          <span className="muted">arrives by {day(pay.arrivesOn)}{s.plannedCents > 0 && s.payments.length > 1 ? ` · part of ${usd(s.plannedCents)}` : ""}</span>
                        </span>
                        <span className="payamt">{usd(pay.cents)}</span>
                        {pay.paidAt ? (
                          <span className="distpaid">
                            Paid{pay.confirmation ? ` · ${pay.confirmation}` : ""}
                            <button className="tslink" disabled={busy} onClick={() => act({ action: "paid", paymentId: pay.id, undo: true })}>Undo</button>
                          </span>
                        ) : (
                          <span className="distmark">
                            <input aria-label={`Confirmation number for ${s.ownerName}`} placeholder="Confirmation #"
                              value={conf[pay.id] ?? ""} onChange={(e) => setConf({ ...conf, [pay.id]: e.target.value })} />
                            <button className="btn pri" disabled={busy}
                              onClick={() => act({ action: "paid", paymentId: pay.id, confirmation: conf[pay.id] ?? "" }, `${s.ownerName}: ${usd(pay.cents)} marked paid.`)}>
                              Paid
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        </>
      )}

      {preview ? (
        <div className="distpreview" role="dialog" aria-label={`Statement for ${preview.ownerName}`}>
          <div className="distpreviewbar">
            <span><strong>{subjectFor(`${month}-01`)}</strong> &middot; to {preview.email || "no address yet"}</span>
            <button className="btn" onClick={() => setPreview(null)}>Close</button>
          </div>
          <iframe title="Statement preview" sandbox="" srcDoc={statementHtml({
            month: `${month}-01`, ownerName: preview.ownerName, lines: preview.lines,
            note: preview.note, payments: preview.payments,
          })} />
        </div>
      ) : null}
    </main>
  );
}

function StatementCard({ s, busy, act, onPreview }: {
  s: Statement; busy: boolean;
  act: (b: Record<string, unknown>, done?: string) => Promise<unknown>;
  onPreview: () => void;
}) {
  const [rows, setRows] = useState(() => s.lines.map((l) => ({ label: l.label, amount: centsText(l.cents) })));
  const [note, setNote] = useState(s.note);
  const [email, setEmail] = useState(s.email);
  const [settle, setSettle] = useState(String(s.settleDays));
  useEffect(() => { setRows(s.lines.map((l) => ({ label: l.label, amount: centsText(l.cents) }))); setNote(s.note); }, [s.lines, s.note]);
  useEffect(() => { setEmail(s.email); setSettle(String(s.settleDays)); }, [s.email, s.settleDays]);

  const parsed = rows.map((r) => ({ label: r.label.trim(), cents: parseMoney(r.amount) }));
  const bad = parsed.some((p) => (p.label || p.cents !== null) && (p.cents === null || !p.label));
  const lines = parsed.filter((p): p is Line => !!p.label && p.cents !== null);
  const dirty = JSON.stringify(lines) !== JSON.stringify(s.lines) || note !== s.note;
  const locked = !!s.emailedAt;

  return (
    <section className={`tscard diststmt${s.hold ? " held" : ""}`}>
      <div className="tscardhead">
        <h2 className="distowner">{s.ownerName}</h2>
        <span className="tsnum">{money(dirty ? netCents(lines) : s.netCents)}</span>
      </div>
      <p className="tsnote">
        {s.emailedAt ? `Emailed ${new Date(s.emailedAt).toLocaleDateString()} to ${s.emailedTo}.`
          : s.emailDetail ? `Not sent: ${s.emailDetail}` : "Not emailed yet."}
        {s.paidCents ? ` ${usd(s.paidCents)} paid.` : ""}
        {s.hold ? " On hold: not emailed or paid." : ""}
      </p>

      <div className="distowned">
        <div className="tsfield">
          <label htmlFor={`em-${s.id}`}>Statement email</label>
          <input id={`em-${s.id}`} type="email" multiple value={email} placeholder="owner@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => (email !== s.email) && act({ action: "owner", ownerId: s.ownerId, email, settleDays: Number(settle) })} />
        </div>
        <div className="tsfield">
          <label htmlFor={`sd-${s.id}`}>Bank days to arrive</label>
          <input id={`sd-${s.id}`} inputMode="numeric" value={settle} onChange={(e) => setSettle(e.target.value)}
            onBlur={() => (settle !== String(s.settleDays)) && act({ action: "owner", ownerId: s.ownerId, email, settleDays: Number(settle) })} />
        </div>
      </div>

      <ul className="distlines">
        {rows.map((r, i) => (
          <li key={i}>
            <input aria-label="Line" value={r.label} disabled={locked} placeholder="Rent collected"
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            <input aria-label="Amount" inputMode="decimal" value={r.amount} disabled={locked} placeholder="0.00"
              className={parseMoney(r.amount) !== null && parseMoney(r.amount)! < 0 ? "neg" : ""}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
            {!locked ? <button className="tslink" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}>&times;</button> : null}
          </li>
        ))}
      </ul>
      {!locked ? (
        <button className="tslink" onClick={() => setRows([...rows, { label: "", amount: "" }])}>+ Add a line</button>
      ) : null}
      <div className="tsfield">
        <label htmlFor={`nt-${s.id}`}>Note on the statement (optional)</label>
        <textarea id={`nt-${s.id}`} rows={2} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      </div>
      {bad ? <p className="tsalert">A line needs both a label and an amount like 1,250.00 or (45.00).</p> : null}
      <div className="tsrow">
        {!locked ? (
          <button className="tsact" disabled={busy || bad || !dirty}
            onClick={() => act({ action: "save", statementId: s.id, lines, note }, `${s.ownerName} saved.`)}>
            {dirty ? "Save" : "Saved"}
          </button>
        ) : null}
        <button className="tsminor" onClick={onPreview} disabled={dirty}>Preview email</button>
        {!locked ? (
          <button className="tsminor" disabled={busy} onClick={() => act({ action: "save", statementId: s.id, hold: !s.hold })}>
            {s.hold ? "Take off hold" : "Hold this month"}
          </button>
        ) : null}
        {!locked && !s.paidCents ? (
          <button className="tsminor" disabled={busy} onClick={() => act({ action: "remove", statementId: s.id })}>Remove</button>
        ) : null}
      </div>
    </section>
  );
}
