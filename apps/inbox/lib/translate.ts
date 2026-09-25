import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

/**
 * Reading and writing to people who do not speak English.
 *
 * The rule the whole thing is built on: the original is never replaced. What a
 * tenant typed is the record; the English is a reading of it. The day a
 * conversation is read back in a dispute, "what they said" and "what we
 * understood them to say" have to be separable, and a system that overwrites
 * one with the other has destroyed the evidence to save a column.
 */

const Detected = z.object({
  /** ISO 639-1. "en" when it already is English. */
  language: z.string(),
  /** Left empty when the message is already English -- translating English to
   *  English is a round trip for a copy. */
  english: z.string(),
});

const SYSTEM = `You translate text messages between a property manager in North \
Carolina and their tenants and contractors.

- Identify the language of the message.
- If it is not English, translate it to plain, natural English.
- Translate what was written, including rudeness, threats and profanity. Do not \
soften, summarise, tidy or explain. A translation that makes an angry tenant \
sound polite is a false record.
- Keep names, addresses, unit numbers, amounts and dates exactly as written.
- If part of it is unintelligible, translate what you can and leave the rest \
as it appears rather than guessing.`;

const MODEL = "claude-sonnet-5";

export type Translation = { language: string; english: string | null };

/** Returns null when translation is unavailable, never a guess. A message that
 *  arrives untranslated is a nuisance; one that arrives confidently
 *  mistranslated is a conversation with someone else. */
export async function toEnglish(body: string): Promise<Translation | null> {
  if (!process.env.ANTHROPIC_API_KEY || !body.trim()) return null;
  try {
    const res = await new Anthropic().messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(Detected), effort: "low" },
      messages: [{ role: "user", content: body }],
    });
    if (res.stop_reason === "refusal") return null;
    const out = res.parsed_output;
    if (!out) return null;

    const language = (out.language || "en").slice(0, 5).toLowerCase();
    return {
      language,
      english: language === "en" ? null : (out.english?.trim() || null),
    };
  } catch (e) {
    console.error("translation unavailable", e);
    return null;
  }
}

const OUT_SYSTEM = `You translate short messages from a property manager in \
North Carolina to their tenant or contractor.

- Translate into the target language, plainly and naturally, as a person would \
text it. Not formal, not stiff.
- Keep names, addresses, unit numbers, amounts, dates and links exactly.
- Return only the translated message. No notes, no alternatives, no quotes \
around it.`;

/** English in, the tenant's language out. Returns null rather than sending
 *  something nobody checked: falling back to English is a worse message but an
 *  honest one. */
export async function fromEnglish(text: string, language: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || !text.trim()) return null;
  if (!language || language === "en") return null;
  try {
    const res = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: OUT_SYSTEM,
      messages: [{ role: "user", content: `Target language: ${language}\n\n${text}` }],
    });
    const block = res.content.find((c) => c.type === "text");
    const out = block && block.type === "text" ? block.text.trim() : "";
    return out || null;
  } catch (e) {
    console.error("outbound translation unavailable", e);
    return null;
  }
}

/** Language names for the people reading the inbox, who do not think in ISO
 *  codes. Unknown codes are shown as-is rather than as "Unknown": the code is
 *  at least a fact. */
const NAMES: Record<string, string> = {
  es: "Spanish", fr: "French", pt: "Portuguese", ht: "Haitian Creole",
  vi: "Vietnamese", zh: "Chinese", ar: "Arabic", ru: "Russian", de: "German",
  it: "Italian", ko: "Korean", tl: "Tagalog", pl: "Polish", en: "English",
};

export function languageName(code: string | null | undefined): string {
  if (!code) return "another language";
  return NAMES[code.toLowerCase()] ?? code.toUpperCase();
}
