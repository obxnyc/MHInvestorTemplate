/**
 * Who rings at each rung, when the earlier people keep ringing.
 *
 * Twilio rings a list of phones for as long as one <Dial> lasts, and the next
 * rung is a new <Dial>. So "Hannah keeps ringing after her twelve seconds"
 * is said by putting Hannah on every rung after hers too: rung two rings
 * Hannah AND Samantha, rung three rings Hannah, Samantha and Cade. Her phone
 * starts a fresh ring at each rung -- a beat of silence, then it rings on --
 * which also means it never rings long enough for her own voicemail to take
 * the call.
 *
 * Nobody is rung twice on one rung, and a rung that adds nobody new is
 * dropped rather than repeating the one before it for no reason.
 */

export type Person = { id: string; name: string; phone: string; staffId: string | null };
export type Stage = { position: number; seconds: number; people: Person[] };

export function keepRinging(stages: Stage[]): Stage[] {
  const out: Stage[] = [];
  const sofar: Person[] = [];
  for (const s of [...stages].sort((a, b) => a.position - b.position)) {
    const fresh = s.people.filter((p) => !sofar.some((q) => q.phone === p.phone));
    if (!fresh.length) continue;
    sofar.push(...fresh);
    out.push({ ...s, people: [...sofar] });
  }
  return out;
}
