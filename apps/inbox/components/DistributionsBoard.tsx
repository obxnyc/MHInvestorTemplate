"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  owedCents, checks, parseMoney, statementHtml, subjectFor, monthLabel, usd, type Line,
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
  id: string; payeeId: string; payee: string; email: string; settleDays: number;
  title: string; previousOwedCents: number | null; priorPaidCents: number | null; priorPaidOn: string | null;
  depositsCents: number | null; statedNetCents: number | null; statedOwedCents: number | null; owedNote: string;
  lines: Line[]; netCents: number; owedCents: number; checks: string[]; note: string; hold: boolean;
  emailedAt: string | null; emailedTo: string | null; emailDetail: string | null;
  payments: Pay[]; paidCents: number; plannedCents: number;
};
type Payee = { id: string; name: string; emails: string; settleDays: number; active: boolean };
type Data = {
  month: string; error?: string; migrationMissing?: boolean;
  run?: { id: string; capCents: number; startOn: string | null } | null;
  payees?: Payee[]; statements?: Statement[];
  pasted?: { payees: number; unmatched: string[]; skippedSent: number };
  sent?: { payee: string; ok: boolean; detail: string }[];
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
  const [newPayee, setNewPayee] = useState("");

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
  const totalNet = statements.filter((s) => !s.hold && s.owedCents > 0).reduce((a, s) => a + s.owedCents, 0);
  const flagged = statements.filter((s) => s.checks.some((c) => !/carries into this month/.test(c))).length;
  const paidTotal = statements.reduce((a, s) => a + s.paidCents, 0);
  const days = useMemo(() => {
    const m: Record<string, { pay: Pay; s: Statement }[]> = {};
    for (const s of statements) for (const p of s.payments) (m[p.sendOn] ??= []).push({ pay: p, s });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [statements]);
  const capCents = data?.run?.capCents ?? 2_500_000;

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
          <button className="tsact" disabled={busy} onClick={() => act({ action: "start" }, "Started. Everybody paid last month has a statement open.")}>
            Start {monthLabel(`${month}-01`)}
          </button>
        </section>
      ) : (
        <>
          {/* ---------------------------------------------------- totals */}
          <section className="tscard">
            <div className="tscardhead">
              <h2>This month</h2>
              <span className="tsnum">{statements.length} statements</span>
            </div>
            <dl className="disttotals">
              <div><dt>To pay</dt><dd>{usd(totalNet)}</dd></div>
              <div><dt>Paid</dt><dd>{usd(paidTotal)}</dd></div>
              <div><dt>Emailed</dt><dd>{statements.filter((s) => s.emailedAt).length} of {statements.length}</dd></div>
            </dl>
            {flagged ? <p className="tsnudge loud">{flagged} statement{flagged === 1 ? " has" : "s have"} something worth a look before it goes. Each says what, in yellow.</p> : null}
          </section>

          {/* ----------------------------------------------------- paste */}
          <section className="tscard">
            <div className="tscardhead"><h2>Paste lines by hand</h2></div>
            <p className="tsnote">
              Alex&rsquo;s sheets are read in for you each month. For anything else, copy rows out of a
              spreadsheet and paste them here: a payee&rsquo;s name on its own row with their lines underneath
              (label, then amount), or one row per line as payee, label, amount. Costs with a minus or in brackets.
            </p>
            <div className="tsfield">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6}
                placeholder={"SHB Investments\nRent collected\t9,900.00\nLot rent\t(4,125.00)\nManagement fee\t(495.00)\nNet owed\t5,280.00"} />
            </div>
            <button className="tsminor" disabled={busy || !paste.trim()} onClick={async () => {
              const j = await act({ action: "paste", text: paste });
              if (j?.pasted) {
                setPaste("");
                setSaid(`Read ${j.pasted.payees} statement${j.pasted.payees === 1 ? "" : "s"}.`
                  + (j.pasted.skippedSent ? ` ${j.pasted.skippedSent} already emailed and left as sent.` : ""));
              }
            }}>Read it in</button>
            {data.pasted?.unmatched.length ? (
              <p className="tsnudge loud">Not matched to a payee, so not read: {data.pasted.unmatched.join(" · ")}</p>
            ) : null}
          </section>

          {/* ------------------------------------------------ statements */}
          {statements.map((s) => (
            <StatementCard key={s.id} s={s} busy={busy} act={act} onPreview={() => setPreview(s)} />
          ))}

          <section className="tscard">
            <div className="tsfield">
              <label htmlFor="addpayee">Add a statement for</label>
              <input id="addpayee" list="payeelist" value={newPayee} placeholder="Name as it should appear on the statement"
                onChange={(e) => setNewPayee(e.target.value)} />
              <datalist id="payeelist">
                {(data.payees ?? []).filter((p) => !statements.some((s) => s.payeeId === p.id)).map((p) => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
            <button className="tsminor" disabled={busy || !newPayee.trim()}
              onClick={async () => { if (await act({ action: "add-payee", name: newPayee.trim() })) setNewPayee(""); }}>Add</button>
          </section>

          {/* ---------------------------------------------------- email */}
          <section className="tscard">
            <div className="tscardhead">
              <h2>Email the statements</h2>
              <span className="tsnum">{ready.length} ready</span>
            </div>
            <p className="tsnote">
              Each payee gets their own email, &ldquo;{subjectFor(`${month}-01`)}&rdquo;. You get a copy of
              every one, and replies come to you. A statement on hold, with no lines, or with no email
              address is not sent. Plan the payments first and each email says when the money was sent.
            </p>
            {!confirmSend ? (
              <button className="tsact" disabled={busy || !ready.length} onClick={() => setConfirmSend(true)}>
                Email {ready.length} statement{ready.length === 1 ? "" : "s"}
              </button>
            ) : (
              <>
                <p className="tsnudge loud">
                  Send to: {ready.map((s) => `${s.payee} (${money(s.owedCents)})`).join(" · ")}
                </p>
                <div className="tsrow">
                  <button className="tsact" disabled={busy} onClick={async () => {
                    setConfirmSend(false);
                    const j = await act({ action: "send", statementIds: ready.map((s) => s.id) });
                    if (j?.sent) {
                      const ok = j.sent.filter((x) => x.ok).length;
                      const bad = j.sent.filter((x) => !x.ok);
                      setSaid(`${ok} emailed.`);
                      if (bad.length) setProblem(bad.map((x) => `${x.payee}: ${x.detail}`).join(" · "));
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
              The plan keeps each day under the limit, sends first to payees whose bank takes longest,
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
                          <strong>{s.payee}</strong>
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
                            <input aria-label={`Confirmation number for ${s.payee}`} placeholder="Confirmation #"
                              value={conf[pay.id] ?? ""} onChange={(e) => setConf({ ...conf, [pay.id]: e.target.value })} />
                            <button className="btn pri" disabled={busy}
                              onClick={() => act({ action: "paid", paymentId: pay.id, confirmation: conf[pay.id] ?? "" }, `${s.payee}: ${usd(pay.cents)} marked paid.`)}>
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
        <div className="distpreview" role="dialog" aria-label={`Statement for ${preview.payee}`}>
          <div className="distpreviewbar">
            <span><strong>{subjectFor(`${month}-01`)}</strong> &middot; to {preview.email || "no address yet"}</span>
            <button className="btn" onClick={() => setPreview(null)}>Close</button>
          </div>
          <iframe title="Statement preview" sandbox="" srcDoc={statementHtml({
            month: `${month}-01`, payee: preview.payee, title: preview.title, lines: preview.lines,
            note: preview.note, payments: preview.payments, previousOwedCents: preview.previousOwedCents,
            priorPaidCents: preview.priorPaidCents, priorPaidOn: preview.priorPaidOn, depositsCents: preview.depositsCents,
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
  type Row = { label: string; amount: string; date?: string; merchant?: string; category?: string };
  const toRows = (ls: Line[]): Row[] => ls.map((l) => ({ ...l, amount: centsText(l.cents) }));
  const [rows, setRows] = useState<Row[]>(() => toRows(s.lines));
  const [note, setNote] = useState(s.note);
  const [email, setEmail] = useState(s.email);
  const [settle, setSettle] = useState(String(s.settleDays));
  const [open, setOpen] = useState(false);
  useEffect(() => { setRows(toRows(s.lines)); setNote(s.note); }, [s.lines, s.note]);
  useEffect(() => { setEmail(s.email); setSettle(String(s.settleDays)); }, [s.email, s.settleDays]);

  const parsed = rows.map((r) => ({ ...r, label: r.label.trim(), cents: parseMoney(r.amount) }));
  const bad = parsed.some((p) => (p.label || p.cents !== null) && (p.cents === null || !p.label));
  const lines: Line[] = parsed.filter((p) => !!p.label && p.cents !== null).map(({ amount: _a, ...l }) => ({ ...l, cents: l.cents! }));
  const dirty = JSON.stringify(lines) !== JSON.stringify(s.lines) || note !== s.note;
  const locked = !!s.emailedAt || s.paidCents > 0;
  const owed = dirty ? owedCents(lines, s) : s.owedCents;
  const said = dirty ? checks(s.title, lines, s) : s.checks;
  const savePayee = () => act({ action: "payee", payeeId: s.payeeId, email, settleDays: Number(settle) });
  const carried = (s.previousOwedCents ?? 0) - (s.priorPaidCents ?? 0);

  return (
    <section className={`tscard diststmt${s.hold ? " held" : ""}`}>
      <div className="tscardhead">
        <h2 className="distowner">{s.payee}</h2>
        <span className={`tsnum${owed < 0 ? " distneg" : ""}`}>{money(owed)}</span>
      </div>
      {s.title ? <p className="tsnote">{s.title}</p> : null}
      <p className="tsnote">
        {lines.length} lines · net {money(lines.reduce((a, l) => a + l.cents, 0))}
        {carried ? ` · ${money(carried)} carried from last month` : ""}
        {s.owedNote ? ` · sheet says “${s.owedNote}”` : ""}
      </p>
      {said.map((c) => <p key={c} className="tsnudge loud">{c}</p>)}
      <p className="tsnote">
        {s.emailedAt ? `Emailed ${new Date(s.emailedAt).toLocaleDateString()} to ${s.emailedTo}.`
          : s.emailDetail ? `Not sent: ${s.emailDetail}` : "Not emailed yet."}
        {s.paidCents ? ` ${usd(s.paidCents)} paid.` : ""}
        {s.hold ? " On hold: not emailed or paid." : ""}
      </p>

      <div className="distowned">
        <div className="tsfield">
          <label htmlFor={`em-${s.id}`}>Statement email</label>
          <input id={`em-${s.id}`} type="text" inputMode="email" value={email} placeholder="name@example.com, another@example.com"
            onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== s.email && savePayee()} />
        </div>
        <div className="tsfield">
          <label htmlFor={`sd-${s.id}`}>Bank days to arrive</label>
          <input id={`sd-${s.id}`} inputMode="numeric" value={settle} onChange={(e) => setSettle(e.target.value)}
            onBlur={() => settle !== String(s.settleDays) && savePayee()} />
        </div>
      </div>

      <button className="tslink" onClick={() => setOpen(!open)}>{open ? "Hide the lines" : `Show the ${rows.length} lines`}</button>
      {open ? (
        <>
          <ul className="distlines">
            {rows.map((r, i) => (
              <li key={i}>
                <input aria-label="Line" value={r.label} disabled={locked} placeholder="Monthly Rent - Lot 13"
                  title={[r.date, r.merchant, r.category].filter(Boolean).join(" · ")}
                  onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <input aria-label="Amount" inputMode="decimal" value={r.amount} disabled={locked} placeholder="0.00"
                  className={(parseMoney(r.amount) ?? 0) < 0 ? "neg" : ""}
                  onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                {!locked ? <button className="tslink" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}>&times;</button> : null}
              </li>
            ))}
          </ul>
          {!locked ? <button className="tslink" onClick={() => setRows([...rows, { label: "", amount: "" }])}>+ Add a line</button> : null}
        </>
      ) : null}
      <div className="tsfield">
        <label htmlFor={`nt-${s.id}`}>Note on the statement (optional)</label>
        <textarea id={`nt-${s.id}`} rows={2} value={note} disabled={!!s.emailedAt} onChange={(e) => setNote(e.target.value)} />
      </div>
      {bad ? <p className="tsalert">A line needs both a label and an amount like 1,250.00 or -45.00.</p> : null}
      <div className="tsrow">
        {!s.emailedAt ? (
          <button className="tsact" disabled={busy || bad || !dirty}
            onClick={() => act({ action: "save", statementId: s.id, ...(locked ? {} : { lines }), note }, `${s.payee} saved.`)}>
            {dirty ? "Save" : "Saved"}
          </button>
        ) : null}
        <button className="tsminor" onClick={onPreview} disabled={dirty}>Preview email</button>
        {!s.emailedAt ? (
          <button className="tsminor" disabled={busy} onClick={() => act({ action: "save", statementId: s.id, hold: !s.hold })}>
            {s.hold ? "Take off hold" : "Hold this month"}
          </button>
        ) : null}
        {!locked ? (
          <button className="tsminor" disabled={busy} onClick={() => act({ action: "remove", statementId: s.id })}>Remove</button>
        ) : null}
      </div>
    </section>
  );
}
