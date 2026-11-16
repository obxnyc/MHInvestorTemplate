"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonthPicker, RangeSummary, type Range } from "@/components/DistributionsRange";
import {
  rangeLabel, owedCents, checks, parseMoney, ownerEmailHtml, ownerEmailText, placeOf, laborLine, lotsIn, lineTotal, markupCents, markupable, vacantLots, netCents, shortDate, withGuarantee, reserveShortCents, reservesOf, subjectFor, monthLabel, usd, changeKindSays, type Line, type StatementInput, type Change,
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
  id: string; payeeId: string; payee: string; email: string; cc: string; settleDays: number;
  title: string; previousOwedCents: number | null; priorPaidCents: number | null; priorPaidOn: string | null;
  depositsCents: number | null; reserveHeldCents: number | null; reservePendingCents: number; reserveRequiredCents: number | null; statedNetCents: number | null; statedOwedCents: number | null; owedNote: string;
  lines: Line[]; netCents: number; owedCents: number; checks: string[]; note: string; hold: boolean;
  versus: { lastCents: number | null; lastOn: string | null; diffCents: number | null; loud: boolean; says: string[] };
  source: { group?: string } | null;
  entity: string; sendsAs: string;
  guaranteedCents: number | null; vacant: number[];
  startsOn: string | null; notStarted: boolean;
  emailedAt: string | null; emailedTo: string | null; emailDetail: string | null;
  checkedAt: string | null; checkedBy: string | null;
  payments: Pay[]; paidCents: number; plannedCents: number;
};
type Payee = { id: string; name: string; emails: string; settleDays: number; active: boolean };
type Data = {
  month: string; error?: string; migrationMissing?: boolean;
  run?: { id: string; capCents: number; startOn: string | null; perPaymentCents: number } | null;
  payees?: Payee[]; statements?: Statement[];
  /** null: migration 065 has not been run. */
  ccAll?: string | null;
  changes?: (Change & { statementId: string; payee: string; title: string; recordedAt: string | null; recordedBy: string | null })[] | null;
  pasted?: { payees: number; unmatched: string[]; skippedSent: number };
  sent?: { payee: string; ok: boolean; detail: string }[];
  said?: string;
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
/** "2026-10-14" or "10/14/2026" to "Oct 14"; anything else as written. */
const shortDay = (v: string) => {
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
    : (m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)) ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12)) : null;
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : v;
};

/** The lines as the owner will read them: revenue, then expenses, each with a subtotal. */
function StatementLines({ lines }: { lines: Line[] }) {
  const part = (name: string, ls: Line[]) => ls.length ? (
    <>
      <tr className="distlinegroup"><th colSpan={3}>{name}</th></tr>
      {ls.map((l, i) => (
        <tr key={i}>
          <td className="muted">{l.date ? shortDay(l.date) : ""}</td>
          <td>{l.label}{l.merchant ? <small> · {l.merchant}</small> : null}</td>
          <td className={`num${l.cents < 0 ? " distneg" : ""}`}>{money(l.cents)}</td>
        </tr>
      ))}
      <tr className="distsub"><td /><td>Subtotal</td><td className="num">{money(ls.reduce((a, l) => a + l.cents, 0))}</td></tr>
    </>
  ) : null;
  if (!lines.length) return <p className="tsnote">No lines yet.</p>;
  return (
    <table className="distlinetable">
      <tbody>
        {part("Revenue", lines.filter((l) => l.cents >= 0))}
        {part("Expenses", lines.filter((l) => l.cents < 0))}
      </tbody>
    </table>
  );
}

export default function DistributionsBoard() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Data | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<Statement | null>(null);
  const [cap, setCap] = useState("25000");
  const [per, setPer] = useState("5000");
  const [startOn, setStartOn] = useState("");
  const [conf, setConf] = useState<Record<string, string>>({});
  // Entering a payment made in Bill Pay: which owner's form is open, and what is typed in it.
  const [entering, setEntering] = useState<string | null>(null);
  const [entry, setEntry] = useState({ amount: "", on: "", conf: "" });
  const [confirmSend, setConfirmSend] = useState(false);
  const [newPayee, setNewPayee] = useState("");
  const [tab, setTab] = useState("list");
  const [range, setRange] = useState<Range | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Esc closes whatever is open on top: the preview, then the statement.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (preview) setPreview(null); else setOpenId(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [preview]);

  const load = useCallback(async () => {
    setProblem(null);
    const r = await fetch(`/api/distributions?month=${month}`);
    const text = await r.text();
    let j: Data | { error: string };
    try { j = JSON.parse(text); } catch { setProblem(`The server answered ${r.status} and not with data.`); return; }
    if (!r.ok) { setProblem((j as { error: string }).error); return; }
    setData(j as Data);
    const run = (j as Data).run;
    if (run) { setCap(String(run.capCents / 100)); setPer(String((run.perPaymentCents ?? 500000) / 100)); }
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Nothing on screen changes until the server says it took it.
  /* One write at a time, in the order asked. Leaving a box saves it, and
     the button pressed to leave it then landed on a control disabled by that
     save -- "Save changes" right after typing a copy address did nothing.
     Queued instead of refused, so the press counts; in order, so an older
     answer never lands on top of a newer one. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const act = (body: Record<string, unknown>, done?: string) => {
    const run = queue.current.then(() => actNow(body, done), () => actNow(body, done));
    queue.current = run;
    return run;
  };
  const actNow = async (body: Record<string, unknown>, done?: string) => {
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
      if (done) setSaid(done); else if (j.said) setSaid(j.said);
      return j;
    } finally { setBusy(false); }
  };

  const statements = data?.statements ?? [];
  // A test statement goes to whoever is testing and nowhere else: never in
  // the totals, the payment plan or the send-everything button.
  const isTest = (s: Statement) => s.source?.group === "Test";
  const sendable = statements.filter((s) => !isTest(s) && !s.notStarted && !s.emailedAt && !s.hold && s.lines.length && s.email);
  /* Send-all sends an owner only when EVERY statement in their email is
     checked. Sending just the checked ones would email an owner part of
     their month and look complete. */
  const waitingOwners = new Set(sendable.filter((s) => !s.checkedAt).map((s) => s.sendsAs));
  const ready = sendable.filter((s) => !waitingOwners.has(s.sendsAs));
  const waiting = sendable.filter((s) => waitingOwners.has(s.sendsAs));
  // One email per owning entity: the statements that travel together.
  const emailsOut = useMemo(() => {
    const m = new Map<string, Statement[]>();
    for (const s of ready) m.set(s.sendsAs, [...(m.get(s.sendsAs) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ready]);
  const together = (s: Statement) => statements.filter((x) => x.sendsAs === s.sendsAs);
  /* WHAT GOES IN THIS OWNER'S EMAIL -- one answer, used by the preview AND by
     the send. They were two answers once: the preview skipped held statements
     and the send did not, so a held owner previewed as an empty email and
     would have been sent a full one. */
  const emailSet = (s: Statement) => together(s).filter((x) => !x.emailedAt && !x.hold && !x.notStarted && x.lines.length);
  const asInput = (x: Statement): StatementInput => ({
    month: `${month}-01`, payee: x.payee, title: x.title, lines: x.lines, note: x.note, payments: x.payments,
    previousOwedCents: x.previousOwedCents, priorPaidCents: x.priorPaidCents, priorPaidOn: x.priorPaidOn, depositsCents: x.depositsCents,
    reserveHeldCents: x.reserveHeldCents, reservePendingCents: x.reservePendingCents, reserveRequiredCents: x.reserveRequiredCents,
  });
  const totalNet = statements.filter((s) => !isTest(s) && !s.hold && !s.notStarted && s.owedCents > 0).reduce((a, s) => a + s.owedCents, 0);
  const changes = data?.changes ?? [];
  const unrecorded = changes.filter((c) => !c.recordedAt).length;
  const [ccAll, setCcAll] = useState("");
  useEffect(() => { setCcAll(data?.ccAll ?? ""); }, [data?.ccAll]);
  const flagged = statements.filter((s) => !s.notStarted && (s.versus.loud || s.checks.some((c) => !/carries into this month/.test(c)))).length;
  const lastTotal = statements.reduce((a, s) => a + Math.max(0, s.versus.lastCents ?? 0), 0);
  const paidTotal = statements.reduce((a, s) => a + s.paidCents, 0);
  const days = useMemo(() => {
    const m: Record<string, { pay: Pay; s: Statement }[]> = {};
    for (const s of statements) for (const p of s.payments) (m[p.sendOn] ??= []).push({ pay: p, s });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [statements]);
  const capCents = data?.run?.capCents ?? 2_500_000;
  const pieceOf = (payId: string, st: Statement) => {
    if (st.payments.length < 2) return "";
    const ordered = [...st.payments].sort((x, y) => x.sendOn.localeCompare(y.sendOn) || y.cents - x.cents || x.id.localeCompare(y.id));
    return ` · payment ${ordered.findIndex((x) => x.id === payId) + 1} of ${ordered.length}`;
  };
  // Everybody, and how much of what they are owed has been paid.
  const perCents = (data?.run?.perPaymentCents ?? 500000);
  const byOwner = statements.filter((st) => st.payments.length || (!st.hold && !st.notStarted && st.owedCents > 0 && st.source?.group !== "Test"))
    .map((st) => ({ st, owed: Math.max(0, st.owedCents), planned: st.plannedCents, paid: st.paidCents }))
    .sort((a, b) => (a.paid >= a.owed ? 1 : 0) - (b.paid >= b.owed ? 1 : 0) || a.st.payee.localeCompare(b.st.payee));

  if (!data) {
    return <main className="wrap crewwrap">{problem
      ? <p className="tsalert" role="alert">{problem}</p>
      : <p className="tsloading">Loading&hellip;</p>}</main>;
  }

  const needsLook = (s: Statement) => !s.notStarted && (s.versus.loud || s.checks.some((c) => !/carries into this month/.test(c)));
  const groupOf = (s: Statement) => s.source?.group ?? "Other";
  const FILTERS: [string, string, (s: Statement) => boolean][] = [
    ["all", "All", () => true],
    ["look", "Needs a look", needsLook],
    ["pay", "To pay", (s) => s.owedCents > 0 && !s.hold],
    ["none", "Nothing to pay", (s) => s.owedCents <= 0],
    ["noemail", "No email", (s) => !s.email],
    ["unchecked", "Not checked", (s) => !s.emailedAt && !s.notStarted && !s.hold && !isTest(s) && s.lines.length > 0 && !s.checkedAt],
    ["paid", "Paid", (s) => s.paidCents > 0],
  ];
  const fn = FILTERS.find((f) => f[0] === filter)?.[2] ?? (() => true);
  const q = search.trim().toLowerCase();
  const shown = statements.filter(fn).filter((s) => !q || `${s.payee} ${s.title}`.toLowerCase().includes(q));
  const ORDER = ["Corporate", "Individuals", "Cross Creek"];
  const groups = [...new Set(shown.map(groupOf))].sort((a, b) => ((ORDER.indexOf(a) + 1) || 99) - ((ORDER.indexOf(b) + 1) || 99));
  const open = statements.find((s) => s.id === openId) ?? null;
  const status = (s: Statement) => {
    const out: [string, string][] = [];
    if (isTest(s)) out.push(["plan", "Test — only to you"]);
    if (s.notStarted && s.startsOn) out.push(["hold", `Starts ${monthLabel(s.startsOn)}`]);
    if (s.hold) out.push(["hold", "On hold"]);
    if (needsLook(s)) out.push(["warn", "Check"]);
    if (s.owedCents <= 0) out.push(["muted", "Nothing to pay"]);
    if (!s.email) out.push(["muted", "No email"]);
    if (!s.notStarted && reserveShortCents(s, s.lines) !== null) out.push(["warn", "Reserves not met"]);
    if (s.emailedAt) out.push(["ok", "Emailed"]);
    else if (s.checkedAt) out.push(["ok", "Checked"]);
    if (s.paidCents > 0) out.push(["ok", s.paidCents >= s.owedCents ? "Paid" : "Part paid"]);
    else if (s.plannedCents > 0) out.push(["plan", `Pay ${day(s.payments[0].sendOn)}`]);
    return out;
  };

  return (
    <main className="wrap crewwrap distwrap">
      <div className="tshead">
        <h1>Owner distributions</h1>
        <span className="distmonth">
          {range ? null : <button className="tslink" aria-label="Earlier month" onClick={() => setMonth(shiftMonth(month, -1))}>&larr;</button>}
          <MonthPicker month={month} range={range} onMonth={(m) => { setRange(null); setMonth(m); }} onRange={setRange}
            label={range ? rangeLabel(range.from, range.to, thisMonth() + "-01") : monthLabel(`${month}-01`)} />
          {range ? null : <button className="tslink" aria-label="Later month" onClick={() => setMonth(shiftMonth(month, 1))}>&rarr;</button>}
        </span>
      </div>

      {problem ? <p className="tsalert" role="alert">{problem}</p> : null}
      {said ? <p className="tsdone" role="status">{said}</p> : null}

      {range ? <RangeSummary range={range} onBack={() => setRange(null)} /> : data.migrationMissing ? (
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
          <dl className="disttotals">
            <div><dt>To pay</dt><dd>{usd(totalNet)}</dd></div>
            <div><dt>Last month</dt><dd>{usd(lastTotal)}</dd></div>
            <div><dt>Paid so far</dt><dd>{usd(paidTotal)}</dd></div>
            <button className={`distlook${flagged ? " on" : ""}`} onClick={() => { setTab("list"); setFilter("look"); }}>
              <dt>Needs a look</dt><dd>{flagged} of {statements.length}</dd>
            </button>
          </dl>

          <nav className="disttabs" role="tablist">
            {([["list", `Statements (${statements.length})`], ["pay", `Pay${days.length ? ` (${days.length} day${days.length === 1 ? "" : "s"})` : ""}`],
               ["record", `To record${unrecorded ? ` (${unrecorded})` : ""}`],
               ["email", "Email"], ["add", "Add or paste"]] as [string, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>

          {tab === "list" ? (
            <>
              <div className="distfilters">
                {FILTERS.map(([k, l, f]) => (
                  <button key={k} className={`chipf${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
                    {l} <span>{statements.filter(f).length}</span>
                  </button>
                ))}
                <input className="distsearch" type="search" placeholder="Find an owner" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>

              <div className="disttable" role="table">
                <div className="distrow disthead" role="row">
                  <span role="columnheader">Owner</span>
                  <span role="columnheader" className="num">This month</span>
                  <span role="columnheader" className="num">Last month</span>
                  <span role="columnheader" className="num">Change</span>
                  <span role="columnheader">Status</span>
                </div>
                {groups.map((g) => (
                  <div key={g} role="rowgroup">
                    <div className="distgroup">{g}</div>
                    {shown.filter((s) => groupOf(s) === g).map((s) => {
                      const diff = s.versus.lastCents === null ? null : s.owedCents - s.versus.lastCents;
                      return (
                        <button key={s.id} role="row" className={`distrow${openId === s.id ? " sel" : ""}${needsLook(s) ? " warn" : ""}`}
                          onClick={() => setOpenId(s.id)}>
                          <span className="distname"><strong>{s.payee}</strong><small>{placeOf(s.title, s.payee, s.lines)} · {s.email || "no email yet"}</small></span>
                          <span className={`num big${s.owedCents < 0 ? " distneg" : ""}`}>{money(s.owedCents)}</span>
                          <span className="num muted">{s.versus.lastCents === null ? "—" : usd(s.versus.lastCents)}</span>
                          <span className={`num${diff !== null && diff < 0 ? " distneg" : diff ? " distpos" : " muted"}`}>
                            {diff === null ? "—" : diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${usd(Math.abs(diff))}`}
                          </span>
                          <span className="diststatus">{status(s).map(([k, l]) => <i key={l} className={`dpill ${k}`}>{l}</i>)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!shown.length ? <p className="tsnote distempty">Nothing matches.</p> : null}
              </div>
            </>
          ) : null}

          {tab === "add" ? (
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
              <div className="tscardhead"><h2>Paste lines by hand</h2></div>
              <p className="tsnote">
                Alex&rsquo;s sheets are read in for you each month. For anything else, copy rows out of a
                spreadsheet and paste them here: a payee&rsquo;s name on its own row with their lines underneath
                (label, then amount), or one row per line as payee, label, amount. Costs with a minus or in brackets.
              </p>
              <div className="tsfield">
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6}
                  placeholder={"SHB Investments\nRent collected\t9,900.00\nLot rent\t(4,125.00)"} />
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
          ) : null}

          {tab === "record" ? (
            <section className="tscard">
              <div className="tscardhead">
                <h2>To record in Rent Manager</h2>
                <span className="tsnum">{changes.length ? (unrecorded ? `${unrecorded} of ${changes.length} not entered` : "All entered") : ""}</span>
              </div>
              {data.changes === null ? <p className="tsalert">Migration 065 has not been run, so this list cannot be kept yet.</p> : !changes.length ? (
                <p className="tsnote">Nothing this month differs from Rent Manager yet. Anything changed on a statement, and every payment marked paid, appears here.</p>
              ) : (
                <>
                  <p className="tsnote">
                    Everything changed here this month that Rent Manager does not have, and every payment sent. Tick each one once it is
                    entered there. Changing a line again after it was ticked puts it back on the list. Next month&rsquo;s sheet is checked
                    against this month as it was left here, so anything missed shows up on that owner&rsquo;s statement.
                  </p>
                  <div className="tsrow">
                    <button className="btn" onClick={async () => {
                      const rows = [["Owner", "Property", "Date", "What", "Change", "Effect on payout", "Detail"],
                        ...changes.filter((c) => !c.recordedAt).map((c) => [c.payee, c.title, c.date ?? "", c.label, changeKindSays(c.kind),
                          (c.cents / 100).toFixed(2), c.detail])];
                      try { await navigator.clipboard.writeText(rows.map((r) => r.join("\t")).join("\n")); setSaid("Copied. It pastes into Excel as a table."); }
                      catch { setProblem("This browser would not copy. Select the table and copy it instead."); }
                    }} disabled={!unrecorded}>Copy what is not entered</button>
                  </div>
                  <div className="distrecord">
                    {changes.map((c) => (
                      <label key={c.key} className={`distrecrow${c.recordedAt ? " done" : ""}`}>
                        <input type="checkbox" checked={!!c.recordedAt} disabled={busy}
                          onChange={(e) => act({ action: "record", keys: [c.key], recorded: e.target.checked })} />
                        <span className="distrecwhat">
                          <strong>{c.payee}</strong> <small>{placeOf(c.title, c.payee, [])}</small>
                          <span>{changeKindSays(c.kind)}: {c.label}{c.date ? ` · ${shortDay(c.date)}` : ""}</span>
                          <small>{c.detail}{c.recordedAt ? ` · entered${c.recordedBy ? ` by ${c.recordedBy}` : ""} ${new Date(c.recordedAt).toLocaleDateString()}` : ""}</small>
                        </span>
                        <span className={`num${c.kind !== "paid" && c.cents < 0 ? " distneg" : ""}`}>{c.kind === "paid" ? usd(c.cents) : money(c.cents)}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === "email" ? (
            <section className="tscard">
              <div className="tscardhead">
                <h2>Email the statements</h2>
                <span className="tsnum">{emailsOut.length} email{emailsOut.length === 1 ? "" : "s"} · {ready.length} statements</span>
              </div>
              <p className="tsnote">
                Nothing is emailed until you press the button below. One email per owning entity,
                &ldquo;{subjectFor(`${month}-01`)}&rdquo;, with each of its properties in its own block; you get a
                copy of every one, and replies come to you. A statement on hold, with no lines, or with no email
                address is not sent.
              </p>
              {data.ccAll === null ? <p className="tsalert">Migration 065 has not been run, so copies cannot be set yet.</p> : (
                <div className="tsfield">
                  <label htmlFor="ccall">Copy on every statement (your bookkeeper)</label>
                  <input id="ccall" type="text" inputMode="email" value={ccAll} placeholder="name@larabeehomesllc.com"
                    onChange={(e) => setCcAll(e.target.value)}
                    onBlur={() => ccAll !== (data.ccAll ?? "") && act({ action: "cc-all", cc: ccAll }, "Saved.")} />
                </div>
              )}
              {!confirmSend ? (<>
                {waiting.length ? (
                  <p className="tsalert">
                    {waitingOwners.size} owner{waitingOwners.size === 1 ? " is" : "s are"} not in this send because a statement in their email has not been checked:{" "}
                    {[...waitingOwners].sort().map((o, i) => <span key={o}>{i ? ", " : ""}<button className="tslink distinline"
                      onClick={() => { setTab("list"); setOpenId(waiting.find((x) => x.sendsAs === o && !x.checkedAt)!.id); }}>{o}</button></span>)}.
                    Open each, look it over, and press Mark checked.
                  </p>
                ) : null}
                <button className="tsact" disabled={busy || !ready.length} onClick={() => setConfirmSend(true)}>
                  Send {emailsOut.length} email{emailsOut.length === 1 ? "" : "s"}&hellip;
                </button>
              </>) : (
                <>
                  <ul className="distsendlist">
                    {emailsOut.map(([entity, list]) => (
                      <li key={entity}>
                        <span><strong>{entity}</strong>{list.length > 1 ? <small> · {list.length} properties in one email</small> : null}</span>
                        <span className="num">{usd(list.reduce((a, x) => a + Math.max(0, x.owedCents), 0))}</span>
                        <span className="muted">{[...new Set(list.map((x) => x.email))].join(", ")}{(() => {
                          const c = [...new Set([...list.flatMap((x) => x.cc.split(/[,;\s]+/)), ...ccAll.split(/[,;\s]+/)].filter(Boolean).map((e) => e.toLowerCase()))];
                          return c.length ? ` · copy ${c.join(", ")}` : "";
                        })()}</span>
                      </li>
                    ))}
                  </ul>
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
                    }}>Yes, send these {emailsOut.length}</button>
                    <button className="tsminor" onClick={() => setConfirmSend(false)}>Not yet</button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === "pay" ? (
            <section className="tscard">
              <div className="tscardhead">
                <h2>Pay through Wells Fargo</h2>
                <span className="tsnum">{usd(capCents)} a day</span>
              </div>
              <div className="distplanform">
                <div className="tsfield">
                  <label htmlFor="cap">Daily limit ($)</label>
                  <input id="cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
                </div>
                <div className="tsfield">
                  <label htmlFor="per">Most per payment ($)</label>
                  <input id="per" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} />
                </div>
                <div className="tsfield">
                  <label htmlFor="start">First day to send</label>
                  <input id="start" type="date" value={startOn || data.run.startOn || ""} onChange={(e) => setStartOn(e.target.value)} />
                </div>
                <button className="tsact distplanbtn" disabled={busy} onClick={() => {
                  const c = parseMoney(cap);
                  const pp = parseMoney(per);
                  if (!c || c <= 0) { setProblem("The daily limit has to be an amount."); return; }
                  if (!pp || pp <= 0) { setProblem("The most per payment has to be an amount."); return; }
                  act({ action: "plan", capCents: c, perPaymentCents: pp, startOn: startOn || data.run?.startOn || "" }, "Planned.");
                }}>{days.length ? "Plan again" : "Plan the payments"}</button>
              </div>
              <p className="tsnote">
                Anyone owed more than the most per payment is paid in pieces of that size, each its own Bill Pay
                payment. No day goes over the daily limit, slowest banks go first, and anything already marked paid
                keeps its day. Statements on hold, not started, or with nothing to pay are left out.
              </p>

              {byOwner.length ? (
                <div className="distbyowner">
                  <div className="tscardhead"><h2>By owner</h2>
                    <span className="tsnum">{byOwner.filter((o) => o.paid >= o.owed && o.owed > 0).length} of {byOwner.length} paid in full</span></div>
                  <div className="edrow edhead dbo"><span>Owner</span><span className="num">Owed</span><span className="num">Planned</span><span className="num">Paid</span><span className="num">Still to pay</span></div>
                  {byOwner.map(({ st, owed, planned, paid }) => {
                    const left = owed - paid;
                    const off = planned !== owed;
                    const open = entering === st.id;
                    const made = st.payments.filter((x) => x.paidAt).sort((a, b) => a.sendOn.localeCompare(b.sendOn));
                    const amt = parseMoney(entry.amount);
                    return (
                      <div key={st.id} className={`dboitem${left <= 0 ? " done" : ""}${open ? " open" : ""}`}>
                        <div className="edrow dbo">
                          <span className="distname">
                            <button className="tslink distinline" onClick={() => setOpenId(st.id)}><strong>{st.payee}</strong></button>
                            <small>{made.length ? made.map((x) => `${usd(x.cents)} ${day(x.sendOn)}${x.confirmation ? ` #${x.confirmation}` : ""}`).join(" · ") : "Nothing paid yet"}</small>
                          </span>
                          <span className="num" data-k="Owed">{usd(owed)}</span>
                          <span className={`num${off ? " distneg" : ""}`} data-k="Planned">{usd(planned)}{off ? <small>{planned < owed ? "plan again" : "more than owed"}</small> : null}</span>
                          <span className="num" data-k="Paid">{usd(paid)}</span>
                          <span className={`num${left > 0 ? "" : " distpos"}`} data-k="Left"><strong>{left > 0 ? usd(left) : left === 0 ? "Paid in full" : `${usd(-left)} over`}</strong></span>
                        </div>
                        {open ? (
                          <div className="dboentry">
                            <div className="tsfield"><label htmlFor={`ea-${st.id}`}>Amount paid ($)</label>
                              <input id={`ea-${st.id}`} inputMode="decimal" autoFocus value={entry.amount} placeholder={left > 0 ? (Math.min(left, perCents) / 100).toFixed(2) : ""}
                                onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></div>
                            <div className="tsfield"><label htmlFor={`ed-${st.id}`}>Date it is paid</label>
                              <input id={`ed-${st.id}`} type="date" value={entry.on} onChange={(e) => setEntry({ ...entry, on: e.target.value })} /></div>
                            <div className="tsfield"><label htmlFor={`ec-${st.id}`}>Confirmation #</label>
                              <input id={`ec-${st.id}`} value={entry.conf} onChange={(e) => setEntry({ ...entry, conf: e.target.value })} /></div>
                            <div className="dboentrybtns">
                              <button className="btn pri" disabled={busy || !amt || amt <= 0 || !entry.on}
                                onClick={async () => { if (await act({ action: "enter-paid", statementId: st.id, cents: amt, sendOn: entry.on, confirmation: entry.conf })) setEntering(null); }}>Save payment</button>
                              <button className="btn" onClick={() => setEntering(null)}>Cancel</button>
                            </div>
                            <p className="tsnote dboentrynote">
                              {amt && amt > 0 ? <>After this, <strong>{owed - paid - amt > 0 ? `${usd(owed - paid - amt)} left` : owed - paid - amt === 0 ? "paid in full" : `${usd(paid + amt - owed)} more than owed`}</strong>.{amt > perCents ? ` Bill Pay allows ${usd(perCents)} a payment.` : ""} </> : null}
                              {st.payments.some((x) => !x.paidAt) ? "Anything planned for this owner and not yet paid is taken off when you save; Plan again schedules what is left." : ""}
                            </p>
                          </div>
                        ) : (
                          <div className="dboactions">
                            <button className="btn" onClick={() => { setEntering(st.id); setEntry({ amount: "", on: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), conf: "" }); }}>
                              Enter a payment
                            </button>
                            {made.length ? made.map((x) => (
                              <button key={x.id} className="tslink" disabled={busy}
                                onClick={() => window.confirm(`Take off the ${usd(x.cents)} payment on ${day(x.sendOn)}? It goes back to being planned, not paid.`) && act({ action: "paid", paymentId: x.id, undo: true }, "Taken off as paid.")}>
                                Undo {usd(x.cents)} {day(x.sendOn)}
                              </button>
                            )) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="distdays">
                {days.map(([d, rows]) => {
                  const total = rows.reduce((a, r) => a + r.pay.cents, 0);
                  const done = rows.every((r) => r.pay.paidAt);
                  return (
                    <div key={d} className={`distday${done ? " done" : ""}`}>
                      <div className="distdayhead">
                        <strong>{day(d)}</strong>
                        <span className={`tsnum${total > capCents ? " over" : ""}`}>{usd(total)} <span className="muted">of {usd(capCents)}</span></span>
                      </div>
                      <div className="distbar"><span style={{ width: `${Math.min(100, (total / capCents) * 100)}%` }} /></div>
                      <ul className="distpays">
                        {rows.map(({ pay, s }) => (
                          <li key={pay.id} className={pay.paidAt ? "paid" : ""}>
                            <button className="distwho" onClick={() => setOpenId(s.id)}>
                              <strong>{s.payee}{pieceOf(pay.id, s)}</strong>
                              <span className={`muted${s.versus.loud ? " distneg" : ""}`}>
                                {s.versus.loud ? "Check the statement · " : ""}{s.versus.lastCents !== null ? `last month ${usd(s.versus.lastCents)} · ` : ""}arrives {day(pay.arrivesOn)}
                              </span>
                            </button>
                            <span className="payamt">{usd(pay.cents)}</span>
                            {pay.paidAt ? (
                              <span className="distpaid">
                                Paid{pay.confirmation ? ` · #${pay.confirmation}` : ""}
                                <button className="tslink" disabled={busy} onClick={() => act({ action: "paid", paymentId: pay.id, undo: true })}>Undo</button>
                              </span>
                            ) : (
                              <span className="distmark">
                                <input aria-label={`Confirmation number for ${s.payee}`} placeholder="Confirmation #"
                                  value={conf[pay.id] ?? ""} onChange={(e) => setConf({ ...conf, [pay.id]: e.target.value })} />
                                <button className="btn pri" disabled={busy}
                                  onClick={() => act({ action: "paid", paymentId: pay.id, confirmation: conf[pay.id] ?? "" }, `${s.payee}: ${usd(pay.cents)} marked paid.`)}>
                                  Mark paid
                                </button>
                                <button className="tslink" disabled={busy} title="Take this off the plan. Nothing has been paid."
                                  onClick={() => act({ action: "unplan", paymentId: pay.id }, `${s.payee}: the planned ${usd(pay.cents)} for ${day(pay.sendOn)} is off the plan.`)}>
                                  Remove
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      {open ? (
        <>
          <div className="distscrim" onClick={() => setOpenId(null)} />
          <aside className="distdrawer" role="dialog" aria-label={`Statement for ${open.payee}`}>
            <div className="distdrawerbar">
              <button className="tslink" aria-label="Previous statement" disabled={shown.findIndex((x) => x.id === open.id) <= 0}
                onClick={() => { const i = shown.findIndex((x) => x.id === open.id); if (i > 0) setOpenId(shown[i - 1].id); }}>&uarr;</button>
              <button className="tslink" aria-label="Next statement" disabled={shown.findIndex((x) => x.id === open.id) >= shown.length - 1}
                onClick={() => { const i = shown.findIndex((x) => x.id === open.id); if (i >= 0 && i < shown.length - 1) setOpenId(shown[i + 1].id); }}>&darr;</button>
              <span className="muted">{shown.findIndex((x) => x.id === open.id) + 1} of {shown.length}</span>
              <button className="btn" onClick={() => setOpenId(null)}>Close</button>
            </div>
            <StatementCard key={open.id} s={open} busy={busy} act={act} onPreview={() => setPreview(open)}
              others={together(open).filter((x) => x.id !== open.id)} onOpen={setOpenId} sendSet={emailSet(open)} ccAll={data.ccAll ?? ""} all={statements} />
          </aside>
        </>
      ) : null}

      {preview ? (
        <div className="distpreview" role="dialog" aria-label={`Statement for ${preview.payee}`}>
          <div className="distpreviewbar">
            <span><strong>{subjectFor(`${month}-01`)}</strong> &middot; {preview.sendsAs} &middot; to {[...new Set(emailSet(preview).flatMap((x) => x.email.split(/[,;\s]+/)).filter(Boolean).map((e) => e.toLowerCase()))].join(", ") || "no address yet"}</span>
            {emailSet(preview).length ? (() => {
              /* Sending it yourself from Gmail, while Postmark is not yet
                 approved to send to outside addresses: copy the finished email
                 (formatted, logo and all), paste it into Gmail, and then record
                 here that it went -- which locks it as the record, exactly as
                 the app's own send would. */
              const set = emailSet(preview);
              const to = [...new Set(set.flatMap((x) => x.email.split(/[,;\s]+/)).filter(Boolean).map((e) => e.toLowerCase()))];
              const copyAll = async () => {
                const html = ownerEmailHtml(`${month}-01`, preview.sendsAs, set.map(asInput));
                const text = ownerEmailText(`${month}-01`, preview.sendsAs, set.map(asInput));
                try {
                  if (typeof ClipboardItem !== "undefined") {
                    await navigator.clipboard.write([new ClipboardItem({
                      "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
                  } else await navigator.clipboard.writeText(text);
                  setSaid(`Copied. In Gmail: New message, To ${to.join(", ") || "(no address on file)"}, subject "${subjectFor(`${month}-01`)}", then paste into the body.`);
                } catch { setProblem("This browser would not copy. Click inside the preview, press Ctrl/Cmd-A then Ctrl/Cmd-C, and paste that into Gmail."); }
              };
              const cc = [...new Set([...set.flatMap((x) => x.cc.split(/[,;\s]+/)), ...ccAll.split(/[,;\s]+/)]
                .filter(Boolean).map((e) => e.toLowerCase()))].filter((e) => !to.includes(e));
              /* A new Gmail message with To, Cc and the subject filled in, and the
                 formatted statement on the clipboard to paste as its body. Gmail
                 lets another site fill those fields; it does not let one put a
                 formatted body in, so the paste is the one step left. Copied first,
                 then opened, while the press still counts as the person's own. */
              const openGmail = async () => {
                await copyAll();
                // encodeURIComponent, not URLSearchParams: a "+" for a space can show up in Gmail's subject as a "+".
                const q = [["view", "cm"], ["fs", "1"], ["to", to.join(",")], ["su", subjectFor(`${month}-01`)], ...(cc.length ? [["cc", cc.join(",")]] : [])]
                  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
                window.open(`https://mail.google.com/mail/?${q}`, "_blank", "noopener");
                setSaid(`Gmail is open with the address and subject filled in. Click in the body and paste (Cmd-V or Ctrl-V), look it over, and send. Then come back and press "I sent it from Gmail".`);
              };
              return (<>
                <button className="btn pri" disabled={!to.length} onClick={openGmail}>Open in Gmail</button>
                <button className="btn" onClick={copyAll}>Copy for Gmail</button>
                <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(subjectFor(`${month}-01`)); setSaid("Subject copied."); } catch { /* shown on screen anyway */ } }}>Copy subject</button>
                <button className="btn" disabled={busy} onClick={async () => {
                  const unchecked = set.filter((x) => !x.checkedAt);
                  if (!window.confirm(`${unchecked.length ? `${unchecked.length} of these ${set.length} statement(s) have not been marked checked.\n\n` : ""}Record that you emailed ${preview.sendsAs} from Gmail${to.length ? ` (${to.join(", ")})` : ""}? ${set.length > 1 ? "These statements are" : "This statement is"} then locked as sent, the same as if the app had sent it.`)) return;
                  const j = await act({ action: "sent-myself", statementIds: set.map((x) => x.id), to: to.join(", ") }, `${preview.sendsAs}: recorded as sent from Gmail.`);
                  if (j) setPreview(null);
                }}>I sent it from Gmail</button>
              </>);
            })() : null}
            <button className="btn" onClick={() => setPreview(null)}>Close</button>
          </div>
          {emailSet(preview).length ? (
            <iframe title="Statement preview" sandbox="" srcDoc={ownerEmailHtml(`${month}-01`, preview.sendsAs,
              emailSet(preview).map(asInput))} />
          ) : (
            <div className="edmodal" style={{ margin: "2rem auto" }}>
              <h3>Nothing would be sent</h3>
              <p className="tsnote">{preview.notStarted && preview.startsOn ? `Distributions on this property start ${monthLabel(preview.startsOn)}, so it is not in this month's email.` : preview.hold ? "This statement is on hold, so it is left out of the email." : "Every statement for this owner has already been sent or has no lines."}</p>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

function StatementCard({ s, busy, act, onPreview, others, onOpen, sendSet, ccAll, all }: {
  s: Statement; busy: boolean;
  act: (b: Record<string, unknown>, done?: string) => Promise<unknown>;
  onPreview: () => void;
  others: Statement[]; onOpen: (id: string) => void; sendSet: Statement[]; ccAll: string; all: Statement[];
}) {
  /* One row per line, edited in place. Amounts are typed as they read --
     a cost of 29.17 is typed 29.17 in the Expenses section, not -29.17 --
     and the section says which way it goes. `orig` is Alex's amount for a
     line that came from his sheet, so a changed amount keeps what he said. */
  type Row = { label: string; amount: string; side: "in" | "out"; pct: string;
               date?: string; merchant?: string; category?: string; orig?: number; sheet?: number; removed?: boolean;
               origLabel?: string };
  const isOurs = (c?: string) => c === "Adjustment" || c === "Guaranteed rent";
  const toRows = (ls: Line[]): Row[] => ls.map((l) => ({
    label: l.label, amount: centsText(Math.abs(l.cents)), side: l.cents < 0 ? "out" : "in",
    pct: l.markupPct ? String(l.markupPct) : "", date: l.date, merchant: l.merchant, category: l.category,
    orig: isOurs(l.category) ? undefined : (l.sheetCents ?? l.cents), sheet: l.sheetCents, removed: l.removed,
    origLabel: isOurs(l.category) ? undefined : (l.sheetLabel ?? l.label),
  }));
  const own = (ls: Line[]) => ls.filter((l) => l.category !== "Guaranteed rent");
  const [rows, setRows] = useState<Row[]>(() => toRows(own(s.lines)));
  const [note, setNote] = useState(s.note);
  const [email, setEmail] = useState(s.email);
  const [cc, setCc] = useState(s.cc);
  const [settle, setSettle] = useState(String(s.settleDays));
  const [entity, setEntity] = useState(s.entity);
  const [guar, setGuar] = useState(s.guaranteedCents ? centsText(s.guaranteedCents) : "");
  const [bulk, setBulk] = useState("15");
  const [starts, setStarts] = useState(s.startsOn ? s.startsOn.slice(0, 7) : "");
  const [sending, setSending] = useState(false);
  // In the send dialog: which statements in this email the sender has ticked as checked.
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [sentSaid, setSentSaid] = useState<string | null>(null);
  // This owner's email: this statement and any of the same entity not yet sent.
  const sendWith = sendSet;
  const [labor, setLabor] = useState(false);
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState(() => { try { return localStorage.getItem("dist-labor-rate") ?? ""; } catch { return ""; } });
  const [what, setWhat] = useState("");
  const [lot, setLot] = useState("");
  const [deposit, setDeposit] = useState(s.depositsCents === null ? "" : centsText(s.depositsCents));
  const [resHeld, setResHeld] = useState(s.reserveHeldCents === null ? "" : centsText(s.reserveHeldCents));
  const [resNeed, setResNeed] = useState(s.reserveRequiredCents === null ? "" : centsText(s.reserveRequiredCents));
  /* Reset the boxes only when the SAVED statement changed. Every answer from
     the server is a fresh array, so keying on the array itself threw away
     whatever had been typed and not yet saved each time an owner field
     (reserves, email) was saved on its own. */
  const savedKey = JSON.stringify([own(s.lines), s.note, s.depositsCents]);
  useEffect(() => { setRows(toRows(own(s.lines))); setNote(s.note); setDeposit(s.depositsCents === null ? "" : centsText(s.depositsCents)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setResHeld(s.reserveHeldCents === null ? "" : centsText(s.reserveHeldCents));
    setResNeed(s.reserveRequiredCents === null ? "" : centsText(s.reserveRequiredCents)); }, [s.reserveHeldCents, s.reserveRequiredCents]);
  useEffect(() => { setCc(s.cc); }, [s.cc]);
  useEffect(() => { setEmail(s.email); setSettle(String(s.settleDays)); setEntity(s.entity);
    setGuar(s.guaranteedCents ? centsText(s.guaranteedCents) : ""); }, [s.email, s.settleDays, s.entity, s.guaranteedCents]);

  const locked = !!s.emailedAt || s.paidCents > 0;
  const rowBad = (r: Row) => {
    const a = parseMoney(r.amount);
    const p = r.pct.trim() === "" ? 0 : Number(r.pct);
    return !r.label.trim() || a === null || a < 0 || !Number.isFinite(p) || p < 0 || p > 100;
  };
  const toLine = (r: Row): Line => {
    const abs = parseMoney(r.amount) ?? 0;
    const cents = r.side === "out" ? -abs : abs;
    const p = Number(r.pct);
    const sheetCents = r.orig !== undefined && cents !== r.orig ? r.orig : undefined;
    const label = r.label.trim();
    const sheetLabel = r.origLabel !== undefined && label !== r.origLabel ? r.origLabel : undefined;
    return {
      label, cents,
      ...(sheetLabel !== undefined ? { sheetLabel } : {}),
      ...(r.date ? { date: r.date } : {}), ...(r.merchant ? { merchant: r.merchant } : {}), ...(r.category ? { category: r.category } : {}),
      ...(r.side === "out" && p > 0 ? { markupPct: Math.round(p * 100) / 100 } : {}),
      ...(sheetCents !== undefined ? { sheetCents } : {}),
      ...(r.removed ? { removed: true } : {}),
    };
  };
  const bad = rows.some(rowBad);
  const ownLines: Line[] = rows.filter((r) => !rowBad(r)).map(toLine);
  // The agreement, as typed right now: its top-ups follow every change on screen.
  const guarCents = parseMoney(guar) ?? 0;
  const lines: Line[] = s.emailedAt ? s.lines : withGuarantee(ownLines, guarCents);
  const topups = lines.filter((l) => l.category === "Guaranteed rent");
  /* Compared field by field in a fixed order. JSON.stringify follows the order
     the keys were written in, and the server writes them in a different order
     from this screen -- so a renamed line read as "not saved" forever after it
     was saved, and Mark checked could never be pressed. */
  const norm = (ls: Line[]) => JSON.stringify(ls.map((l) => [l.label, l.cents, l.date ?? null, l.merchant ?? null, l.category ?? null,
    l.markupPct ?? 0, l.sheetCents ?? null, l.sheetLabel ?? null, !!l.removed]));
  const depositCents = deposit.trim() === "" ? null : parseMoney(deposit);
  const linesDirty = norm(ownLines) !== norm(own(s.lines)) || note !== s.note || depositCents !== s.depositsCents;
  const held = { reserveHeldCents: resHeld.trim() === "" ? null : parseMoney(resHeld), reserveRequiredCents: resNeed.trim() === "" ? null : parseMoney(resNeed) };
  /* The owner's own fields (reserves, the rent agreement, email, copies...)
     save when the box is left. They count as unsaved until then, so the
     button lights up while one is being typed -- with it dark, a reserve typed
     in read as "it will not let me save", when it had saved already. */
  const payeeDirty = email !== s.email || cc !== s.cc || settle !== String(s.settleDays) || entity !== s.entity
    || (starts || null) !== (s.startsOn ? s.startsOn.slice(0, 7) : null) || (parseMoney(guar) ?? 0) !== (s.guaranteedCents ?? 0)
    || held.reserveHeldCents !== s.reserveHeldCents || held.reserveRequiredCents !== s.reserveRequiredCents;
  const dirty = linesDirty || payeeDirty;
  const owed = owedCents(lines, s);
  const said = checks(s.title, lines, { ...s, ...held, depositsCents: depositCents });
  const savePayee = () => act({ action: "payee", payeeId: s.payeeId, email, cc, settleDays: Number(settle), entity, startsOn: starts,
    guaranteedCents: guarCents, reserveHeldCents: held.reserveHeldCents, reserveRequiredCents: held.reserveRequiredCents });
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const carried = (s.previousOwedCents ?? 0) - (s.priorPaidCents ?? 0);

  // Whole-statement tools. They change the rows here; nothing is kept until Save.
  const canBulk = rows.filter((r) => !rowBad(r) && markupable(toLine(r)));
  const bulkPct = Number(bulk);
  const applyBulk = () => setRows(rows.map((r) => (!rowBad(r) && markupable(toLine(r)) ? { ...r, pct: String(bulkPct) } : r)));
  const anyMarkup = rows.some((r) => Number(r.pct) > 0);
  const homes = [...new Set(lines.flatMap((l) => lotsIn(l.label)))].sort((a, b) => a - b);
  const laborDraft = laborLine(Number(hours), parseMoney(rate) ?? 0, what, lot ? Number(lot) : null);
  const addRow = (l: Line) => setRows([...rows, ...toRows([l]).map((r) => ({ ...r, orig: undefined }))]);

  const section = (side: "in" | "out") => {
    const idx = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.side === side);
    if (!idx.length) return null;
    const subtotal = idx.reduce((a, { r }) => a + (rowBad(r) ? 0 : lineTotal(toLine(r))), 0);
    return (
      <div className="edsection">
        <div className="edrow edhead">
          <span>{side === "in" ? "Revenue" : "Expenses"}</span>
          <span className="num">Amount</span>
          <span className="num">{side === "out" ? "Markup %" : ""}</span>
          <span className="num">Total</span>
          <span />
        </div>
        {idx.map(({ r, i }) => {
          const l = rowBad(r) ? null : toLine(r);
          const changed = l && r.orig !== undefined && l.cents !== r.orig;
          return (
            <div key={i} className={`edrow${rowBad(r) ? " bad" : ""}${isOurs(r.category) ? " ours" : ""}${r.removed ? " removed" : ""}`}>
              <span className="eddesc">
                <span className="eddate">{shortDate(r.date)}</span>
                {!locked && !r.removed
                  ? <span className="edlabel">
                      <input aria-label={`Description${r.origLabel ? ` for ${r.origLabel}` : ""}`} value={r.label} spellCheck lang="en-US" autoCorrect="on"
                        placeholder="What it is for" onChange={(e) => set(i, { label: e.target.value })}
                        className={r.origLabel !== undefined && r.label.trim() !== r.origLabel ? "changed" : ""} />
                      {r.merchant ? <small>{r.merchant}</small> : null}
                      {r.origLabel !== undefined && r.label.trim() !== r.origLabel
                        ? <small className="edwas">Alex: {r.origLabel}{" "}
                            <button className="tslink distinline" onClick={() => set(i, { label: r.origLabel! })}>undo</button></small>
                        : null}
                    </span>
                  : <span>{r.label}{r.merchant ? <small> · {r.merchant}</small> : null}</span>}
              </span>
              <span className="num">
                <input aria-label={`Amount for ${r.label}`} inputMode="decimal" value={r.amount} disabled={locked || r.removed}
                  onChange={(e) => set(i, { amount: e.target.value })} className={changed ? "changed" : ""} />
                {changed ? <small className="edwas">Alex: {usd(Math.abs(r.orig!))}{" "}
                  <button className="tslink distinline" disabled={locked} onClick={() => set(i, { amount: centsText(Math.abs(r.orig!)) })}>undo</button></small> : null}
              </span>
              <span className="num">
                {side === "out"
                  ? <input aria-label={`Markup percent for ${r.label}`} inputMode="decimal" value={r.pct} disabled={locked || r.removed}
                      onChange={(e) => set(i, { pct: e.target.value })} className="edpct" />
                  : null}
              </span>
              <span className={`num edtotal${side === "out" ? " distneg" : ""}`}>
                {r.removed ? <span className="muted">deleted</span> : l ? money(lineTotal(l)) : "—"}
                {l && markupCents(l) ? <small>incl. {usd(-markupCents(l))} markup</small> : null}
              </span>
              <span>{locked ? null : r.removed
                ? <button className="tslink edundo" aria-label={`Put back ${r.label}`} onClick={() => set(i, { removed: false })}>undo</button>
                : <button className="eddel" aria-label={`Delete ${r.label}`} title="Delete this line"
                    onClick={() => (isOurs(r.category) ? setRows(rows.filter((_, j) => j !== i)) : set(i, { removed: true }))}>&times;</button>}</span>
            </div>
          );
        })}
        <div className="edrow edsub"><span>Subtotal</span><span /><span /><span className="num">{money(subtotal)}</span><span /></div>
      </div>
    );
  };

  return (
    <section className={`edsheet${s.hold ? " held" : ""}`}>
      <header className="edtop">
        <div>
          <h2 className="distowner">{s.payee}</h2>
          <p className="tsnote">{placeOf(s.title, s.payee, s.lines)} · {s.email || "no email yet"}</p>
        </div>
        <div className="edowed">
          <small>{owed < 0 ? "No distribution" : "Distribution"}</small>
          <strong className={owed < 0 ? "distneg" : ""}>{money(owed)}</strong>
          <small>last month {s.versus.lastCents === null ? "—" : usd(s.versus.lastCents)}</small>
        </div>
      </header>

      {s.notStarted && s.startsOn ? (
        <p className="tsnudge">Distributions on this property start {monthLabel(s.startsOn)}. This month&rsquo;s statement is kept here for the record and is not emailed, owed or paid.</p>
      ) : [...s.versus.says, ...said].map((c) => <p key={c} className="tsnudge loud">{c}</p>)}

      <div className="edheld">
        <div className="tsfield">
          <label htmlFor={`dp-${s.id}`}>Security deposit held ($)</label>
          <input id={`dp-${s.id}`} inputMode="decimal" value={deposit} disabled={!!s.emailedAt} onChange={(e) => setDeposit(e.target.value)} />
        </div>
        <div className="tsfield">
          <label htmlFor={`rh-${s.id}`}>Reserves held before this statement ($)</label>
          <input id={`rh-${s.id}`} inputMode="decimal" value={resHeld} onChange={(e) => setResHeld(e.target.value)}
            onBlur={() => held.reserveHeldCents !== s.reserveHeldCents && savePayee()} />
        </div>
        <div className="tsfield">
          <label htmlFor={`rr-${s.id}`}>Reserves required ($)</label>
          <input id={`rr-${s.id}`} inputMode="decimal" value={resNeed} onChange={(e) => setResNeed(e.target.value)}
            onBlur={() => held.reserveRequiredCents !== s.reserveRequiredCents && savePayee()} />
        </div>
        <div className="tsfield">
          <label htmlFor={`gr-${s.id}`}>Rent agreement ($ per home)</label>
          <input id={`gr-${s.id}`} inputMode="decimal" value={guar} disabled={!!s.emailedAt}
            onChange={(e) => setGuar(e.target.value)}
            onBlur={() => guarCents !== (s.guaranteedCents ?? 0) && savePayee()} />
        </div>
        <p className="tsnote edheldnote">
          {(() => {
            /* What the statement does to the reserve, worked out as you type: a
               line with "reserve" in it is money put in, and whatever the month's
               income did not cover comes out of the next statement. */
            const r = reservesOf(lines, { ...s, ...held });
            return (<>
              {r.intoCents || r.recoveredCents ? <strong>After this statement: {usd(r.heldCents)} held{r.requiredCents ? ` of ${usd(r.requiredCents)} required` : ""}
                {r.intoCents ? ` (${usd(r.intoCents)} put in${r.shortCents ? `, ${usd(r.shortCents)} of it not covered this month and taken from the next statement` : ""})` : ""}
                {r.recoveredCents ? ` (${usd(r.recoveredCents)} made good from last month)` : ""}. </strong> : null}
              {reserveShortCents({ ...s, ...held }, lines) !== null ? <strong className="distneg">Reserves not met. </strong> : null}
            </>);
          })()}
          A line with &ldquo;reserve&rdquo; in its description is money put into reserves, not spent.
          The rent agreement pays every home at least that rent: an empty home in full, a lower rent topped up to it.
          Reserves and the agreement are kept for this owner from month to month; the deposit is this month&rsquo;s figure.
        </p>
      </div>

      {!locked ? (
        <div className="edtools">
          <span className="edtool">
            <label htmlFor={`bk-${s.id}`}>Mark up repair costs by</label>
            <input id={`bk-${s.id}`} inputMode="decimal" value={bulk} onChange={(e) => setBulk(e.target.value)} />%
            <button className="btn pri" disabled={!(bulkPct > 0 && bulkPct <= 100) || !canBulk.length} onClick={applyBulk}>
              Apply to {canBulk.length} line{canBulk.length === 1 ? "" : "s"}
            </button>
          </span>
          {anyMarkup ? <button className="btn" onClick={() => setRows(rows.map((r) => ({ ...r, pct: "" })))}>Clear markups</button> : null}
          <button className="btn" onClick={() => setLabor(!labor)}>Our labor</button>
          <button className="btn" onClick={() => setRows([...rows, { label: "", amount: "", side: "out", pct: "", category: "Adjustment" }])}>Add a charge</button>
          <button className="btn" onClick={() => setRows([...rows, { label: "", amount: "", side: "in", pct: "", category: "Adjustment" }])}>Add a credit</button>
        </div>
      ) : null}
      <p className="tsnote edhint">Repair costs are everything but the loan, lot rent and fees; you can set any line&rsquo;s own % in its box below.</p>

      {labor && !locked ? (
        <div className="distcharge edlabor">
          <div className="tsfield"><label htmlFor={`hr-${s.id}`}>Hours</label>
            <input id={`hr-${s.id}`} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="tsfield"><label htmlFor={`rt-${s.id}`}>Rate ($ per hour)</label>
            <input id={`rt-${s.id}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div className="tsfield"><label htmlFor={`lt-${s.id}`}>Home</label>
            <select id={`lt-${s.id}`} value={lot} onChange={(e) => setLot(e.target.value)}>
              <option value="">Not one home</option>
              {homes.map((n) => <option key={n} value={n}>Lot {n}</option>)}
            </select></div>
          <div className="tsfield distwide"><label htmlFor={`wt-${s.id}`}>What it was for</label>
            <input id={`wt-${s.id}`} spellCheck lang="en-US" value={what} onChange={(e) => setWhat(e.target.value)} /></div>
          <div className="tsrow distwide">
            <span className="tsnote distdraft">{laborDraft ? <>Adds <strong>{laborDraft.label}</strong> &nbsp;{money(laborDraft.cents)}</> : "Type the hours and the rate."}</span>
            <button className="tsact" disabled={!laborDraft} onClick={() => {
              if (!laborDraft) return;
              try { localStorage.setItem("dist-labor-rate", rate); } catch { /* fine */ }
              addRow(laborDraft); setLabor(false); setHours(""); setWhat(""); setLot("");
            }}>Add the line</button>
          </div>
        </div>
      ) : null}

      <div className="edtable">
        {section("in")}
        {topups.length ? (
          <div className="edsection">
            <div className="edrow edhead"><span>Rent agreement ({usd(guarCents)} per home)</span><span /><span /><span className="num">Total</span><span /></div>
            {topups.map((l) => (
              <div key={l.label} className="edrow ours"><span className="eddesc"><span className="eddate" /><span>{l.label}</span></span>
                <span /><span /><span className="num edtotal">{money(l.cents)}</span><span /></div>
            ))}
          </div>
        ) : null}
        {section("out")}
        <div className="edtotals">
          <div><span>Monthly net cashflow</span><span>{money(netCents(lines))}</span></div>
          {carried ? <div><span>Carried from last month</span><span>{money(carried)}</span></div> : null}
          <div className="edbig"><span>{owed < 0 ? "Balance" : "Distribution"}</span><span className={owed < 0 ? "distneg" : ""}>{money(owed)}</span></div>
        </div>
      </div>

      <div className="tsfield">
        <label htmlFor={`nt-${s.id}`}>Note on the statement (optional)</label>
        <textarea id={`nt-${s.id}`} rows={2} spellCheck lang="en-US" value={note} disabled={!!s.emailedAt} onChange={(e) => setNote(e.target.value)} />
      </div>

      <details className="eddetails">
        <summary>Owner details: email, copies, bank days, entity</summary>
        <div className="distowned">
          <div className="tsfield">
            <label htmlFor={`em-${s.id}`}>Statement email</label>
            <input id={`em-${s.id}`} type="text" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== s.email && savePayee()} />
          </div>
          <div className="tsfield">
            <label htmlFor={`cc-${s.id}`}>Also copy (their accountant, etc.)</label>
            <input id={`cc-${s.id}`} type="text" inputMode="email" value={cc} placeholder="name@example.com, another@example.com"
              onChange={(e) => setCc(e.target.value)} onBlur={() => cc !== s.cc && savePayee()} />
          </div>
          <div className="tsfield">
            <label htmlFor={`sd-${s.id}`}>Bank days to arrive</label>
            <input id={`sd-${s.id}`} inputMode="numeric" value={settle} onChange={(e) => setSettle(e.target.value)}
              onBlur={() => settle !== String(s.settleDays) && savePayee()} />
          </div>
          <div className="tsfield">
            <label htmlFor={`st-${s.id}`}>Distributions start (blank = already started)</label>
            <input id={`st-${s.id}`} type="month" value={starts} onChange={(e) => setStarts(e.target.value)}
              onBlur={() => (starts || null) !== (s.startsOn ? s.startsOn.slice(0, 7) : null) && savePayee()} />
          </div>
          <div className="tsfield">
            <label htmlFor={`en-${s.id}`}>Owning entity (same entity = one email; blank = sent on its own)</label>
            <input id={`en-${s.id}`} value={entity}
              onChange={(e) => setEntity(e.target.value)} onBlur={() => entity !== s.entity && savePayee()} />
          </div>

        </div>
        {others.length ? <p className="tsnote">Sent in one email with{" "}
          {others.map((o, i) => <span key={o.id}>{i ? ", " : ""}<button className="tslink distinline" onClick={() => onOpen(o.id)}>{placeOf(o.title, o.payee, o.lines)}</button></span>)}.</p> : null}
        <p className="tsnote">
          {s.emailedAt ? `Emailed ${new Date(s.emailedAt).toLocaleDateString()} to ${s.emailedTo}.` : s.emailDetail ? `Not sent: ${s.emailDetail}` : "Not emailed yet."}
          {s.paidCents ? ` ${usd(s.paidCents)} paid.` : ""}{s.hold ? " On hold: not emailed or paid." : ""}
        </p>
      </details>

      {sending ? (
        <div className="edmodalback" onClick={() => !busy && setSending(false)}>
          <div className="edmodal" role="alertdialog" aria-modal="true" aria-label="Email this owner" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const to = [...new Set(sendWith.flatMap((x) => x.email.split(/[,;\s]+/)).filter(Boolean).map((e) => e.toLowerCase()))];
              const copied = [...new Set([...sendWith.flatMap((x) => (x.id === s.id ? cc : x.cc).split(/[,;\s]+/)), ...ccAll.split(/[,;\s]+/)]
                .filter(Boolean).map((e) => e.toLowerCase()))].filter((e) => !to.includes(e));
              const totalPaid = sendWith.reduce((a, x) => a + Math.max(0, x.id === s.id ? owed : x.owedCents), 0);
              if (!sendWith.length) return (<>
                <h3>Nothing to send</h3>
                <p className="tsnote">{s.notStarted && s.startsOn ? `Distributions on this property start ${monthLabel(s.startsOn)}, so there is no statement to send yet.` : s.hold ? "This statement is on hold. Take it off hold to send it." : "Every statement for this owner has already been sent."}</p>
                <div className="tsrow"><button className="btn" onClick={() => setSending(false)}>OK</button></div>
              </>);
              if (!to.length) return (<>
                <h3>No email address</h3>
                <p className="tsnote">There is no email address for {s.sendsAs}. Add one under Owner details, then try again.</p>
                <div className="tsrow"><button className="btn" onClick={() => setSending(false)}>OK</button></div>
              </>);
              if (bad) return (<>
                <h3>Fix the statement first</h3>
                <p className="tsnote">A line needs a description and an amount before this can be sent.</p>
                <div className="tsrow"><button className="btn" onClick={() => setSending(false)}>OK</button></div>
              </>);
              /* Everything this email holds, ticked or not, and anything else the
                 same inbox gets this month -- so an owner with two statements, or two
                 emails, never gets one that nobody has looked at. */
              const allTicked = sendWith.every((x) => ticks.has(x.id));
              const notTicked = sendWith.filter((x) => !ticks.has(x.id));
              const sameInbox = all.filter((x) => !sendWith.some((y) => y.id === x.id) && !x.emailedAt && !x.notStarted && x.lines.length
                && x.email.split(/[,;\s]+/).some((e) => to.includes(e.toLowerCase())));
              const tick = (id: string, on: boolean) => setTicks((t) => { const n = new Set(t); if (on) n.add(id); else n.delete(id); return n; });
              const go = async (anyway: boolean) => {
                if (payeeDirty && !(await savePayee())) { setSending(false); setSentSaid("Not sent: the owner details could not be saved, so nothing was emailed."); return; }
                if (linesDirty) {
                  const okSave = await act({ action: "save", statementId: s.id, ...(locked ? {} : { lines: ownLines }), note, depositsCents: depositCents });
                  if (!okSave) { setSending(false); setSentSaid("Not sent: your changes could not be saved, so nothing was emailed."); return; }
                }
                // Saving took this statement's check off; the tick in this dialog puts it back.
                const toCheck = sendWith.filter((x) => ticks.has(x.id) && (!x.checkedAt || dirty)).map((x) => x.id);
                if (toCheck.length && !(await act({ action: "check", statementIds: toCheck, checked: true }))) {
                  setSending(false); setSentSaid("Not sent: the checks could not be saved, so nothing was emailed."); return;
                }
                const j = await act({ action: "send", statementIds: sendWith.map((x) => x.id), sendUnchecked: anyway }) as { sent?: { payee: string; ok: boolean; detail: string }[] } | null;
                setSending(false);
                setSentSaid(j?.sent ? j.sent.map((x) => x.ok ? `Sent to ${to.join(", ")}.` : `Not sent: ${x.detail}`).join(" ") : "Not sent.");
              };
              return (<>
                <h3>Send this email now?</h3>
                <dl className="edmodaldl">
                  <dt>To</dt><dd>{to.join(", ")}</dd>
                  {copied.length ? <><dt>Copy</dt><dd>{copied.join(", ")}</dd></> : null}
                  <dt>Owner</dt><dd>{s.sendsAs}</dd>
                  <dt>Distribution</dt><dd>{usd(totalPaid)}</dd>
                </dl>
                <fieldset className="edchecks">
                  <legend>{sendWith.length > 1 ? `All ${sendWith.length} statements in this email` : "The statement in this email"}: tick each one you have checked</legend>
                  {sendWith.map((x) => (
                    <label key={x.id} className={`edcheckrow${ticks.has(x.id) ? "" : " todo"}`}>
                      <input type="checkbox" checked={ticks.has(x.id)} onChange={(e) => tick(x.id, e.target.checked)} />
                      <span>{placeOf(x.title, x.payee, x.lines)}{x.id === s.id ? <small> · this one</small> : null}
                        {x.checkedAt && !(x.id === s.id && dirty) ? <small> · checked{x.checkedBy ? ` by ${x.checkedBy}` : ""}</small>
                          : ticks.has(x.id) ? <small> · ticked now</small>
                          : x.id === s.id && dirty ? <small> · changed since it was checked</small> : <small> · not checked yet</small>}</span>
                      <span className="num">{usd(Math.max(0, x.id === s.id ? owed : x.owedCents))}</span>
                      {x.id !== s.id ? <button className="tslink distinline" onClick={() => { setSending(false); onOpen(x.id); }}>Open</button> : <span />}
                    </label>
                  ))}
                </fieldset>
                {sameInbox.length ? (
                  <p className="tsalert edsameinbox">
                    {to.length > 1 ? "These addresses" : "This address"} also get{to.length > 1 ? "" : "s"} {sameInbox.length === 1 ? "another email" : `${sameInbox.length} other statements`} this month, sent separately:{" "}
                    {sameInbox.map((x, i) => <span key={x.id}>{i ? "; " : ""}<button className="tslink distinline" onClick={() => { setSending(false); onOpen(x.id); }}>
                      {x.sendsAs} · {placeOf(x.title, x.payee, x.lines)}</button>{x.checkedAt ? " (checked)" : " (not checked)"}</span>)}.
                  </p>
                ) : null}
                {!allTicked ? <p className="tsalert">{notTicked.length === sendWith.length && sendWith.length === 1 ? "This statement has not been checked." : `${notTicked.length} of ${sendWith.length} statements in this email ${notTicked.length === 1 ? "has" : "have"} not been checked: ${notTicked.map((x) => placeOf(x.title, x.payee, x.lines)).join(", ")}.`}</p> : null}
                <p className="tsnote">Only this owner{copied.length ? " and the copies above are" : " is"} emailed; you get a copy. Once sent, {sendWith.length > 1 ? "these statements are" : "this statement is"} locked as the record.
                  {dirty ? " Your unsaved changes are saved first." : ""}</p>
                <div className="tsrow">
                  {allTicked
                    ? <button className="btn pri" disabled={busy} onClick={() => go(false)}>{busy ? "Sending…" : dirty ? "Save and send" : "Yes, send it"}</button>
                    : <button className="btn danger" disabled={busy} onClick={() => go(true)}>{busy ? "Sending…" : "Send anyway, unchecked"}</button>}
                  <button className="btn" disabled={busy} onClick={() => setSending(false)}>Cancel</button>
                </div>
              </>);
            })()}
          </div>
        </div>
      ) : null}

      <footer className="edfoot">
        {sentSaid ? <span className={`tsnote edsentsaid${/^Sent/.test(sentSaid) ? " ok" : " distneg"}`} role="status">{sentSaid}</span>
          : bad ? <span className="tsnote distneg">A line needs a description and an amount like 1,250.00; a markup is 0 to 100.</span>
          : dirty ? <span className="tsnote">Changes not saved yet. Save them first, then Mark checked when it is final.{s.checkedAt ? " Saving takes the current check off." : ""}</span>
          : s.emailedAt ? <span className="tsnote">All saved.</span>
          : s.checkedAt ? <span className="tsnote">All saved. Checked{s.checkedBy ? ` by ${s.checkedBy}` : ""} {new Date(s.checkedAt).toLocaleDateString()}.</span>
          : <span className="tsnote">All saved. Not checked yet.</span>}
        {!s.emailedAt ? (
          <>
            <button className="btn" disabled={!dirty || busy} onClick={() => {
              setRows(toRows(own(s.lines))); setNote(s.note); setDeposit(s.depositsCents === null ? "" : centsText(s.depositsCents));
              setResHeld(s.reserveHeldCents === null ? "" : centsText(s.reserveHeldCents)); setResNeed(s.reserveRequiredCents === null ? "" : centsText(s.reserveRequiredCents));
              setEmail(s.email); setCc(s.cc); setSettle(String(s.settleDays)); setEntity(s.entity);
              setStarts(s.startsOn ? s.startsOn.slice(0, 7) : ""); setGuar(s.guaranteedCents ? centsText(s.guaranteedCents) : "");
            }}>Discard</button>
            <button className="btn pri" disabled={(linesDirty && bad) || !dirty}
              onClick={() => { if (payeeDirty) savePayee(); if (linesDirty) act({ action: "save", statementId: s.id, ...(locked ? {} : { lines: ownLines }), note, depositsCents: depositCents }, `${s.payee} saved.`); }}>
              Save changes
            </button>
          </>
        ) : null}
        <button className="btn" onClick={onPreview} disabled={dirty}>Preview email</button>
        {!s.emailedAt ? (
          /* Checking is its own press, separate from saving: a statement is saved
             many times while it is being worked on and checked once, when it is
             final. With unsaved changes it waits for a Save, and the line beside
             the buttons says so. */
          <button className={`btn${s.checkedAt && !dirty ? " edchecked" : ""}`} disabled={busy || dirty}
            onClick={() => act({ action: "check", statementId: s.id, checked: !s.checkedAt })}>
            {s.checkedAt && !dirty ? "✓ Checked" : "Mark checked"}
          </button>
        ) : null}
        {!s.emailedAt ? (
          <button className="btn pri" disabled={busy} onClick={() => {
            setSentSaid(null);
            setTicks(new Set(sendWith.filter((x) => x.checkedAt && !(x.id === s.id && dirty)).map((x) => x.id)));
            setSending(true);
          }}>Email this owner&hellip;</button>
        ) : null}
        {!s.emailedAt ? (
          <button className="btn" disabled={busy} onClick={() => act({ action: "save", statementId: s.id, hold: !s.hold })}>
            {s.hold ? "Take off hold" : "Hold this month"}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
