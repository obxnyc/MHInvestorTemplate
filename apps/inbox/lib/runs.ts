/**
 * Whether a message continues the one before it.
 *
 * A run of messages from the same person within a few minutes is one
 * utterance said in several breaths. Repeating the name above each and the
 * clock below each turns three words into three paragraphs of furniture --
 * which is most of what reads as clunky in a thread.
 *
 * Five minutes because that is roughly how long somebody stays "still
 * typing" in the mind of whoever is reading. Longer and the gap is a pause
 * worth marking; the clock comes back and so does the name.
 */
const SAME_BREATH_MS = 5 * 60_000;

export function continues(
  prev: { who: string; at: string } | null,
  now: { who: string; at: string },
  newDay: boolean,
): boolean {
  if (!prev || newDay) return false;
  if (prev.who !== now.who) return false;
  const gap = new Date(now.at).getTime() - new Date(prev.at).getTime();
  return Number.isFinite(gap) && gap >= 0 && gap < SAME_BREATH_MS;
}
