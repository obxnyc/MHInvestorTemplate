import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

/**
 * Replies worth considering, written from what was actually said.
 *
 * The fixed question lists cover what you ask a tenant about a broken AC. They
 * cannot cover "how do I do that" or "who am I speaking with, by the way" --
 * questions that only make sense against the last three things said. That is
 * what this is for, and it is the only part of this system that needs to read
 * a conversation rather than match a keyword.
 *
 * Nothing here is ever sent. Suggestions land in the box to be edited, exactly
 * like the question chips, because the office knows things the model does not
 * and because a wrong text to a tenant cannot be recalled.
 */

const Replies = z.object({
  replies: z.array(z.object({
    /** What goes in the box. */
    text: z.string(),
    /** Two or three words, so three suggestions can be told apart at a glance. */
    label: z.string(),
  })),
});

export type Suggestion = { text: string; label: string };

/** Why there are no suggestions, which is three different situations that look
 *  identical on screen and are fixed three different ways:
 *    off     - no key. Add one and redeploy.
 *    failed  - a key that the API would not accept, or a call that broke.
 *    ok      - it read the conversation and had nothing useful to add.
 *  Collapsing these into an empty list is what made the last two hours of
 *  this confusing, so they are kept apart. */
export type Why = "ok" | "off" | "failed";
export type Drafted = { replies: Suggestion[]; why: Why; detail?: string };

/** Whether drafting is switched on at all. Kept separate from "it had nothing
 *  to say", because those look identical on screen and are fixed by completely
 *  different things -- one by adding a key, one by waiting for a reply. */
export function draftingConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = [
  "You draft text messages for a small property management office in Elizabeth",
  "City, North Carolina. You are drafting for a member of staff to read, edit",
  "and send. You are not talking to the tenant.",
  "",
  "Write the way somebody in a small office writes: short, plain, warm but not",
  "chatty. One or two sentences. No emoji, no exclamation marks, no corporate",
  "filler, no signing off.",
  "",
  "THE RULE THAT MATTERS MOST: never invent a fact. You do not know when",
  "anybody can come out, what anything costs, who is on call, what the lease",
  "says, or what has been agreed. Where a reply needs a specific the office",
  "must supply, leave a square-bracket blank -- [day], [time], [name] -- for",
  "them to fill in. A plausible invented appointment is worse than a blank,",
  "because a blank gets filled and a date gets believed.",
  "",
  "Never promise a repair by a date. Never quote or estimate a price. Never",
  "accept or deny responsibility for a repair. Never give legal advice or",
  "discuss eviction. Never say anything about somebody's tenancy status.",
  "",
  "If they asked who they are speaking to, the answer is the office by name:",
  "\"This is [name] with Larabee Homes.\"",
  "",
  "Reply in the language the resident is writing in.",
  "",
  "Do not repeat something already said in the thread. Offer at most three,",
  "and offer genuinely different replies -- not one reply worded three ways.",
  "If nothing useful can be said without knowing more, return an empty list;",
  "an empty list is a good answer and better than a filler pleasantry.",
].join("\n");

/**
 * @param thread Oldest to newest. `mine` is anything this office sent.
 * @returns Up to three suggestions, with WHY there are none when there are
 *          none. Never throws: a suggestion that cannot be made must not take
 *          the thread down with it.
 */
export async function suggestReplies(
  thread: { mine: boolean; body: string }[],
  context: { category: string; name: string },
): Promise<Drafted> {
  if (!draftingConfigured()) return { replies: [], why: "off" };
  // The last few turns, not the whole history: what a reply has to answer is
  // near the end, and the rest is cost.
  const recent = thread.slice(-8);
  if (!recent.some((m) => !m.mine)) return { replies: [], why: "ok" };

  const transcript = recent
    .map((m) => `${m.mine ? "Office" : context.name}: ${m.body}`)
    .join("\n");

  try {
    const response = await new Anthropic().messages.parse({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM,
      // Low effort: this is a short drafting task on a path somebody is
      // waiting on, and depth buys nothing. Same setting as the classifier.
      output_config: { format: zodOutputFormat(Replies), effort: "low" },
      messages: [{
        role: "user",
        content: `This conversation is filed as ${context.category.replace("_", " ")}.\n\n`
          + `${transcript}\n\nDraft replies for the office to send next.`,
      }],
    });

    if (response.stop_reason === "refusal") return { replies: [], why: "ok" };
    return {
      replies: (response.parsed_output?.replies ?? [])
        .filter((r) => r.text.trim()).slice(0, 3),
      why: "ok",
    };
  } catch (e) {
    // Reported, not swallowed. A key that is present but rejected produced an
    // empty list indistinguishable from "nothing to say", which sent us
    // looking for a missing key that was already there.
    console.error("reply suggestions failed", e);
    const detail = e instanceof Anthropic.AuthenticationError
      ? "The key was rejected. Check it is the whole key and has not been revoked."
      : e instanceof Anthropic.RateLimitError
        ? "Rate limited, or the account is out of credit."
        : e instanceof Anthropic.APIError
          ? `Anthropic returned ${e.status}.`
          : "The call did not complete.";
    return { replies: [], why: "failed", detail };
  }
}
