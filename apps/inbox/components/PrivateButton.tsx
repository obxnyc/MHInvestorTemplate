"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";

type Person = { id: string; name: string; always: boolean };

/**
 * Who can see this conversation.
 *
 * Shared by default. Made private, only the people ticked can see it --
 * the list, the thread, its calls and its notifications -- and the owner,
 * always. The button says the state it is in, not the action it takes.
 */
export default function PrivateButton(
  { conversationId, category }: { conversationId: string; category?: string | null },
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/conversations/${conversationId}/private`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!live || !ok) return;
        setPeople(j.people ?? []); setMe(j.me ?? null);
        setChosen(j.privateTo ?? []); setSaved(j.privateTo ?? []);
      }).catch(() => null);
    return () => { live = false; };
  }, [conversationId]);

  const isPrivate = saved.length > 0;
  // A repair is everybody's business: maintenance stays shared (073). The
  // database refuses it whatever this says; this says so before anybody asks.
  const repair = category === "maintenance";
  const names = people.filter((p) => saved.includes(p.id)).map((p) => p.name);

  async function save(list: string[]) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/private`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ people: list }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    // Nothing on screen changes until the server says it took it.
    if (!res?.ok) { setError(out.error ?? "That didn't save."); return; }
    setSaved(out.privateTo ?? []); setChosen(out.privateTo ?? []); setOpen(false);
    threadChanged(); router.refresh();
  }

  return (
    <span className="privwrap">
      <button type="button" className={isPrivate ? "btn priv on" : "btn priv"}
              aria-expanded={open}
              title={repair ? "Maintenance stays shared so everyone can see the repair."
                : isPrivate ? `Private to ${names.join(", ")}` : "Everyone in the office can see this"}
              onClick={() => {
                setOpen((v) => !v);
                // Opening it on a shared conversation starts with yourself ticked.
                if (!isPrivate && me) setChosen([me]);
              }}>
        {isPrivate ? "Private" : "Shared"}
      </button>
      {open && repair && (
        <div className="privpanel" role="dialog" aria-label="Who can see this conversation">
          <p className="privhead">Everyone can see this one</p>
          <p className="muted">
            Maintenance stays shared so everybody can see the repair. Private is
            for side conversations — change the category if this is not a repair.
          </p>
          <div className="acts">
            <button type="button" className="btn" onClick={() => setOpen(false)}>OK</button>
          </div>
        </div>
      )}
      {open && !repair && (
        <div className="privpanel" role="dialog" aria-label="Who can see this conversation">
          <p className="privhead">Who can see this conversation</p>
          <ul>
            {people.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" className="perm-tick"
                         checked={p.always || chosen.includes(p.id)}
                         disabled={p.always || p.id === me || busy}
                         onChange={() => setChosen((was) => (was.includes(p.id)
                           ? was.filter((x) => x !== p.id) : [...was, p.id]))} />
                  {" "}{p.name}{p.id === me ? " (you)" : ""}
                  {p.always && <span className="dim"> — always</span>}
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="err">{error}</p>}
          <div className="acts">
            {isPrivate && (
              <button type="button" className="btn" disabled={busy} onClick={() => save([])}>
                Make it shared again
              </button>
            )}
            <button type="button" className="btn pri" disabled={busy || !chosen.length}
                    onClick={() => save(chosen)}>
              {isPrivate ? "Save" : "Make private"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
