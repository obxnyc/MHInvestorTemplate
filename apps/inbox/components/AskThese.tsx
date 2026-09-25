"use client";
import { useEffect, useRef, useState } from "react";
import { promptsFor, type Prompt } from "@/lib/prompts";
import type { Suggestion } from "@/lib/suggest";

/**
 * The questions worth asking on this thread, above the box.
 *
 * Tapping one puts it IN the box rather than sending it. That is the whole
 * design: the office knows things the strip does not -- that this tenant has
 * already said the water is off, that this one is elderly and the question
 * needs softening -- and a button that sends on one tap turns a helpful list
 * into a thing people have to be careful around.
 *
 * Each one ticks off, on the conversation rather than on the person, because
 * two people work a thread and the question was asked of the tenant. A strip
 * that never shortens stops being read within a week.
 */
export default function AskThese(
  { conversationId, category, context, asked, lastInbound, onAsked, onInsert }:
  {
    conversationId: string; category: string; context: string;
    asked: string[];
    /** Whether the last thing said was theirs. Suggestions only make sense
     *  when there is something unanswered. */
    lastInbound: boolean;
    onAsked: (next: string[]) => void;
    onInsert: (text: string) => void;
  },
) {
  const [open, setOpen] = useState(true);
  const [drafts, setDrafts] = useState<Suggestion[] | null>(null);
  const [why, setWhy] = useState<{ why: string; detail?: string }>({ why: "ok" });
  const [thinking, setThinking] = useState(false);
  // Which conversation the drafts belong to, so switching threads never shows
  // the last one's suggestions against this one's tenant.
  const forThread = useRef<string | null>(null);

  useEffect(() => {
    if (forThread.current !== conversationId) {
      forThread.current = conversationId;
      setDrafts(null);
    }
  }, [conversationId]);

  async function draft() {
    setThinking(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/suggest`,
                              { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setWhy({ why: data.configured === false ? "off" : (data.why ?? "failed"),
               detail: data.detail });
      setDrafts(res.ok ? (data.replies ?? []) : []);
    } catch {
      setDrafts([]);
    } finally {
      setThinking(false);
    }
  }

  const sets = promptsFor(category, context);
  if (!sets.length && !lastInbound) return null;

  const done = new Set(asked);

  async function tick(key: string, on: boolean) {
    // Moved first, then saved. The tick is the feedback that the tap landed,
    // and waiting a round trip for it makes the strip feel broken.
    onAsked(on ? [...new Set([...asked, key])] : asked.filter((k) => k !== key));
    await fetch(`/api/conversations/${conversationId}/asked`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, on }),
    }).catch(() => {});
  }

  const total = sets.reduce((n, s) => n + s.prompts.length, 0);
  const left = sets.reduce(
    (n, s) => n + s.prompts.filter((p) => !done.has(p.key)).length, 0);

  return (
    <div className={`askthese${open ? "" : " shut"}`}>
      <button className="askhead" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="asklabel">Worth asking</span>
        <span className="askcount">{left ? `${left} of ${total}` : "all asked"}</span>
        <span className="askgo" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && lastInbound && (
        <div className="askset">
          <span className="asksettitle">
            Answering what they said
            {drafts !== null && (
              <button className="askagain" onClick={draft} disabled={thinking}>
                {thinking ? "…" : "again"}
              </button>
            )}
          </span>

          {/* Asked for, not automatic. This reads the conversation and costs
              money every time; firing it on every thread anybody opens would
              spend most of that on threads nobody was going to reply to. */}
          {drafts === null ? (
            <button className="btn mini" onClick={draft} disabled={thinking}>
              {thinking ? "Reading the conversation…" : "Draft a reply"}
            </button>
          ) : why.why === "off" ? (
            <p className="asknone">
              <code>ANTHROPIC_API_KEY</code> is not in this build. If it is already
              in Vercel, it was added after the last deploy — settings are read at
              build time, so redeploy.
            </p>
          ) : why.why === "failed" ? (
            <p className="asknone bad">
              {why.detail ?? "That didn't work."} Same key as the Spanish
              translation, so that will be off too.
            </p>
          ) : drafts.length === 0 ? (
            <p className="asknone">
              Nothing worth suggesting from what has been said so far.
            </p>
          ) : (
            <div className="askchips">
              {drafts.map((d, i) => (
                <span key={i} className="askchip draft">
                  <button className="askuse" onClick={() => onInsert(d.text)}
                          title="Put this in the box to edit">
                    <span className="drafttag">{d.label}</span>
                    {d.text}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {open && sets.map((set) => {
        const remaining = set.prompts.filter((p) => !done.has(p.key));
        if (!remaining.length) return null;
        return (
          <div key={set.title} className="askset">
            <span className="asksettitle">{set.title}</span>
            <div className="askchips">
              {remaining.map((p) => (
                <Chip key={p.key} p={p}
                      onUse={() => { if (!p.staffOnly) onInsert(p.ask); tick(p.key, true); }}
                      onSkip={() => tick(p.key, true)} />
              ))}
            </div>
          </div>
        );
      })}

      {open && done.size > 0 && (
        <button className="askreset" onClick={() => {
          // Whatever was ticked, untick. A thread that turns into a second
          // problem needs its questions back.
          asked.forEach((k) => tick(k, false));
          onAsked([]);
        }}>
          Bring back {done.size} asked
        </button>
      )}
    </div>
  );
}

function Chip({ p, onUse, onSkip }: { p: Prompt; onUse: () => void; onSkip: () => void }) {
  return (
    <span className={`askchip${p.staffOnly ? " staff" : ""}`}>
      <button className="askuse" onClick={onUse}
              title={p.staffOnly ? "For you, not for them" : "Put this in the box"}>
        {p.staffOnly && <span className="askeye" aria-hidden="true">•</span>}
        {p.ask}
      </button>
      <button className="askskip" onClick={onSkip} aria-label="Already known">
        &times;
      </button>
    </span>
  );
}
