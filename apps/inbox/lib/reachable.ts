import { realPhone } from "./format";

/**
 * How a reply to this person would actually go out.
 *
 * A maintenance request from Rent Manager, or one forwarded from Tenant
 * Web Access, arrives with no mobile number -- so `contacts.phone` holds
 * a stand-in like `email:rm:issue:251`, which is a key and not a number.
 * The reply route handed that straight to Twilio, which refused it, and
 * the first anybody knew was a failed message under something they had
 * already typed.
 *
 * Three answers, not two, because "we have an email" and "we have no way
 * to reach this person at all" are different problems with different
 * answers -- one of them is a reply, the other is somebody going to find
 * a phone number.
 */
export type Reach =
  | { by: "sms"; to: string }
  | { by: "email"; to: string }
  | { by: "none"; why: string };

export function reachFor(
  person: { phone?: string | null; email?: string | null } | null,
): Reach {
  const number = realPhone(person?.phone ?? null);
  if (number) return { by: "sms", to: number };

  /* An email address, which is what a Tenant Web Access request carries
     and what most Rent Manager tenants have on file. */
  const email = (person?.email ?? "").trim();
  if (email && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return { by: "email", to: email };
  }

  /* The stand-in is worth naming: somebody looking at this is deciding
     whether to go and find a number, and "no phone number" reads as a
     fault where "this came from Rent Manager, which does not send one"
     reads as a thing to do. */
  const stand = (person?.phone ?? "").trim();
  return {
    by: "none",
    why: stand.startsWith("email:rm:")
      ? "This came from Rent Manager, which does not pass on a number or an"
        + " email. Add one to the contact and you can reply here."
      : stand.startsWith("email:")
      ? "This arrived by email and no address came with it. Add one to the"
        + " contact and you can reply here."
      : "There is no mobile number or email address on this contact, so"
        + " there is nowhere for a reply to go.",
  };
}

/** The sentence above the composer. */
export function reachSays(reach: Reach, pretty: (p: string) => string): string {
  if (reach.by === "sms") return `Replies go by text to ${pretty(reach.to)}.`;
  if (reach.by === "email") return `Replies go by email to ${reach.to}.`;
  return reach.why;
}
