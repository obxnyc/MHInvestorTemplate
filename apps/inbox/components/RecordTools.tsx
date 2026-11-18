"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Word = { id: string; phrase: string; active: boolean };

/**
 * The watch-list, and clearing the new-alert highlights.
 *
 * A word or phrase added here is checked against every message from then on,
 * whole words only and case ignored, and a match sends an app notification
 * at once. Nothing on screen changes until the server has said it took it.
 */
export default function RecordTools({ unseen }: { unseen: number[] }) {
  const router = useRouter();
  const [words, setWords] = useState<Word[]>([]);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/watch", { cache: "no-store" }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    if (res?.ok) setWords(out.words ?? []);
    else setError(out.error ?? "Could not read the watch-list.");
  }
  useEffect(() => { void load(); }, []);

  async function act(body: object) {
    setBusy(true); setError(null);
    const res = await fetch("/api/watch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res?.ok) { setError(out.error ?? "That didn't save."); return false; }
    return true;
  }

  return (
    <section className="watchbox">
      <h2>Watched words and phrases</h2>
      <p className="muted">
        Any message that contains one of these -- in or out, a note, or team
        chat -- sends you a notification straight away and is highlighted below.
      </p>
      <form className="watchadd" onSubmit={async (e) => {
        e.preventDefault();
        if (await act({ action: "add", phrase })) { setPhrase(""); await load(); }
      }}>
        <input value={phrase} onChange={(e) => setPhrase(e.target.value)}
               placeholder="e.g. cash only, side job, lawyer" aria-label="Word or phrase to watch" />
        <button className="btn pri" type="submit" disabled={busy || phrase.trim().length < 2}>Watch</button>
      </form>
      {error && <p className="err">{error}</p>}
      <ul className="watchlist">
        {words.map((w) => (
          <li key={w.id}>
            <span>{w.phrase}</span>
            <button type="button" className="mini" disabled={busy}
                    onClick={async () => { if (await act({ action: "remove", id: w.id })) await load(); }}>
              Stop watching
            </button>
          </li>
        ))}
        {!words.length && <li className="dim">Nothing watched yet.</li>}
      </ul>
      {unseen.length > 0 && (
        <button type="button" className="btn" disabled={busy}
                onClick={async () => { if (await act({ action: "seen", ids: unseen })) router.refresh(); }}>
          Mark {unseen.length} new alert{unseen.length === 1 ? "" : "s"} as looked at
        </button>
      )}
    </section>
  );
}
