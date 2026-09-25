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
 * @returns Up to three suggestions, or [] when there is nothing worth saying
 *          and when the key is not configured -- the strip simply does not
 *          appear rather than erroring.
 */
export async function suggestReplies(
  thread: { mine: boolean; body: string }[],
  context: { category: string; name: string },
): Promise<Suggestion[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  // The last few turns, not the whole history: what a reply has to answer is
  // near the end, and the rest is cost.
  const recent = thread.slice(-8);
  if (!recent.some((m) => !m.mine)) return [];

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

    if (response.stop_reason === "refusal") return [];
    return (response.parsed_output?.replies ?? [])
      .filter((r) => r.text.trim())
      .slice(0, 3);
  } catch (e) {
    // A suggestion that cannot be made is not an error worth showing anybody.
    console.error("reply suggestions failed", e);
    return [];
  }
}
