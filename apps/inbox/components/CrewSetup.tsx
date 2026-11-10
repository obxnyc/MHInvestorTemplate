"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Crews, rates, how each man is paid, and when the clock texts go.
 *
 * Nothing here moves until the server has said it took it.
 */

type Person = {
  id: string; name: string; role: string; field: boolean;
  leadId: string | null; onClock: boolean; allReports: boolean;
  rateCents: number | null; method: string | null; handle: string | null;
  phone: string | null; textsTo: string | null; lang: "en" | "es";
};
type Settings = {
  enabled: boolean; tz: string; overtime: boolean; days: number[];
  optionalDays: number[]; autoOut: string | null;
  at: Record<string, string | null>;
};
type Sent = {
  key: string; kind: string; staff_id: string | null; to_phone: string; body: string;
  sid: string | null; error: string | null; created_at: string;
};

const SLOTS: { key: string; said: string; who: string }[] = [
  { key: "crew_morning", said: "Clock-in reminder", who: "to anyone in the programme not yet clocked in" },
  { key: "lead_morning", said: "Morning report", who: "who is clocked in, and at which site" },
  { key: "crew_lunch", said: "Back-from-lunch reminder", who: "to anyone on a break or clocked out after the morning" },
  { key: "lead_lunch", said: "After-lunch report", who: "who has not clocked back in" },
  { key: "crew_evening", said: "End-of-day hours check", who: "each man's hours today, with a link to fix them" },
  { key: "lead_recap", said: "Daily recap", who: "everybody's day, hours and sites" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const METHODS: [string, string][] = [
  ["", "Not set"], ["zelle", "Zelle"], ["cashapp", "Cash App"], ["venmo", "Venmo"],
  ["cash", "Cash"], ["check", "Check"], ["other", "Other"],
];
const HANDLE_HINT: Record<string, string> = {
  zelle: "Phone or email they use for Zelle", cashapp: "$cashtag", venmo: "@username",
};
const pretty = (e164: string | null) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 ?? "";
};

function PersonCard({ p, everyone, onSaved }: {
  p: Person; everyone: Person[]; onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState({
    leadId: p.leadId ?? "", onClock: p.onClock, allReports: p.allReports,
    rate: p.rateCents === null ? "" : (p.rateCents / 100).toFixed(2),
    method: p.method ?? "", handle: p.handle ?? "", phone: p.phone ? pretty(p.phone) : "",
    lang: p.lang,
  });
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});
  const set = (k: keyof typeof f, v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); setState({}); };

  const save = async () => {
    setState({ busy: true });
    const res = await fetch("/api/crew", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ staffId: p.id, ...f }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    if (!res?.ok) { setState({ error: out.error ?? "That did not save." }); return; }
    setState({ saved: true });
    await onSaved();
  };

  const id = (k: string) => `${k}-${p.id}`;
  return (
    <li className="tscard crewcard">
      <div className="tscardhead">
        <span className="tsspan">{p.name}</span>
        <span className="tsbadge">{p.role}</span>
      </div>
      <label className="crewtick">
        <input type="checkbox" checked={f.onClock} onChange={(e) => set("onClock", e.target.checked)} />
        <span>On the crew clock: gets reminder texts and is in the reports</span>
      </label>
      <label className="crewtick">
        <input type="checkbox" checked={f.allReports} onChange={(e) => set("allReports", e.target.checked)} />
        <span>Gets the reports for every crew (office)</span>
      </label>
      <div className="crewgrid">
        <div className="tsfield">
          <label htmlFor={id("lead")}>Crew lead</label>
          <select id={id("lead")} value={f.leadId} onChange={(e) => set("leadId", e.target.value)}>
            <option value="">No crew</option>
            {everyone.filter((o) => o.id !== p.id).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="tsfield">
          <label htmlFor={id("phone")}>Mobile for texts</label>
          <input id={id("phone")} type="tel" inputMode="tel" value={f.phone}
                 placeholder={p.textsTo && !p.phone ? pretty(p.textsTo) : "(910) 555-0100"}
                 onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="tsfield">
          <label htmlFor={id("lang")}>Texts in</label>
          <select id={id("lang")} value={f.lang} onChange={(e) => set("lang", e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
        <div className="tsfield">
          <label htmlFor={id("rate")}>Hourly rate ($)</label>
          <input id={id("rate")} inputMode="decimal" value={f.rate} placeholder="18.00"
                 onChange={(e) => set("rate", e.target.value)} />
        </div>
        <div className="tsfield">
          <label htmlFor={id("method")}>Paid by</label>
          <select id={id("method")} value={f.method} onChange={(e) => set("method", e.target.value)}>
            {METHODS.map(([v, s]) => <option key={v} value={v}>{s}</option>)}
          </select>
        </div>
        {HANDLE_HINT[f.method] ? (
          <div className="tsfield crewwide">
            <label htmlFor={id("handle")}>{HANDLE_HINT[f.method]}</label>
            <input id={id("handle")} value={f.handle} onChange={(e) => set("handle", e.target.value)} />
          </div>
        ) : null}
      </div>
      {!p.textsTo && !f.phone ? (
        <p className="tsnote">No mobile number on file, so no texts can reach {p.name.split(" ")[0]}.</p>
      ) : null}
      {state.error ? <p className="tsalert" role="alert">{state.error}</p> : null}
      <button className="tsminor" disabled={state.busy} onClick={save}>
        {state.busy ? "Saving…" : state.saved ? "Saved" : "Save"}
      </button>
    </li>
  );
}

export default function CrewSetup() {
  const [data, setData] = useState<{
    people: Person[]; settings: Settings; texts: Sent[]; migrationMissing: boolean;
  } | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/crew").catch(() => null);
    const out = await res?.json().catch(() => null);
    if (!res?.ok || !out) { setMsg({ error: out?.error ?? "Could not load the crews." }); return; }
    setData(out);
    setS((cur) => cur ?? out.settings);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    if (!s) return;
    setBusy(true); setMsg({});
    const res = await fetch("/api/crew", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: {
        enabled: s.enabled, overtime: s.overtime, days: s.days, at: s.at,
        optionalDays: s.optionalDays, autoOut: s.autoOut,
      } }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res?.ok) { setMsg({ error: out.error ?? "That did not save." }); return; }
    setMsg({ ok: "Saved." });
    await load();
  };

  if (!data || !s) {
    return <main className="wrap crewwrap">{msg.error
      ? <p className="tsalert" role="alert">{msg.error}</p>
      : <p className="tsloading">Loading&hellip;</p>}</main>;
  }

  const names = Object.fromEntries(data.people.map((p) => [p.id, p.name]));
  const leads = [...new Set(data.people.map((p) => p.leadId).filter(Boolean))] as string[];
  // Field staff first, then the office: the people whose crew is being set
  // up are the ones looked for.
  const order = [...data.people].sort((a, b) =>
    Number(b.field) - Number(a.field) || a.name.localeCompare(b.name));

  return (
    <main className="wrap crewwrap">
      <div className="tshead">
        <h1>Crews &amp; Texts</h1>
        <span className="tsrow">
          <a className="tslink" href="/timesheets">Timesheets</a>
          <a className="tslink" href="/pay">Friday pay</a>
        </span>
      </div>

      {data.migrationMissing ? (
        <p className="tsalert">Migration 051 has not been run, so nothing here can be saved yet.</p>
      ) : null}

      <p className="leadsay">
        {leads.length
          ? leads.map((l) => `${names[l] ?? "?"}: ${data.people.filter((p) => p.leadId === l).length}`).join(" · ")
          : "No crews yet. Pick a crew lead for each man below."}
      </p>

      {/* ---------------------------------------------------------- times */}
      <section className="tscard">
        <div className="tscardhead">
          <h2>Clock Texts</h2>
          <label className="crewtick">
            <input type="checkbox" checked={s.enabled}
                   onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            <span>On</span>
          </label>
        </div>
        <p className="tsnote">
          Times are {s.tz.replace("America/New_York", "Eastern").replace("_", " ")}. Clear a time to
          stop that text. Crew reminders only go to people ticked &ldquo;on the crew clock&rdquo;;
          reports go to each crew lead about their own crew, and to anyone ticked for every crew.
        </p>
        <ul className="crewslots">
          {SLOTS.map((slot) => (
            <li key={slot.key}>
              <div>
                <span className="tsspan">{slot.said}</span>
                <span className="tsnote">{slot.who}</span>
              </div>
              <input type="time" aria-label={slot.said} value={s.at[slot.key] ?? ""}
                     onChange={(e) => setS({ ...s, at: { ...s.at, [slot.key]: e.target.value || null } })} />
            </li>
          ))}
        </ul>
        {/* One choice per day. "Some weeks" is Jose's Saturday: nobody is told
            to come in, and only the men who do are texted or reported on. */}
        <ul className="crewslots" aria-label="Which days are worked">
          {DAYS.map((d, i) => {
            const mode = !s.days.includes(i) ? "off" : s.optionalDays.includes(i) ? "some" : "every";
            return (
              <li key={d}>
                <span className="tsspan">{d}</span>
                <select aria-label={`${d}: worked`} value={mode}
                        onChange={(e) => {
                          const v = e.target.value;
                          const days = s.days.filter((x) => x !== i);
                          const opt = s.optionalDays.filter((x) => x !== i);
                          setS({ ...s,
                            days: v === "off" ? days : [...days, i],
                            optionalDays: v === "some" ? [...opt, i] : opt });
                        }}>
                  <option value="every">Every week</option>
                  <option value="some">Some weeks — only who clocks in</option>
                  <option value="off">Not worked — no texts</option>
                </select>
              </li>
            );
          })}
        </ul>
        <ul className="crewslots">
          <li>
            <div>
              <span className="tsspan">Clock out anyone who forgot at</span>
              <span className="tsnote">
                Closed at this time, or later if the phone shows they were still working.
                They get a text with the link to fix it, and it is flagged on Friday pay.
                Clear it to switch this off.
              </span>
            </div>
            <input type="time" aria-label="Automatic clock-out time" value={s.autoOut ?? ""}
                   onChange={(e) => setS({ ...s, autoOut: e.target.value || null })} />
          </li>
        </ul>
        <label className="crewtick">
          <input type="checkbox" checked={s.overtime}
                 onChange={(e) => setS({ ...s, overtime: e.target.checked })} />
          <span>Pay time and a half past 40 hours a week</span>
        </label>
        {msg.error ? <p className="tsalert" role="alert">{msg.error}</p> : null}
        {msg.ok ? <p className="tsdone" role="status">{msg.ok}</p> : null}
        <button className="tsact" disabled={busy} onClick={saveSettings}>
          {busy ? "Saving…" : "Save times"}
        </button>
      </section>

      {/* --------------------------------------------------------- people */}
      <ul className="crewpeople">
        {order.map((p) => (
          <PersonCard key={`${p.id}:${p.leadId}:${p.onClock}:${p.rateCents}:${p.method}:${p.lang}`}
                      p={p} everyone={data.people} onSaved={load} />
        ))}
      </ul>
      <p className="tsnote">Somebody missing? Add them as Crew first, then set them up here.</p>
      <a className="tslink" href="/people">Add people &rarr;</a>

      {/* ------------------------------------------------------ the ledger */}
      <section className="tscard">
        <div className="tscardhead"><h2>Texts Sent</h2></div>
        {data.texts.length ? (
          <ul className="tsruns">
            {data.texts.map((t) => (
              <li key={t.key} className="crewsent">
                <span className="tsspan">{names[t.staff_id ?? ""] ?? pretty(t.to_phone)}</span>
                <span className={`tsbadge ${t.sid ? "approved" : "asked"}`}>
                  {t.sid ? "sent" : t.error ? "failed" : "sending"}
                </span>
                <span className="tsplace">
                  {new Date(t.created_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="crewbody">{t.body}</span>
              </li>
            ))}
          </ul>
        ) : <p className="tsnote">Nothing sent yet.</p>}
      </section>
    </main>
  );
}
