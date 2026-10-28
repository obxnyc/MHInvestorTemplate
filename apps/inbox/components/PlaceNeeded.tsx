"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = {
  id: string; kind: string; label: string; where: string;
  propertyId: string; unitId: string | null;
};
type Said = { property: string | null; lot: string | null; address: string | null };

/**
 * "This request is not filed against any property."
 *
 * A Tenant Web Access request arrives knowing the tenant, their number and
 * what Rent Manager calls the place -- and none of that is a property we
 * hold, so it lands filed against nothing and the work order under it says
 * "Address not set", which nobody goes looking for.
 *
 * LOUD ON PURPOSE. This is not a hint in a corner: a maintenance request
 * nobody can locate is a van with nowhere to drive. It is also a job that is
 * done ONCE per address -- the answer is remembered, and every later request
 * from that address files itself -- so the cost of making it unmissable is
 * paid once and the benefit is permanent.
 */
export default function PlaceNeeded(
  { conversationId, hint }: { conversationId: string; hint: string },
) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lot, setLot] = useState("");
  const [kind, setKind] = useState("sfh");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/places/claim?hint=${encodeURIComponent(hint)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setSuggestions(d.suggestions ?? []);
        setSaid(d.said ?? null);
        /* The boxes start filled in from what the request itself said. The
           whole point is that the information already arrived; retyping it is
           the step worth removing. */
        setName(d.said?.property ?? hint);
        setAddress(d.said?.address ?? "");
        setLot(d.said?.lot ?? "");
        setKind(d.said?.lot ? "mhp" : "sfh");
      })
      .catch(() => { if (alive) setSuggestions([]); });
    return () => { alive = false; };
  }, [hint]);

  async function claim(payload: Record<string, unknown>) {
    setBusy(true); setProblem(null);
    const res = await fetch("/api/places/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, ...payload }),
    }).catch(() => null);
    setBusy(false);
    if (!res) { setProblem("That did not send. Check your signal and try again."); return; }
    const out = await res.json().catch(() => ({}));
    /* Nothing is called done until the server says so. */
    if (!res.ok || !out.ok) { setProblem(out.error ?? "That did not work."); return; }
    router.refresh();
  }

  return (
    <section className="unplaced" role="alert">
      <p className="unplaced-head">Not filed against a property</p>
      <p className="unplaced-why">
        This came in for <b>{hint}</b>. That is what Rent Manager calls it, and
        no property here matches. Until it is matched, the work order has no
        address and nobody can be sent to it.
      </p>

      {suggestions === null ? (
        <p className="unplaced-why">Looking for a match…</p>
      ) : suggestions.length ? (
        <>
          <p className="unplaced-why">Is it one of these?</p>
          <div className="unplaced-picks">
            {suggestions.map((s) => (
              <button key={s.id} className="unplaced-pick" disabled={busy}
                      onClick={() => claim(
                        s.unitId ? { unitId: s.unitId } : { propertyId: s.propertyId })}>
                <b>{s.label}</b>
                {s.where ? <span>{s.where}</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="unplaced-why">
          Nothing here looks like it. It needs to be added.
        </p>
      )}

      {adding ? (
        <div className="unplaced-add">
          <label htmlFor="pn">Property name</label>
          <input id="pn" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="pa">Address <span className="dim">— optional</span></label>
          <input id="pa" value={address} onChange={(e) => setAddress(e.target.value)} />
          <label htmlFor="pl">Lot <span className="dim">— leave blank for a single home</span></label>
          <input id="pl" value={lot} onChange={(e) => setLot(e.target.value)} />
          <label htmlFor="pk">What it is</label>
          <select id="pk" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="sfh">Single home</option>
            <option value="mhp">Mobile home park</option>
            <option value="mh">Mobile home</option>
            <option value="multi">Multi-family</option>
            <option value="lot">Lot</option>
          </select>
          <div className="unplaced-acts">
            <button className="btn pri" disabled={busy || name.trim().length < 3}
                    onClick={() => claim({ create: { name, address, kind, lot } })}>
              {busy ? "Adding…" : "Add it and file this here"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn pri" disabled={busy} onClick={() => setAdding(true)}>
          Add this property
        </button>
      )}

      {problem ? <p className="unplaced-bad">{problem}</p> : null}
      <p className="unplaced-why dim">
        Answered once. Every later request from this address files itself.
      </p>
    </section>
  );
}
