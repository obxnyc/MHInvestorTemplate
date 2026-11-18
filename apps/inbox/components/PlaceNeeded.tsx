"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";

type Suggestion = {
  id: string; kind: string; label: string; where: string;
  propertyId: string; unitId: string | null;
  /** How many lots are inside, when picking it opens rather than files. */
  opens?: number;
};
/** The kinds of place actually on the books, counted. The way in for
 *  somebody who would rather point than type. */
type KindCount = { kind: string; label: string; properties: number };
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
  { conversationId, hint, contact, onChanged }: {
    conversationId: string;
    /** What the request called the place, where it said anything at all.
     *  A Rent Manager issue says nothing, and that is the case this card
     *  exists for most. */
    hint: string | null;
    contact: { id: string; name: string | null; phone: string | null;
               email: string | null; party?: string | null } | null;
    onChanged?: () => void;
  },
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
  /** Typed into the box when there was no hint to match on. */
  const [look, setLook] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [kinds, setKinds] = useState<KindCount[]>([]);
  /** Which kind is being looked through, and which park is open inside it.
   *  Empty means the top, where nothing is listed at all. */
  const [group, setGroup] = useState("");
  const [within, setWithin] = useState({ id: "", name: "" });

  useEffect(() => {
    let alive = true;
    /* With no words to go on there is nothing to suggest, so the card
       goes straight to the list of properties rather than pretending to
       have matched something. */
    fetch(`/api/places/claim?hint=${encodeURIComponent(hint ?? "")}`
          + `&q=${encodeURIComponent(look)}`
          + `&group=${encodeURIComponent(look ? "" : group)}`
          + `&property=${encodeURIComponent(look ? "" : within.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setSuggestions(d.suggestions ?? []);
        setKinds(d.kinds ?? []);
        setSaid(d.said ?? null);
        setBrowsing(Boolean(d.browsing));
        /* The boxes start filled in from what the request itself said. The
           whole point is that the information already arrived; retyping it is
           the step worth removing. */
        setName(d.said?.property ?? hint ?? "");
        setAddress(d.said?.address ?? "");
        setLot(d.said?.lot ?? "");
        setKind(d.said?.lot ? "mhp" : "sfh");
      })
      .catch(() => { if (alive) setSuggestions([]); });
    return () => { alive = false; };
  }, [hint, look, group, within.id]);

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
        {hint ? (
          <>This came in for <b>{hint}</b>. That is what Rent Manager calls
            it, and no property here matches.</>
        ) : (
          <>This request did not say which property it is for — Rent Manager
            does not pass one on.</>
        )}{" "}
        Until it is matched, the work order has no address and nobody can be
        sent to it.
      </p>

      {/* WHO IT IS, on the same card and for the same reason. A request
          with no property almost always has no contact either -- the
          phone column holds a key rather than a number -- so filing it
          and then having no way to tell the tenant anything is half an
          answer. */}
      {contact && <PersonHere contact={contact} onSaved={onChanged} />}

      {/* WITH NOTHING TO MATCH ON, every property is offered and the box
          narrows it. Offering only "add this property" to a house that is
          already on the books is how a second copy of it gets made. */}
      {browsing && (
        <label className="unplaced-find">Which property is it?
          {/* Focused, because typing is what most people will do and the
              list below is the fallback, not the other way round. */}
          <input value={look} onChange={(e) => setLook(e.target.value)} autoFocus
                 placeholder="Street, park name, or lot number" />
        </label>
      )}

      {/* WHERE YOU ARE, when you have gone into a kind or a park. Browsing
          four hundred places only works if you can get back out. */}
      {browsing && !look && (group || within.id) && (
        <p className="unplaced-why">
          <button type="button" className="btn" disabled={busy}
                  onClick={() => (within.id
                    ? setWithin({ id: "", name: "" })
                    : setGroup(""))}>
            ← Back
          </button>
          {within.name ? <> · {within.name}</> : null}
        </p>
      )}

      {/* THE WAY IN FOR SOMEBODY WHO WOULD RATHER POINT THAN TYPE.
          Only at the top, and only until something is typed -- typing is
          the path most people take and it searches everything at once. */}
      {browsing && !look && !group && !within.id && kinds.length > 0 && (
        <div className="unplaced-picks">
          {kinds.map((k) => (
            <button key={k.kind} type="button" className="unplaced-pick"
                    disabled={busy} onClick={() => setGroup(k.kind)}>
              <b>{k.label}</b>
              <span>{k.properties} {k.properties === 1 ? "place" : "places"}</span>
            </button>
          ))}
        </div>
      )}

      {suggestions === null ? (
        <p className="unplaced-why">Looking for a match…</p>
      ) : suggestions.length ? (
        <>
          <p className="unplaced-why">
            {browsing
              ? (look ? "Matching these:" : within.id ? "Which lot?" : "Which one?")
              : "Is it one of these?"}
          </p>
          <div className="unplaced-picks">
            {suggestions.map((s) => (
              <button key={s.id} className="unplaced-pick" disabled={busy}
                      onClick={() => {
                        /* A park opens; everything else files. A property
                           with lots inside has no single answer, and filing
                           against the park would put a work order on the
                           common ground rather than on somebody's home. */
                        if (s.opens) {
                          setWithin({ id: s.propertyId, name: s.label });
                          return;
                        }
                        claim(s.unitId ? { unitId: s.unitId } : { propertyId: s.propertyId });
                      }}>
                <b>{s.label}</b>
                {s.opens
                  ? <span>{s.opens} lots →</span>
                  : s.where ? <span>{s.where}</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : browsing && !look && !group && !within.id ? null : (
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

/**
 * The tenant, and a way to reach them.
 *
 * A Rent Manager request arrives with the phone column holding
 * `email:rm:issue:307` -- a key, not a number -- so the office can read
 * what is wrong with the fridge and has no way to answer. Typing the
 * number in is the whole of the fix, and there was nowhere to type it.
 */
function PersonHere(
  { contact, onSaved }: {
    contact: { id: string; name: string | null; phone: string | null;
               email: string | null; party?: string | null };
    onSaved?: () => void;
  },
) {
  const real = (contact.phone ?? "").startsWith("+");
  const router = useRouter();
  const [open, setOpen] = useState(!real && !contact.email);
  const [name, setName] = useState(contact.name ?? "");
  /* WHO THEY ARE, which this never asked.
     "When trying to save this number it doesn't allow me to save him as
     anything other than a tenant." The card is written for a tenant
     throughout -- "The tenant's name" -- and the save sent no `party` at
     all, so a plumber stayed whatever he happened to be created as. The
     route has accepted all six since it was written; nothing offered
     them. */
  const [party, setParty] = useState(contact.party ?? "current_tenant");
  const [phone, setPhone] = useState(real ? contact.phone ?? "" : "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setBusy(true); setProblem(null);
    const body: Record<string, unknown> = {};
    if (name.trim() !== (contact.name ?? "")) body.fullName = name.trim();
    if (phone.trim()) body.phone = phone.trim();
    if (email.trim() !== (contact.email ?? "")) body.email = email.trim();
    if (party !== (contact.party ?? "current_tenant")) body.party = party;
    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res) { setProblem("That did not send. Try again."); return; }
    const out = await res.json().catch(() => ({}));
    /* Nothing is called saved until the server says so: a number refused
       for being somebody else's would otherwise sit on screen looking
       like it had taken. */
    if (!res.ok || !out.ok) { setProblem(out.error ?? "That did not save."); return; }
    setOpen(false);
    onSaved?.();
    /* AND THE LIST, which is a different thing from the thread.
     *
     * "I saved the number but it's not updating in the pane of message
     * conversations." The header said Instinct AI and the row beside it
     * still said (919) 762-2296.
     *
     * `onSaved` reloads the open THREAD. The list is a server component
     * and only re-renders on `router.refresh()`, which `ContactEditor`
     * has always called and this never did -- so the same edit made from
     * two places updated two different halves of the screen.
     *
     * `threadChanged()` as well, because anything else listening for a
     * thread to have moved should hear it from here too. */
    threadChanged();
    router.refresh();
  }

  if (!open) {
    return (
      <p className="unplaced-why">
        <b>{contact.name || "No name on this one"}</b>
        {real && <> · {contact.phone}</>}
        {contact.email && <> · {contact.email}</>}
        {" "}
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Change
        </button>
      </p>
    );
  }

  return (
    <div className="unplaced-add">
      <p className="unplaced-why">
        {real || contact.email
          ? "Who this is, and how to reach them."
          : "Nobody is attached to this request, so there is nowhere to send"
            + " a reply. Put the tenant's number in and you can answer them"
            + " from this thread."}
      </p>
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Their name" />
      </label>
      <label>Mobile
        <input value={phone} inputMode="tel" autoFocus={!real}
               onChange={(e) => setPhone(e.target.value)}
               placeholder="(910) 555-0114" />
      </label>
      <label>What they are
        <select value={party} onChange={(e) => setParty(e.target.value)}>
          <option value="current_tenant">Tenant</option>
          <option value="prospect">Looking to rent</option>
          <option value="vendor">Trade or vendor</option>
          <option value="tech">Our crew</option>
          <option value="owner">Owner</option>
          <option value="other">Someone else</option>
        </select>
      </label>
      <label>Email
        <input value={email} inputMode="email" type="email"
               onChange={(e) => setEmail(e.target.value)}
               placeholder="If you have one" />
      </label>
      {problem && <p className="err">{problem}</p>}
      <div className="unplaced-acts">
        <button type="button" className="btn pri" disabled={busy}
                onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {(real || contact.email) && (
          <button type="button" className="btn" disabled={busy}
                  onClick={() => setOpen(false)}>Never mind</button>
        )}
      </div>
    </div>
  );
}
