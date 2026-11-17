"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BLAST_TEMPLATES, BROKER_STAGES, EVERYONE, blastFooter, gmailComposeUrl, hasBrackets, personalize, pickAudience,
  type Audience, type Broker,
} from "@/lib/brokers";

/**
 * One message to many brokers: "anything on your radar?", the buy box, "we
 * just closed another".
 *
 * Who it reaches is said in full before anything goes: how many, and how
 * many the filter left out for having no email or for having asked not to be
 * written to. A test goes to you first. And the send is two presses, the
 * second naming the number, because a blast cannot be called back.
 */

type Past = { id: string; subject: string; via: string; recipients: number; sent: number; failed: number; created_at: string };
type Gmail = { blastId: string; batches: string[][]; subject: string; body: string; done: boolean[] };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const t = await r.text();
  try { return { ok: r.ok, j: JSON.parse(t) as Record<string, unknown> }; }
  catch { return { ok: false, j: { error: `The server answered ${r.status} and not with data.` } as Record<string, unknown> }; }
}

export default function BrokerBlast({ brokers, onClose, onSent }: {
  brokers: Broker[]; onClose: () => void; onSent: () => void;
}) {
  const [aud, setAud] = useState<Audience>(EVERYONE);
  const [tpl, setTpl] = useState(BLAST_TEMPLATES[0].key);
  const [subject, setSubject] = useState(BLAST_TEMPLATES[0].subject);
  const [body, setBody] = useState(BLAST_TEMPLATES[0].body);
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [appCanSend, setAppCanSend] = useState(false);
  const [past, setPast] = useState<Past[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [arm, setArm] = useState<null | "send" | "gmail">(null);
  const [gmail, setGmail] = useState<Gmail | null>(null);

  useEffect(() => {
    (async () => {
      const { ok, j } = await call("/api/brokers/blast", "GET");
      if (!ok) { setErr(String(j.error)); return; }
      setPast(j.blasts as Past[]); setSignature((j.signature as string) ?? null);
      setAddress((j.mailing_address as string) ?? ""); setAppCanSend(Boolean(j.appCanSend));
    })().catch((e) => setErr(String(e)));
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const pick = useMemo(() => pickAudience(brokers, aud), [brokers, aud]);
  const states = useMemo(() => [...new Set(brokers.map((b) => b.state).filter(Boolean) as string[])].sort(), [brokers]);
  const sample = pick.to[0] ?? null;
  const preview = `${personalize(body, sample)}\n\n${blastFooter(signature, address)}`;
  const brackets = hasBrackets(subject + body);
  const blocked = brackets || !subject.trim() || !body.trim() || !pick.to.length;
  useEffect(() => { setArm(null); }, [aud, subject, body]);

  const payload = { subject, body, audience: aud, mailing_address: address };

  async function go(action: "test" | "send" | "gmail") {
    setBusy(action); setErr(null); setNote(null);
    const { ok, j } = await call("/api/brokers/blast", "POST", { ...payload, action });
    setBusy(null); setArm(null);
    if (!ok) { setErr(String(j.error)); return; }
    if (action === "test") { setNote(`Test sent to ${j.to}. Check that inbox before sending to everyone.`); return; }
    if (action === "gmail") {
      const batches = j.batches as string[][];
      setGmail({ blastId: String(j.blastId), batches, subject: String(j.subject), body: String(j.body), done: batches.map(() => false) });
      return;
    }
    setNote(`Sent to ${j.sent}.${Number(j.failed) ? ` ${j.failed} failed: ${j.firstFail}` : ""}`);
    onSent();
  }

  async function batchSent(i: number) {
    if (!gmail) return;
    setBusy(`b${i}`); setErr(null);
    const { ok, j } = await call("/api/brokers/blast", "POST", { action: "gmail-sent", blastId: gmail.blastId, batch: i });
    setBusy(null);
    if (!ok) { setErr(String(j.error)); return; }
    setGmail({ ...gmail, done: gmail.done.map((d, k) => (k === i ? true : d)) });
    onSent();
  }

  const toggleStage = (k: string) => setAud((a) => ({ ...a, stages: a.stages.includes(k) ? a.stages.filter((x) => x !== k) : [...a.stages, k] }));

  return (
    <div className="bk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bk-modal wide bl-modal" role="dialog" aria-label="Blast to brokers">
        <div className="pk-panelhead"><div><h2>Blast to brokers</h2><p className="pk-o2">One message to everyone you pick. Each email starts with their own first name.</p></div>
          <button className="pk-x" onClick={onClose} aria-label="Close">×</button></div>

        {gmail ? (
          <div className="pk-panelbody">
            <p className="bk-ok">Ready: {gmail.batches.reduce((n, b) => n + b.length, 0)} brokers in {gmail.batches.length} Gmail {gmail.batches.length === 1 ? "email" : "emails"}, everyone in BCC so nobody sees the list.</p>
            <ol className="bl-batches">
              {gmail.batches.map((b, i) => (
                <li key={i} className={gmail.done[i] ? "done" : ""}>
                  <span><b>Batch {i + 1}</b> · {b.length} brokers</span>
                  <a className="pk-primary" href={gmailComposeUrl("cade@larabeehomesllc.com", gmail.subject, gmail.body, b)} target="_blank" rel="noreferrer">Open in Gmail</a>
                  <button className="pk-export" disabled={gmail.done[i] || busy === `b${i}`} onClick={() => batchSent(i)}>
                    {gmail.done[i] ? "Sent ✓" : busy === `b${i}` ? "Logging…" : "I sent it"}
                  </button>
                </li>
              ))}
            </ol>
            <p className="pk-faint">It opens addressed to you with the brokers in BCC. Press Send in Gmail, then &ldquo;I sent it&rdquo; here so each broker&rsquo;s history shows it.</p>
            {err ? <p className="pk-err">{err}</p> : null}
            <button className="pk-ghostbtn" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="pk-panelbody">
            <section><h3>Who</h3>
              <div className="bl-aud">
                <div className="pk-seg" role="group" aria-label="Kind">
                  {(["all", "commercial", "residential"] as const).map((k) => (
                    <button key={k} className={aud.kind === k ? "on" : ""} onClick={() => setAud({ ...aud, kind: k })}>
                      {k === "all" ? "Everyone" : k === "commercial" ? "Brokers" : "Realtors"}
                    </button>
                  ))}
                </div>
                <select id="bl-state" className="pk-select" value={aud.state} onChange={(e) => setAud({ ...aud, state: e.target.value })} aria-label="State">
                  <option value="">Every state</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className={`pk-chip${aud.starredOnly ? " on" : ""}`} onClick={() => setAud({ ...aud, starredOnly: !aud.starredOnly })}>★ Starred only</button>
              </div>
              <div className="pk-stagepick bl-stages">
                {BROKER_STAGES.map(([k, l]) => (
                  <button key={k} className={aud.stages.includes(k) ? "on bl-on" : ""} onClick={() => toggleStage(k)}>{l}</button>
                ))}
              </div>
              <p className="bl-count">
                <b>{pick.to.length}</b> {pick.to.length === 1 ? "broker" : "brokers"} will get it
                {aud.stages.length ? "" : " (every stage but Cold)"}.
                {pick.noEmail ? ` ${pick.noEmail} left out with no email.` : ""}
                {pick.optedOut ? ` ${pick.optedOut} left out who asked not to be written to.` : ""}
              </p>
            </section>

            <section><h3>Message</h3>
              <div className="bl-tpls">
                {BLAST_TEMPLATES.map((t) => (
                  <button key={t.key} className={`pk-chip${tpl === t.key ? " on" : ""}`} onClick={() => { setTpl(t.key); setSubject(t.subject); setBody(t.body); }}>{t.label}</button>
                ))}
              </div>
              <input id="bl-subject" className="pk-search bl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
              <textarea id="bl-body" className="bk-text" rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="pk-faint">{"{first}"} becomes each broker&rsquo;s first name.</p>
            </section>

            <section><h3>Your business mailing address</h3>
              <input id="bl-address" className="pk-search" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town, state, zip" />
              <p className="pk-faint">Printed at the bottom with a line saying how to get off the list. Bulk email has to carry both.</p>
            </section>

            <section><h3>What {sample ? sample.name.split(/\s+/)[0] : "they"} will see</h3>
              <pre className="bl-preview"><b>{subject}</b>{"\n\n"}{preview}</pre>
            </section>

            {brackets ? <p className="pk-err">There are still [square brackets] in the message. Fill them in first.</p> : null}
            {!address.trim() ? <p className="pk-err">Add your mailing address before sending to everyone.</p> : null}
            {err ? <p className="pk-err" role="alert">{err}</p> : null}
            {note ? <p className="bk-ok">{note}</p> : null}

            <div className="bl-actions">
              <button className="pk-export" disabled={blocked || !!busy} onClick={() => go("test")}>{busy === "test" ? "Sending…" : "Send me a test"}</button>
              <span className="bl-sp" />
              {arm === "gmail" ? (
                <button className="pk-primary bl-armed" disabled={!!busy} onClick={() => go("gmail")}>{busy === "gmail" ? "Preparing…" : `Yes, prepare for ${pick.to.length}`}</button>
              ) : (
                <button className="pk-export" disabled={blocked || !address.trim() || !!busy} onClick={() => setArm("gmail")}>Send through Gmail</button>
              )}
              {arm === "send" ? (
                <button className="pk-primary bl-armed" disabled={!!busy} onClick={() => go("send")}>{busy === "send" ? "Sending…" : `Yes, send to ${pick.to.length} now`}</button>
              ) : (
                <button className="pk-primary" disabled={blocked || !address.trim() || !appCanSend || !!busy}
                  title={appCanSend ? "" : "Email is not set up on this deployment"} onClick={() => setArm("send")}>Send from the app</button>
              )}
            </div>
            <p className="pk-faint">
              Send from the app: one personal email each, from cade@larabeehomesllc.com, with replies to you. Until Postmark approves the account it only delivers inside larabeehomesllc.com, and anything else comes back failed and says so.
              Send through Gmail works today: batches of 50 in BCC, sent by you.
            </p>

            {past.length ? (
              <section><h3>Earlier blasts</h3>
                <ul className="bl-past">
                  {past.map((p) => (
                    <li key={p.id}><b>{p.subject}</b>
                      <span className="pk-faint">{new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {p.via === "gmail" ? "Gmail" : "app"} · {p.sent} of {p.recipients} sent{p.failed ? ` · ${p.failed} failed` : ""}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
