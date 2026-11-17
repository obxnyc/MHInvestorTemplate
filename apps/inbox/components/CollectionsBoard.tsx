"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  REMINDERS, REMINDER_LABEL, STAGES, STAGE_LABEL, STAGE_SHORT, STANDING_LABEL, WORRY,
  addDays, daysFrom, dollars, shortDay, stageIndex,
  type Policy, type Reminder, type Stage, type Standing, type Step, type PromiseStatus,
} from "@/lib/collections";

export type Debt = {
  id: number;
  name: string;
  place: string | null;
  phone: string | null;
  contactId: string | null;
  status: string | null;
  balanceCents: number;
  oldest: string | null;
  stage: Stage;
  stageOn: string | null;
  courtOn: string | null;
  caseNumber: string | null;
  paidDuring: Stage | null;
  assignedTo: string | null;
  next: Step | null;
  outBy: string | null;
  standing: Standing;
  why: string;
  paidSinceLate: number;
  promises: {
    id: string; amountCents: number; dueOn: string; madeAt: string; status: PromiseStatus;
    paidCents: number; note: string | null; by: string | null; paidNowCents: number;
  }[];
  heard: string | null;
  worked: string | null;
  suggestion: { cents: number; dueOn: string; from: string; messageId: string; conversationId: string; at: string } | null;
};

export type Pull = { at: string; ok: boolean; tenants: number; owing: number; partial: boolean; detail: string | null };

type Settings = { policy: Policy; enabled: string[]; autoSend: boolean; sendHour: number };
type Day = { day: string; cents: number; who: { name: string; cents: number; rmTenantId: number }[] };

type View = "attention" | "all" | "arranged" | "promises" | "court" | "paid";

const VIEWS: { key: View; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "all", label: "Everyone behind" },
  { key: "arranged", label: "Arranged" },
  { key: "promises", label: "Promises" },
  { key: "court", label: "In court" },
  { key: "paid", label: "Paid lately" },
];

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

const whenDue = (today: string, due: string) => {
  const n = daysFrom(today, due);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n < 0) return `${-n} days ago`;
  return n < 7 ? shortDay(due).split(",")[0] : shortDay(due);
};

const needsAttention = (d: Debt, today: string) =>
  (d.next && d.next.due <= today) || WORRY.includes(d.standing) || d.paidDuring !== null
  || Boolean(d.suggestion) || d.promises.some((p) => p.status === "open" && p.dueOn <= today);

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/collections", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => null);
  const text = await res?.text().catch(() => "") ?? "";
  let out: Record<string, unknown> = {};
  try { out = text ? JSON.parse(text) : {}; } catch { out = { error: res ? `The server answered ${res.status}.` : "Could not reach the server." }; }
  if (!res || !res.ok) throw new Error(String(out.error ?? "That did not save. Try again."));
  return out;
}

export default function CollectionsBoard(props: {
  today: string;
  debts: Debt[];
  staff: { id: string; name: string }[];
  pull: Pull | null;
  canEdit: boolean;
  isAdmin: boolean;
  settings: Settings | null;
  paidLately: { name: string; at: string; body: string }[];
  expectedDays: Day[];
  stages?: string[];
  missing?: string;
  meId?: string;
}) {
  const { today, debts, staff, pull, canEdit, isAdmin, settings, paidLately, expectedDays, missing } = props;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [view, setView] = useState<View>("attention");
  const [open, setOpen] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const me = props.meId ?? null;

  useEffect(() => {
    try { const v = localStorage.getItem("rc:view"); if (v && VIEWS.some((x) => x.key === v)) setView(v as View); } catch {}
    // Opened from a link that names somebody: #t123
    const m = /^#t(\d+)$/.exec(location.hash);
    if (m) { setOpen(Number(m[1])); setView("all"); }
  }, []);
  useEffect(() => { try { localStorage.setItem("rc:view", view); } catch {} }, [view]);

  const owing = debts.filter((d) => d.balanceCents >= 100);
  const totals = useMemo(() => {
    const owed = owing.reduce((s, d) => s + d.balanceCents, 0);
    const overdue = debts.filter((d) => d.next && d.next.overdue > 0).length;
    const worry = owing.filter((d) => WORRY.includes(d.standing)).length;
    const arranged = owing.filter((d) => d.standing === "arranged").length;
    const week = expectedDays.slice(0, 7).reduce((s, d) => s + d.cents, 0);
    return { owed, overdue, worry, arranged, week };
  }, [debts, owing, expectedDays]);

  const shown = useMemo(() => {
    let list = debts;
    if (view === "attention") list = debts.filter((d) => needsAttention(d, today));
    if (view === "all") list = owing;
    if (view === "arranged") list = owing.filter((d) => d.standing === "arranged");
    if (view === "promises") list = debts.filter((d) => d.promises.some((p) => p.status === "open" || (p.status !== "cancelled" && daysFrom(p.dueOn, today) <= 7)));
    if (view === "court") list = debts.filter((d) => stageIndex(d.stage) >= stageIndex("filed") && d.stage !== "out");
    if (view === "paid") list = debts.filter((d) => d.paidDuring !== null || d.balanceCents < 100);
    if (mine && me) list = list.filter((d) => d.assignedTo === me);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((d) => `${d.name} ${d.place ?? ""} ${d.phone ?? ""}`.toLowerCase().includes(s));
    const rank = (d: Debt) =>
      (d.next && d.next.overdue > 0 ? 0 : 10) + (WORRY.includes(d.standing) ? 0 : 3) + (d.suggestion ? 0 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || b.balanceCents - a.balanceCents);
  }, [debts, owing, view, today, mine, me, q]);

  const count = (v: View) => {
    if (v === "attention") return debts.filter((d) => needsAttention(d, today)).length;
    if (v === "all") return owing.length;
    if (v === "arranged") return totals.arranged;
    if (v === "promises") return debts.filter((d) => d.promises.some((p) => p.status === "open")).length;
    if (v === "court") return debts.filter((d) => stageIndex(d.stage) >= stageIndex("filed") && d.stage !== "out").length;
    return debts.filter((d) => d.paidDuring !== null || d.balanceCents < 100).length;
  };

  const act = async (body: Record<string, unknown>) => {
    setProblem(null);
    try {
      const out = await post(body);
      start(() => router.refresh());
      return out;
    } catch (e) {
      setProblem((e as Error).message);
      return null;
    }
  };

  const refresh = async () => {
    setRefreshing(true); setProblem(null); setRefreshed(null);
    try {
      const r = await post({ action: "refresh" });
      setRefreshed(`Read ${r.tenants} tenants from Rent Manager: ${r.owing} owing${r.partial ? " (stopped before the end — press again)" : ""}.`);
      start(() => router.refresh());
    } catch (e) { setProblem((e as Error).message); }
    setRefreshing(false);
  };

  if (missing) {
    return (
      <main className="wrap rc">
        <h1>Rent collections</h1>
        <p className="rcnone">
          This screen needs migration 069 in the database. It has not been applied yet, so there is nothing to show
          — not because nobody owes. ({missing})
        </p>
      </main>
    );
  }

  const maxDay = Math.max(1, ...expectedDays.map((d) => d.cents));

  return (
    <main className="wrap rc">
      <div className="rctop">
        <div>
          <h1>Rent collections</h1>
          <p className="rcsay">
            Due on the {settings ? ord(settings.policy.dueDay) : "1st"}, late after the {settings ? ord(settings.policy.lateAfterDay) : "5th"}.
            {" "}Late notice and 10-day demand on the {settings ? ord(settings.policy.lateAfterDay + 1) : "6th"}; eviction filed when the ten days run out.
            {" "}A promise does not stop the process — it tells us who to worry about.
          </p>
        </div>
        <div className="rcpull">
          <span className={pull && !pull.ok ? "rcbadread" : ""}>
            {pull
              ? pull.ok
                ? `Balances from Rent Manager ${ago(pull.at)}${pull.partial ? " (partial read)" : ""}`
                : `Last read of Rent Manager failed ${ago(pull.at)}: ${pull.detail ?? ""}`
              : "Rent Manager has not been read yet."}
          </span>
          {canEdit ? (
            <button className="btn" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Reading Rent Manager…" : "Read balances now"}
            </button>
          ) : null}
        </div>
      </div>
      {refreshed ? <p className="rcok">{refreshed}</p> : null}
      {problem ? <p className="rcbad" role="alert">{problem}</p> : null}

      <dl className="rctiles">
        <div><dt>Owed</dt><dd>{dollars(totals.owed)}</dd><span>{owing.length} behind</span></div>
        <div><dt>Expected this week</dt><dd>{dollars(totals.week)}</dd><span>from open promises</span></div>
        <div className={totals.overdue ? "rchot" : ""}><dt>Steps overdue</dt><dd>{totals.overdue}</dd><span>not taken by their day</span></div>
        <div className={totals.worry ? "rchot" : ""}><dt>Worry</dt><dd>{totals.worry}</dd><span>silent or broke a promise</span></div>
        <div><dt>Arranged</dt><dd>{totals.arranged}</dd><span>should pay before it plays out</span></div>
      </dl>

      <section className="rcexpect" aria-label="Money expected by day">
        <h2>When the money is expected</h2>
        <ol>
          {expectedDays.map((d) => (
            <li key={d.day} className={d.day === today ? "rctoday" : ""}
                title={d.who.map((w) => `${w.name} ${dollars(w.cents)}`).join("\n") || "Nothing promised"}>
              <span className="rcbar"><i style={{ height: `${d.cents ? Math.max(8, Math.round((d.cents / maxDay) * 100)) : 0}%` }} /></span>
              <b>{d.cents ? `$${Math.round(d.cents / 100).toLocaleString()}` : "·"}</b>
              <span className="rcd">{d.day === today ? "Today" : shortDay(d.day).replace(/,? \w+ /, " ")}</span>
            </li>
          ))}
        </ol>
        {expectedDays.some((d) => d.who.length) ? (
          <ul className="rcwho">
            {expectedDays.filter((d) => d.who.length).slice(0, 6).map((d) => (
              <li key={d.day}><b>{whenDue(today, d.day)}</b>{" "}
                {d.who.map((w, i) => (
                  <span key={w.rmTenantId}>{i ? ", " : ""}
                    <button className="rclink" onClick={() => { setView("all"); setOpen(w.rmTenantId); }}>{w.name}</button>
                    {" "}{dollars(w.cents)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : <p className="rcquiet">No promises in the next two weeks yet. Log one from a tenant&apos;s row when they say a day.</p>}
      </section>

      {canEdit ? <Reminders today={today} settings={settings} onSent={() => start(() => router.refresh())} /> : null}

      <div className="rcbar2">
        <div className="rcviews" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key}
                    className={`rcview${view === v.key ? " on" : ""}`} onClick={() => setView(v.key)}>
              {v.label} <span>{count(v.key)}</span>
            </button>
          ))}
        </div>
        <div className="rcfind">
          <input id="rc-search" type="search" placeholder="Find a tenant or lot" value={q} onChange={(e) => setQ(e.target.value)} />
          {me ? (
            <label className="rctick"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
          ) : null}
        </div>
      </div>

      {view === "paid" && paidLately.length ? (
        <ul className="rcpaid">
          {paidLately.map((p, i) => <li key={i}><b>{p.name}</b> · {ago(p.at)} · {p.body}</li>)}
        </ul>
      ) : null}

      {shown.length ? (
        <ul className="rclist">
          {shown.map((d) => (
            <DebtRow key={d.id} d={d} today={today} staff={staff} canEdit={canEdit} busy={busy}
                     open={open === d.id} onOpen={() => setOpen(open === d.id ? null : d.id)} act={act} />
          ))}
        </ul>
      ) : (
        <p className="rcnone">
          {view === "attention" ? "Nothing needs attention: every step is on time and everybody behind is talking or arranged."
            : view === "all" ? (pull ? "Nobody owes anything." : "Rent Manager has not been read yet. Press “Read balances now”.")
            : "Nobody here."}
        </p>
      )}

      {isAdmin && settings ? <PolicyPanel settings={settings} act={act} /> : null}
    </main>
  );
}

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* ------------------------------------------------------------------ one tenant */

function DebtRow({ d, today, staff, canEdit, busy, open, onOpen, act }: {
  d: Debt; today: string; staff: { id: string; name: string }[]; canEdit: boolean; busy: boolean;
  open: boolean; onOpen: () => void; act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const openPromise = d.promises.find((p) => p.status === "open");
  const lastPromise = d.promises.find((p) => p.status !== "cancelled");
  const daysLate = d.oldest ? Math.max(0, daysFrom(d.oldest, today)) : null;
  const who = staff.find((s) => s.id === d.assignedTo)?.name ?? null;
  return (
    <li className={`rcrow rc-${d.standing}${open ? " rcopen" : ""}`} id={`t${d.id}`}>
      <button className="rchead" onClick={onOpen} aria-expanded={open}>
        <span className="rcname">
          <b>{d.name}</b>
          <span>{d.place ?? "Lot not known"}{who ? ` · ${who}` : ""}</span>
        </span>
        <span className="rcmoney">
          <b>{dollars(d.balanceCents)}</b>
          <span>{daysLate !== null && d.balanceCents >= 100 ? `${daysLate} days` : d.balanceCents < 100 ? "paid" : ""}</span>
        </span>
      </button>

      <Ladder stage={d.stage} />

      <div className="rcfacts">
        {d.paidDuring ? (
          <p className="rcstep rclate">
            Paid in full while “{STAGE_LABEL[d.paidDuring]}”.{d.paidDuring !== "late" ? " If the case was filed, dismiss it." : ""}
            {canEdit ? <button className="btn mini" disabled={busy} onClick={() => act({ action: "dismissed", id: d.id })}>Done</button> : null}
          </p>
        ) : d.next ? (
          <p className={`rcstep${d.next.overdue ? " rclate" : d.next.due === today ? " rcnow" : ""}`}>
            <span>Next: <b>{d.next.label}</b> {d.next.overdue ? <em>{d.next.overdue} day{d.next.overdue === 1 ? "" : "s"} overdue</em> : <>by {whenDue(today, d.next.due)}</>}</span>
            {canEdit && d.next.to ? <StepDone d={d} to={d.next.to} today={today} busy={busy} act={act} /> : null}
            {canEdit && !d.next.to && d.stage === "filed" ? <CourtDate d={d} busy={busy} act={act} /> : null}
          </p>
        ) : null}
        <p className={`rcstand rcs-${d.standing}`}>
          <b>{STANDING_LABEL[d.standing]}</b> <span>{d.why}</span>
        </p>
        <p className="rcmeta">
          {openPromise ? <span className="rcprom">Promised {dollars(openPromise.amountCents)} by {whenDue(today, openPromise.dueOn)}{openPromise.paidCents ? ` · ${dollars(openPromise.paidCents)} in` : ""}</span>
            : lastPromise && lastPromise.status === "kept" ? <span className="rckept">Kept {dollars(lastPromise.amountCents)} promise</span> : null}
          <span>Heard from {ago(d.heard)}</span>
          <span>Worked {ago(d.worked)}</span>
          {d.outBy && d.stage !== "out" ? <span>Plays out by {shortDay(d.outBy)}</span> : null}
          {d.courtOn ? <span>Court {shortDay(d.courtOn)}{d.caseNumber ? ` · ${d.caseNumber}` : ""}</span> : null}
        </p>
        {d.suggestion && canEdit ? (
          <div className="rcsuggest">
            <span>They wrote {ago(d.suggestion.at)}: <q>{d.suggestion.from}</q></span>
            <button className="btn mini pri" disabled={busy}
                    onClick={() => act({ action: "promise", id: d.id, amount: d.suggestion!.cents / 100, dueOn: d.suggestion!.dueOn, messageId: d.suggestion!.messageId, note: "From their text." })}>
              Log {dollars(d.suggestion.cents)} by {shortDay(d.suggestion.dueOn)}
            </button>
          </div>
        ) : null}
      </div>

      {open ? <Detail d={d} today={today} staff={staff} canEdit={canEdit} busy={busy} act={act} /> : null}
    </li>
  );
}

function Ladder({ stage }: { stage: Stage }) {
  const steps = STAGES.filter((s) => s !== "current");
  const at = stageIndex(stage);
  return (
    <ol className="rcladder" aria-label={`At: ${STAGE_LABEL[stage]}`}>
      {steps.map((s) => {
        const i = stageIndex(s);
        return <li key={s} className={i < at ? "past" : i === at ? "here" : ""}>{STAGE_SHORT[s]}</li>;
      })}
    </ol>
  );
}

function StepDone({ d, to, today, busy, act }: {
  d: Debt; to: Stage; today: string; busy: boolean;
  act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const [asking, setAsking] = useState(false);
  const [on, setOn] = useState(today);
  const [court, setCourt] = useState("");
  const [caseNo, setCaseNo] = useState("");
  if (!asking) return <button className="btn mini" disabled={busy} onClick={() => setAsking(true)}>Mark done</button>;
  return (
    <span className="rcask">
      <label>Done on <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} /></label>
      {to === "filed" ? (
        <>
          <label>Court date <input type="date" value={court} onChange={(e) => setCourt(e.target.value)} /></label>
          <label>Case # <input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="26-CVM-…" /></label>
        </>
      ) : null}
      <button className="btn mini pri" disabled={busy || !on}
              onClick={async () => { if (await act({ action: "stage", id: d.id, to, on, courtOn: court, caseNumber: caseNo })) setAsking(false); }}>
        {STAGE_SHORT[to]} — save
      </button>
      <button className="btn mini" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

function CourtDate({ d, busy, act }: { d: Debt; busy: boolean; act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null> }) {
  const [court, setCourt] = useState(d.courtOn ?? "");
  const [caseNo, setCaseNo] = useState(d.caseNumber ?? "");
  return (
    <span className="rcask">
      <label>Court date <input type="date" value={court} onChange={(e) => setCourt(e.target.value)} /></label>
      <label>Case # <input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} /></label>
      <button className="btn mini pri" disabled={busy || !court} onClick={() => act({ action: "court", id: d.id, courtOn: court, caseNumber: caseNo })}>Save</button>
    </span>
  );
}

/* ------------------------------------------------------------------ the story */

type Item = { at: string; kind: string; body: string; who: string | null; link?: string | null };

const KIND_LABEL: Record<string, string> = {
  note: "Note", stage: "Step", promise: "Promise", payment: "Payment", text: "Text", system: "",
  heard: "They wrote", sent: "We texted", call: "Call", missed: "Missed call",
};

function Detail({ d, today, staff, canEdit, busy, act }: {
  d: Debt; today: string; staff: { id: string; name: string }[]; canEdit: boolean; busy: boolean;
  act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<"note" | "promise" | "text">("note");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(addDays(today, 3));
  const [paidNow, setPaidNow] = useState("");
  const [pnote, setPnote] = useState("");
  const [text, setText] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState<Stage>(d.stage);
  const [moveWhy, setMoveWhy] = useState("");
  const [moveOn, setMoveOn] = useState(today);

  const load = async () => {
    setFailed(null);
    const res = await fetch(`/api/collections?id=${d.id}`).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (!res?.ok || !out) { setFailed(out?.error ?? "Could not read their history."); return; }
    setItems(out.items as Item[]);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [d.id, d.promises.length, d.stage]);

  const after = async (body: Record<string, unknown>, clear: () => void) => {
    // Nothing is cleared until the server says it took it.
    if (await act(body)) { clear(); load(); }
  };

  const willPlayOut = d.outBy;
  const lateDue = willPlayOut && due > willPlayOut;

  return (
    <div className="rcdetail">
      {canEdit ? (
        <div className="rcwrite">
          <div className="rctabs" role="tablist">
            {(["note", "promise", "text"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "note" ? "Add a note" : t === "promise" ? "They promised to pay" : "Text them"}
              </button>
            ))}
          </div>
          {tab === "note" ? (
            <div className="rcform">
              <textarea id={`rc-note-${d.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="What they said, what you did. Everyone sees this — nobody has to pass it on." />
              <button className="btn pri" disabled={busy || !note.trim()}
                      onClick={() => after({ action: "note", id: d.id, body: note }, () => setNote(""))}>Save note</button>
            </div>
          ) : tab === "promise" ? (
            <div className="rcform rcgrid">
              <label>Amount <input id={`rc-amt-${d.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(d.balanceCents / 100).toFixed(2)} /></label>
              <label>By <input id={`rc-due-${d.id}`} type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} /></label>
              <label>Paid today <input id={`rc-now-${d.id}`} inputMode="decimal" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} placeholder="0.00" /></label>
              <label className="rcwide">Note <input id={`rc-pn-${d.id}`} value={pnote} onChange={(e) => setPnote(e.target.value)} placeholder="Paycheck Friday, bringing cash to the office…" /></label>
              {lateDue ? <p className="rcwarn rcwide">That is after {shortDay(willPlayOut!)}, when the eviction would play out. It will not count as arranged unless they have paid a significant part.</p> : null}
              <p className="rcquiet rcwide">The filing still goes ahead on its day. This only changes whether we expect the money.</p>
              <button className="btn pri" disabled={busy || !amount || !due}
                      onClick={() => after({ action: "promise", id: d.id, amount, dueOn: due, paidNow, note: pnote },
                        () => { setAmount(""); setPaidNow(""); setPnote(""); })}>Log promise</button>
            </div>
          ) : (
            <div className="rcform">
              {d.phone ? (
                <>
                  <textarea id={`rc-text-${d.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)}
                            placeholder={`Text ${d.name.split(" ")[0]} from the office line`} />
                  <div className="rcquick">
                    {[
                      `Hi ${d.name.split(" ")[0]}, this is Larabee Homes. Your balance is ${dollars(d.balanceCents)}. Please call or reply to let us know when you can pay.`,
                      `Hi ${d.name.split(" ")[0]}, thank you for your payment. Your balance is now ${dollars(d.balanceCents)}.`,
                    ].map((s) => <button key={s} className="btn mini" onClick={() => setText(s)}>{s.slice(s.indexOf(".") + 2, s.indexOf(".") + 40)}…</button>)}
                  </div>
                  <button className="btn pri" disabled={busy || !text.trim()}
                          onClick={() => after({ action: "text", id: d.id, body: text }, () => setText(""))}>Send from office line</button>
                  <p className="rcquiet">It goes into their conversation in Messages, so their reply lands there too.</p>
                </>
              ) : <p className="rcquiet">No mobile number on file the office line can text.</p>}
            </div>
          )}
        </div>
      ) : null}

      <div className="rcside">
        {canEdit ? (
          <>
            <label className="rcassign">Who is working this
              <select id={`rc-who-${d.id}`} value={d.assignedTo ?? ""} onChange={(e) => act({ action: "assign", id: d.id, staffId: e.target.value })}>
                <option value="">Nobody yet</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {!moving ? (
              <button className="btn mini" onClick={() => setMoving(true)}>Change step…</button>
            ) : (
              <div className="rcask rcmove">
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value as Stage)}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <input type="date" value={moveOn} max={today} onChange={(e) => setMoveOn(e.target.value)} />
                <input value={moveWhy} onChange={(e) => setMoveWhy(e.target.value)} placeholder="Why (on the record)" />
                <button className="btn mini pri" disabled={busy || moveTo === d.stage || (stageIndex(moveTo) < stageIndex(d.stage) && !moveWhy.trim())}
                        onClick={() => after({ action: "stage", id: d.id, to: moveTo, on: moveOn, why: moveWhy }, () => { setMoving(false); setMoveWhy(""); })}>Save</button>
                <button className="btn mini" onClick={() => setMoving(false)}>Cancel</button>
                {stageIndex(moveTo) < stageIndex(d.stage) ? <span className="rcquiet">Moving back a step needs a reason.</span> : null}
              </div>
            )}
          </>
        ) : null}
        {d.contactId ? <Link className="rclink" href={`/c/by-contact/${d.contactId}`}>Open their messages</Link> : null}
        {d.phone ? <span className="rcquiet">{d.phone}</span> : null}
        {d.promises.length ? (
          <ul className="rcpromises">
            {d.promises.map((p) => (
              <li key={p.id} className={`rcp-${p.status}`}>
                <b>{dollars(p.amountCents)}</b> by {shortDay(p.dueOn)} · <span>{p.status === "open" ? "open" : p.status}</span>
                {p.paidCents ? ` · ${dollars(p.paidCents)} in` : ""}
                {p.by ? <small> — {p.by}, {shortDay(p.madeAt.slice(0, 10))}</small> : null}
                {canEdit && p.status === "open" ? (
                  <button className="rclink" onClick={() => act({ action: "cancel-promise", promiseId: p.id })}>take off</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rcstory">
        <h3>Everything with {d.name.split(" ")[0]}</h3>
        {failed ? <p className="rcbad">{failed}</p> : !items ? <p className="rcquiet">Reading…</p> : !items.length ? (
          <p className="rcquiet">Nothing yet: no notes, texts or calls in the last four months.</p>
        ) : (
          <ol>
            {items.map((i, n) => (
              <li key={n} className={`rck-${i.kind}`}>
                <span className="rcwhen">{shortDay(i.at.slice(0, 10))} · {new Date(i.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                <span className="rcwhat">
                  {KIND_LABEL[i.kind] ? <b>{KIND_LABEL[i.kind]}{i.who ? ` · ${i.who}` : ""}</b> : null}
                  <span>{i.body}</span>
                  {i.link ? <Link className="rclink" href={i.link}>thread</Link> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ reminders */

function Reminders({ today, settings, onSent }: { today: string; settings: Settings | null; onSent: () => void }) {
  const [drafts, setDrafts] = useState<{ key: string; name: string; kind: Reminder; body: string; contactId: string | null }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async () => {
    const r = await fetch("/api/collections?drafts=1").catch(() => null);
    const out = await r?.json().catch(() => null);
    if (out?.drafts) {
      setDrafts(out.drafts);
      setPicked(new Set((out.drafts as { key: string; contactId: string | null }[]).filter((d) => d.contactId).map((d) => d.key)));
    }
  };
  useEffect(() => { load(); }, [today]);

  if (!drafts) return null;
  const auto = settings?.autoSend;
  if (!drafts.length) {
    return (
      <p className="rcrem rcquiet">
        No reminder texts are due today.{auto ? ` Automatic reminders are on and go at ${settings!.sendHour % 12 || 12}${settings!.sendHour < 12 ? "am" : "pm"}.` : ""}
      </p>
    );
  }
  const byKind = new Map<Reminder, number>();
  for (const d of drafts) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);

  return (
    <section className="rcrem">
      <div className="rcremhead">
        <p>
          <b>{drafts.length} reminder text{drafts.length === 1 ? "" : "s"} due today</b>{" "}
          <span>{[...byKind].map(([k, n]) => `${n} ${REMINDER_LABEL[k].toLowerCase()}`).join(" · ")}</span>
          {auto ? <span> · they go by themselves at {settings!.sendHour % 12 || 12}{settings!.sendHour < 12 ? "am" : "pm"}</span> : null}
        </p>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? "Hide" : "Review and send"}</button>
      </div>
      {said ? <p className="rcok">{said}</p> : null}
      {problem ? <p className="rcbad">{problem}</p> : null}
      {open ? (
        <>
          <ul className="rcdrafts">
            {drafts.map((d) => (
              <li key={d.key}>
                <label>
                  <input type="checkbox" disabled={!d.contactId} checked={picked.has(d.key)}
                         onChange={(e) => {
                           const s = new Set(picked);
                           if (e.target.checked) s.add(d.key); else s.delete(d.key);
                           setPicked(s);
                         }} />
                  <span><b>{d.name}</b> <small>{REMINDER_LABEL[d.kind]}</small><br />{d.body}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn pri" disabled={sending || !picked.size} onClick={async () => {
            setSending(true); setProblem(null); setSaid(null);
            try {
              const r = await post({ action: "send-reminders", keys: [...picked] });
              const failed = (r.failed as { name: string; why: string }[]) ?? [];
              setSaid(`Sent ${r.sent}.${failed.length ? ` Not sent: ${failed.map((f) => `${f.name} (${f.why})`).join(", ")}.` : ""}${r.skipped ? ` ${r.skipped} had already gone.` : ""}`);
              await load(); onSent();
            } catch (e) { setProblem((e as Error).message); }
            setSending(false);
          }}>{sending ? "Sending…" : `Send ${picked.size} from the office line`}</button>
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ policy */

const POLICY_FIELDS: { key: keyof Policy; label: string; unit: string }[] = [
  { key: "dueDay", label: "Rent due on day", unit: "of the month" },
  { key: "lateAfterDay", label: "Late after day", unit: "of the month" },
  { key: "demandDays", label: "Demand gives", unit: "days to pay" },
  { key: "courtDaysEst", label: "Filing to court, about", unit: "days" },
  { key: "appealDays", label: "Appeal period", unit: "days" },
  { key: "writDaysEst", label: "Writ to lock-out, about", unit: "days" },
  { key: "significantPct", label: "Significant payment", unit: "% of what was owed" },
  { key: "quietDays", label: "Silent after", unit: "days without hearing" },
];

function PolicyPanel({ settings, act }: { settings: Settings; act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null> }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Record<string, string>>(
    Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, String(settings.policy[f.key])])));
  const [enabled, setEnabled] = useState(new Set(settings.enabled));
  const [auto, setAuto] = useState(settings.autoSend);
  const [hour, setHour] = useState(String(settings.sendHour));
  const [saved, setSaved] = useState(false);
  return (
    <section className="rcpolicy">
      <button className="btn" onClick={() => setOpen(!open)}>{open ? "Hide the policy" : "The policy and the reminders"}</button>
      {open ? (
        <div className="rcpolgrid">
          {POLICY_FIELDS.map((f) => (
            <label key={f.key}>{f.label}
              <span><input id={`rc-pol-${f.key}`} inputMode="numeric" value={p[f.key]} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} /> {f.unit}</span>
            </label>
          ))}
          <fieldset className="rcwide">
            <legend>Reminder texts</legend>
            {REMINDERS.map((k) => (
              <label key={k} className="rctick">
                <input type="checkbox" checked={enabled.has(k)} onChange={(e) => {
                  const s = new Set(enabled); if (e.target.checked) s.add(k); else s.delete(k); setEnabled(s);
                }} /> {REMINDER_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <label className="rctick rcwide">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Send them automatically at{" "}
            <select value={hour} onChange={(e) => setHour(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{h % 12 || 12}{h < 12 ? "am" : "pm"}</option>)}
            </select>
            {" "}— off means they wait on this screen for somebody to press Send
          </label>
          <button className="btn pri" onClick={async () => {
            setSaved(false);
            if (await act({ action: "settings", policy: p, enabled: [...enabled], autoSend: auto, sendHour: Number(hour) })) setSaved(true);
          }}>Save the policy</button>
          {saved ? <span className="rcok">Saved.</span> : null}
        </div>
      ) : null}
    </section>
  );
}
