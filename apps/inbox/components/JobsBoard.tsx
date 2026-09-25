"use client";
import { useEffect, useMemo, useState } from "react";
import { benchmark, money, parseMoney, type PricePoint } from "@/lib/prices";
import { dueState, dueLabel } from "@/lib/dispatch";
import BackLink from "@/components/BackLink";

type Job = {
  id: string; summary: string; status: string; dueAt: string | null;
  completedAt: string | null; costCents: number | null; invoiceRef: string | null;
  tradeId: string | null; conversationId: string | null;
  where: string | null; marketId: string | null; who: string | null;
};
type Trade = { id: string; label: string };

/**
 * Every job, and what it cost.
 *
 * The reason this screen exists is not accounting. It is that somebody in the
 * office with no feel for what a water heater swap costs gets handed a $680
 * invoice and has no way to know whether that is normal. Next to every price
 * box is what the same kind of work has cost before -- so the judgement call
 * becomes a lookup, and nobody has to already know.
 */
export default function JobsBoard() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [trade, setTrade] = useState("");
  const [show, setShow] = useState<"open" | "done">("open");

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then((d) => {
      setJobs(d.jobs ?? []); setTrades(d.trades ?? []);
    });
  }, []);

  // The comparison set is every priced job of the same trade, whatever its
  // status — the history is the point, and it lives in the closed ones.
  const history = useMemo(() => {
    const by = new Map<string, PricePoint[]>();
    for (const j of jobs ?? []) {
      if (!j.costCents || !j.tradeId) continue;
      const list = by.get(j.tradeId) ?? [];
      list.push({
        cents: j.costCents,
        on: j.completedAt ? j.completedAt.slice(0, 10) : null,
        what: j.summary,
        who: j.who,
      });
      by.set(j.tradeId, list);
    }
    return by;
  }, [jobs]);

  const shown = (jobs ?? []).filter((j) =>
    (show === "done" ? j.status === "done" : j.status !== "done")
    && (!trade || j.tradeId === trade));

  if (!jobs) return <main className="people"><p className="pinmuted pad">Loading…</p></main>;

  return (
    <main className="people">
      <BackLink fallback="/settings" />
      <h1 className="pagetitle">Jobs</h1>
      <p className="muted">
        What is outstanding, what it cost, and what that kind of work usually runs.
      </p>

      <div className="dirbar">
        <div className="tabs">
          <a className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</a>
          <a className={show === "done" ? "on" : ""} onClick={() => setShow("done")}>Finished</a>
        </div>
        <select value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">Every trade</option>
          {trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      <ul className="joblist board">
        {shown.map((j) => (
          <JobRow key={j.id} job={j} trades={trades}
                  history={j.tradeId ? history.get(j.tradeId) ?? [] : []} />
        ))}
        {!shown.length && (
          <li className="none">
            {show === "open" ? "Nothing outstanding." : "No finished jobs yet."}
          </li>
        )}
      </ul>
    </main>
  );
}

function JobRow(
  { job, trades, history }:
  { job: Job; trades: Trade[]; history: PricePoint[] },
) {
  const [cost, setCost] = useState(job.costCents ? String(job.costCents / 100) : "");
  const [ref, setRef] = useState(job.invoiceRef ?? "");
  const [tradeId, setTradeId] = useState(job.tradeId ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [open, setOpen] = useState(false);

  // Saved on leaving a field, not on a button. This gets filled in while
  // holding a stack of invoices, and a Save button at the bottom of a long
  // list is a button nobody presses.
  async function save(patch: Record<string, unknown>) {
    setSaved("saving");
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaved(res.ok ? "saved" : "error");
    if (res.ok) setTimeout(() => setSaved("idle"), 1600);
  }

  const bench = benchmark(history.filter((p) => p.cents !== job.costCents || history.length > 1));
  const state = dueState(job.dueAt);

  return (
    <li className={`job due-${state}`}>
      <div className="jobtop">
        {job.where && <span className="jobwhere">{job.where}</span>}
        {job.status !== "done" && (
          <span className={`duepill due-${state}`}>{dueLabel(job.dueAt)}</span>
        )}
        {job.status === "done" && job.completedAt && (
          <span className="duepill">Done {job.completedAt.slice(0, 10)}</span>
        )}
      </div>
      <p className="jobsum">{job.summary}</p>
      {job.who && <p className="jobdetail">{job.who}</p>}

      <div className="costrow">
        <select value={tradeId}
                onChange={(e) => { setTradeId(e.target.value); save({ tradeId: e.target.value }); }}>
          <option value="">Which trade?</option>
          {trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        <label className="moneybox">
          <span aria-hidden="true">$</span>
          <input inputMode="decimal" value={cost} placeholder="0"
                 onChange={(e) => setCost(e.target.value)}
                 onBlur={() => save({ costCents: parseMoney(cost) })} />
        </label>

        <input className="refbox" value={ref} placeholder="Invoice #"
               onChange={(e) => setRef(e.target.value)}
               onBlur={() => save({ invoiceRef: ref })} />

        <span className={`savetick ${saved}`}>
          {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved"
            : saved === "error" ? "Didn't save" : ""}
        </span>
      </div>

      {bench && (
        <button type="button" className="bench" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}>
          Usually <strong>{money(bench.median)}</strong>
          <span className="benchrange">{money(bench.low)}–{money(bench.high)}</span>
          <span className="benchn">{bench.count} before</span>
          {bench.stale && <span className="benchold">over 2 years old</span>}
        </button>
      )}

      {open && bench && (
        <ul className="benchlist">
          {bench.recent.map((p, i) => (
            <li key={i}>
              <span className="bm">{money(p.cents)}</span>
              <span className="bw">{p.what}</span>
              <span className="bd">{p.who ?? ""} {p.on ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
