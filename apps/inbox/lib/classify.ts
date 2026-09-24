import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export type Category = "maintenance" | "prospect" | "current_tenant" | "vendor" | "other";

export type Classification = {
  category: Category;
  /** 0–1. Below REVIEW_THRESHOLD the thread is left unassigned for a human. */
  confidence: number;
  urgent: boolean;
  /** Which layer decided, so a wrong call can be traced to its cause. */
  basis: "source" | "emergency" | "known-tenant" | "model" | "fallback";
  unitHint?: string | null;
  summary?: string | null;
};

/** Anything below this lands in the review queue rather than a team's inbox.
 *  Filing a burst pipe under leasing is worse than filing it nowhere. */
export const REVIEW_THRESHOLD = 0.75;

/* ------------------------------------------------------------------ layer 1
 * The source often IS the answer.
 *
 * A Rent Manager Tenant WebAccess submission is a work order by construction —
 * a tenant filled in a maintenance form inside a tenant portal. A Zillow lead
 * is a prospect by construction. Guessing at these would be strictly worse
 * than reading the envelope.
 */
const BY_SOURCE: Record<string, Category> = {
  zego: "maintenance",        // Rent Manager TWA work orders
  zillow: "prospect",
};

export function classifyBySource(source: string): Classification | null {
  const category = BY_SOURCE[source];
  return category ? { category, confidence: 1, urgent: false, basis: "source" } : null;
}

/* ------------------------------------------------------------------ layer 2
 * Emergencies never wait on a network call. "No heat" at 2am must route in
 * microseconds, and being slow here is the same as being wrong.
 */
const EMERGENCY =
  /\b(no heat|no water|no power|heat is out|furnace|burst|flood(ing|ed)?|gas leak|smell(s|ing)? gas|smoke|fire|sewage|backed up|carbon monoxide|locked out|lockout)\b/i;

export function classifyEmergency(body: string): Classification | null {
  return EMERGENCY.test(body)
    ? { category: "maintenance", confidence: 1, urgent: true, basis: "emergency" }
    : null;
}

/* ------------------------------------------------------------------ layer 3
 * WHO is texting beats WHAT they said.
 *
 * "Is it still available?" from a stranger is a leasing enquiry. The same
 * sentence from a tenant of eight months is about a parking spot or a
 * neighbouring unit. Keyword matching gets this backwards; sender identity
 * gets it right.
 */
export type SenderContext = {
  party?: string | null;
  hasUnit?: boolean;
  priorConversations?: number;
};

const LEASING_INTENT =
  /\b(available|availability|for rent|renting|apply|application|tour|showing|see the (house|home|place)|move[- ]?in|how much|deposit|pet friendly|bedroom)\b/i;
const MAINTENANCE_INTENT =
  /\b(broken|not working|won'?t|leak(ing)?|clog(ged)?|drip|repair|fix|toilet|sink|drain|faucet|ac\b|air condition|heater|fridge|refrigerator|stove|oven|washer|dryer|water heater|roof|window|door|pest|mice|roach|ants)\b/i;

export function classifyByContact(
  body: string, ctx: SenderContext,
): Classification | null {
  const known = ctx.party === "current_tenant" || ctx.hasUnit;

  if (known && MAINTENANCE_INTENT.test(body)) {
    return { category: "maintenance", confidence: 0.92, urgent: false, basis: "known-tenant" };
  }
  if (known && !LEASING_INTENT.test(body)) {
    // A known tenant with no leasing language is talking about their tenancy.
    return { category: "current_tenant", confidence: 0.8, urgent: false, basis: "known-tenant" };
  }
  if (!known && LEASING_INTENT.test(body) && !MAINTENANCE_INTENT.test(body)) {
    return { category: "prospect", confidence: 0.85, urgent: false, basis: "known-tenant" };
  }
  return null;
}

/* ------------------------------------------------------------------ layer 4 */

const Result = z.object({
  category: z.enum(["maintenance", "prospect", "current_tenant", "vendor", "other"]),
  confidence: z.number().min(0).max(1),
  urgent: z.boolean(),
  unit_hint: z.string().nullable(),
  summary: z.string(),
});

const SYSTEM = `You triage inbound text messages for Larabee Homes, which rents \
mobile homes in North Carolina.

Assign exactly one category:
- maintenance: something is broken, needs repair, or is a habitability problem
- prospect: someone who does not rent from us asking about renting
- current_tenant: an existing tenant on any non-maintenance subject (rent, \
lease, notice, parking, general question)
- vendor: a contractor, supplier or service provider
- other: anything else, including messages too vague to place

Rules:
- Sender context outweighs wording. A known tenant asking "is it available" is \
almost never a new prospect.
- confidence is your genuine certainty. Use below 0.75 whenever the message is \
short, ambiguous, or could plausibly be two categories. A low score routes it \
to a human, which is the correct outcome for a genuinely unclear message.
- urgent is true only for habitability or safety: heat, water, gas, electrical, \
flooding, sewage, security, lockout.
- Never infer anything about family status, disability, race, religion, or \
national origin, and never let such details influence the category. If the \
message contains them, ignore them entirely.`;

/**
 * Ambiguous messages only. Everything decided above never reaches this.
 *
 * On refusal, error, or an unparseable response the caller keeps the heuristic
 * answer at low confidence, which sends the thread to the review queue. A
 * classifier that fails closed into human review is safe; one that fails into
 * a confident guess is not.
 */
export async function classifyWithModel(
  body: string, ctx: SenderContext,
): Promise<Classification | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const context = [
    `Sender is ${ctx.party ?? "unknown to us"}.`,
    ctx.hasUnit ? "They are on a lease with us." : "They are not on any lease with us.",
    `Prior conversations with them: ${ctx.priorConversations ?? 0}.`,
  ].join(" ");

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 256,
      system: SYSTEM,
      // Classification does not repay deep reasoning; low effort keeps this
      // fast and cheap on a path that runs on every ambiguous inbound text.
      output_config: { format: zodOutputFormat(Result), effort: "low" },
      messages: [{ role: "user", content: `${context}\n\nMessage:\n${body}` }],
    });

    if (response.stop_reason === "refusal") return null;
    const out = response.parsed_output;
    if (!out) return null;

    return {
      category: out.category,
      confidence: out.confidence,
      urgent: out.urgent,
      basis: "model",
      unitHint: out.unit_hint,
      summary: out.summary,
    };
  } catch (e) {
    console.error("classifier unavailable, falling back to heuristics", e);
    return null;
  }
}

/** The whole ladder, cheapest and most certain first. */
export async function classify(
  body: string, source: string, ctx: SenderContext = {},
): Promise<Classification> {
  return classifyBySource(source)
    ?? classifyEmergency(body)
    ?? (await classifyWithModel(body, ctx))
    ?? classifyByContact(body, ctx)
    ?? { category: "other", confidence: 0.3, urgent: false, basis: "fallback" };
}

/** Synchronous ladder for tests and for any path that must not await. */
export function classifySync(
  body: string, source: string, ctx: SenderContext = {},
): Classification {
  return classifyBySource(source)
    ?? classifyEmergency(body)
    ?? classifyByContact(body, ctx)
    ?? { category: "other", confidence: 0.3, urgent: false, basis: "fallback" };
}

export const needsReview = (c: Classification) => c.confidence < REVIEW_THRESHOLD;
