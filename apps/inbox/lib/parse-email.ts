import type { Intake } from "./intake";

export type RawEmail = {
  from: string; to: string; subject: string; text: string; messageId: string;
};

/** Pull "Label: value" out of a notification email. Tolerant on purpose:
 *  providers reword templates without warning, and a missed field must degrade
 *  to an unparsed thread, never to a dropped request. */
function field(text: string, ...labels: string[]): string | null {
  for (const label of labels) {
    // [ \t]* rather than \s* after the colon: \s matches newlines, so a label
    // with an EMPTY value ("Assigned To:" on its own line) would otherwise
    // reach across the blank line and capture the next field's text.
    const re = new RegExp(`^[ \\t>]*${label}[ \\t]*[:\\-][ \\t]*(.*)$`, "im");
    const m = re.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

const PHONE = /(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

const firstPhone = (t: string) => PHONE.exec(t)?.[0] ?? null;

/** Zillow puts its values on the line AFTER the label, with no colon:
 *
 *     RENTER'S NAME
 *     Monica Merricks
 *
 *  field() only understands "Label: value", so this handles the other shape.
 */
function blockAfter(text: string, ...labels: string[]): string | null {
  const lines = text.split(/\r?\n/);
  for (const label of labels) {
    const want = label.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().toLowerCase().replace(/[:\u2019']/g, "'") !== want.replace(/[:\u2019']/g, "'")) continue;
      // take following lines until a blank or the next ALL-CAPS label
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l) { if (out.length) break; else continue; }
        if (/^[A-Z''\s]{4,}$/.test(l) && out.length) break;
        out.push(l);
      }
      if (out.length) return out.join(" ").trim();
    }
  }
  return null;
}

/** Zillow notification emails are mostly chrome — fair-housing notices, scam
 *  warnings, app badges, a corporate address. Dropping it keeps the thread
 *  readable instead of burying two useful lines in forty. */
const ZILLOW_NOISE = [
  /^Brand logo$/i, /^New message( from a renter)?$/i, /^Reply on Zillow$/i,
  /^Reply to /i, /^Send application$/i, /^You can also reply directly/i,
  /^Some rental inquiries may be scams/i, /^Learn about staying safe/i,
  /^Reminder: The federal Fair Housing Act/i, /^Learn more about voucher/i,
  /^Other helpful links$/i, /^Found a tenant/i, /^Is this inquiry spam/i,
  /^Know your fair housing/i, /^Have questions or need help/i,
  /^Get it on Google Play/i, /^Download on the App Store/i,
  /^Download the free Zillow/i, /^Add photos and get notifications/i,
  /^Zillow, Inc\.$/i, /^1301 Second Avenue/i, /^Seattle, WA/i,
  /^© ?\d{4}/, /^Privacy policy/i, /^Update your preferences/i,
  /^Manage this listing$/i, /^Report spam$/i,
];

function stripZillowChrome(text: string) {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !ZILLOW_NOISE.some((re) => re.test(l)))
    .join("\n");
}

/** Rent Manager writes tenant names "Last, First". Everywhere else in the app
 *  shows people the way they'd introduce themselves. */
function flipName(name: string | null): string | null {
  if (!name) return null;
  const m = /^([^,]+),\s*(.+)$/.exec(name.trim());
  return m ? `${m[2].trim()} ${m[1].trim()}` : name.trim();
}

/**
 * Rent Manager Tenant WebAccess issue notification.
 * Verified against a real message. Actual shape:
 *
 *   From:    Rent Manager Event Notifier <donotreply@rentmanager.com>
 *   Subject: New Issue Submitted from TWA: 1140 Northside #51, 1140 Northside Rd, Lot #51
 *
 *   Tenant WebAccess
 *   The following issue was submitted via TWA:
 *   Issue Title: Kitchen sink faucet leaking.
 *   Description: Kitchen sink leaking from riser
 *   Assigned To:
 *
 *   Tenant: Miller, Winston
 *   Number: (386) 983-1466
 *
 * Note the property lives in the SUBJECT, not the body, and the phone label is
 * "Number" rather than "Phone".
 */
export function parseRentManager(mail: RawEmail): Intake {
  const t = mail.text;
  const title = field(t, "Issue Title", "Issue");
  const description = field(t, "Description", "Details");
  const tenant = flipName(field(t, "Tenant", "Resident"));
  const phone = field(t, "Number", "Phone", "Phone Number") ?? firstPhone(t);
  const assigned = field(t, "Assigned To");

  // "New Issue Submitted from TWA: 1140 Northside #51, 1140 Northside Rd, Lot #51"
  const unit = /from TWA:\s*(.+)$/i.exec(mail.subject)?.[1]?.trim() ?? null;

  const summary = [
    unit,
    title || description,
    assigned && `assigned to ${assigned}`,
  ].filter(Boolean).join(" — ");

  return {
    source: "zego",           // kept as the maintenance-intake key
    name: tenant,
    phone,
    email: field(t, "Email", "Email Address"),
    unitHint: unit,
    summary: summary || mail.subject || "Maintenance request",
    raw: t,
    category: "maintenance",
    externalId: mail.messageId,
  };
}

/**
 * Net Dial Tone voicemail notification from the existing VOIP line.
 * Verified against a real message. Actual shape:
 *
 *   From:    noreply@netdialtone.com
 *   Subject: New Mailbox Message from +17577421590
 *   Body:    A new message has been left for mailbox 402 (Existing Tenant GDM).
 *            The message is 0:01 minutes, and has been attached to this email.
 *            Transcription:
 *            <transcript, or [BLANK_AUDIO] when there was no speech>
 *
 * The provider transcribes already, so no speech-to-text service is needed.
 * The caller's number is in the subject, and the mailbox name carries the
 * routing hint.
 */
export function parseVoicemail(mail: RawEmail): Intake {
  const t = mail.text;
  const caller = /from\s*(\+?\d[\d\s().-]{6,})/i.exec(mail.subject)?.[1]?.trim()
    ?? firstPhone(mail.subject);

  const box = /mailbox\s+(\d+)\s*\(([^)]+)\)/i.exec(t);
  const mailboxName = box?.[2]?.trim() ?? null;
  const duration = /message is\s*([\d:]+)\s*minutes/i.exec(t)?.[1] ?? null;

  // Everything after "Transcription:" up to the signature separator.
  let transcript = /Transcription:\s*([\s\S]*?)(?:\n\s*--\s*\n|$)/i
    .exec(t)?.[1]?.trim() ?? null;
  const blank = !transcript || /^\[?BLANK_AUDIO\]?$/i.test(transcript);
  if (blank) transcript = null;

  // Mailboxes are already split by purpose on the VOIP side, so reuse that.
  const name = (mailboxName ?? "").toLowerCase();
  const category: Intake["category"] =
    /maint|repair|service/.test(name) ? "maintenance"
    : /prospect|leasing|new|available/.test(name) ? "prospect"
    : /tenant|existing|resident/.test(name) ? "current_tenant"
    : "other";

  const summary = transcript
    ? `Voicemail${mailboxName ? ` (${mailboxName})` : ""}: ${transcript}`
    : `Voicemail${mailboxName ? ` (${mailboxName})` : ""} — no speech recorded`
      + `${duration ? `, ${duration}` : ""}. Listen to the attachment.`;

  return {
    source: "voicemail",
    name: null,
    phone: caller,
    email: null,
    unitHint: mailboxName,
    summary,
    raw: t,
    category,
    externalId: mail.messageId,
  };
}

/**
 * Zillow rental lead. Verified against real messages, which come in two
 * templates:
 *
 *   A (first contact)      "<Name> says:" then the message on the next line
 *   B (follow-up messages) "RENTER'S NAME" / "RENTER'S MESSAGE" blocks
 *
 * The thing that matters most here: Zillow ANONYMISES the renter. There is no
 * phone number and no real email address — only a per-lead relay address like
 * 4pbz…@convo.zillow.com. You cannot text a Zillow lead until they give you a
 * number, so the summary says so plainly and the relay address becomes the
 * contact key, which threads every message from that lead together.
 */
export function parseZillow(mail: RawEmail): Intake {
  const clean = stripZillowChrome(mail.text);

  // The From display name is the renter's name and survives both templates.
  const displayName = /^\s*"?([^"<]+?)"?\s*</.exec(mail.from)?.[1]?.trim() || null;
  const name = blockAfter(clean, "RENTER'S NAME")
    ?? /^(.+?)\s+says:/im.exec(clean)?.[1]?.trim()
    ?? displayName;

  const message = blockAfter(clean, "RENTER'S MESSAGE")
    ?? /says:\s*\n?(.+)/i.exec(clean)?.[1]?.trim()
    ?? null;

  const property = blockAfter(clean, "Regarding your listing at:")
    ?? /requesting information about\s+(.+?)\.?$/im.exec(mail.subject)?.[1]?.trim()
    ?? /^([\d]+\s+[^\n]*,\s*[A-Z]{2},?\s*\d{5})\.?$/im.exec(clean)?.[1]?.trim()
    ?? null;

  const pets = blockAfter(clean, "Pets");

  // The relay address is stable per lead, so it threads their messages.
  const relay = /<([^>]+@convo\.zillow\.com)>/i.exec(mail.from)?.[1]
    ?? EMAIL.exec(mail.from)?.[0] ?? null;

  const summary = [
    property && `Zillow — ${property}`,
    message,
    pets && pets.toLowerCase() !== "not answered" && `pets: ${pets}`,
  ].filter(Boolean).join(" · ") || mail.subject || "Zillow inquiry";

  return {
    source: "zillow",
    name,
    // Zillow gives no phone. Leaving this null is correct and is what makes
    // the "no number yet" note below true rather than decorative.
    phone: null,
    email: relay,
    unitHint: property,
    summary,
    raw: `${clean}\n\n— Zillow relay: replying to ${relay ?? "this thread"} reaches them.`
       + `\n— No phone number: Zillow anonymises renters. Ask for one before texting.`,
    category: "prospect",
    externalId: mail.messageId,
  };
}

/** Squarespace form submission. NOT yet verified against a real message.
 *  Squarespace form blocks have no webhook — storage is the submitters list,
 *  email, Drive, Mailchimp or Zapier — so email is the free path. */
export function parseSquarespace(mail: RawEmail): Intake {
  const t = mail.text;
  const name = field(t, "Name", "First Name", "Your Name", "Full Name");
  const last = field(t, "Last Name");
  const phone = field(t, "Phone", "Phone Number", "Cell") ?? firstPhone(t);
  const email = field(t, "Email", "Email Address") ?? EMAIL.exec(t)?.[0] ?? null;
  const message = field(t, "Message", "Comments", "Tell us more", "How can we help");
  const property = field(t, "Property", "Which home", "Interested in", "Address");

  return {
    source: "website",
    name: [name, last].filter(Boolean).join(" ") || null,
    phone, email,
    unitHint: property,
    summary: [property && `Interested in ${property}`, message].filter(Boolean).join(" · ")
             || mail.subject || "Website form submission",
    raw: t,
    category: "prospect",
    externalId: mail.messageId,
  };
}

/**
 * Route on the ORIGINAL sender. A Gmail forward rewrites the envelope, so the
 * recipient address tells you nothing useful; the Postmark adapter passes
 * FromFull.Email through for exactly this reason.
 */
export function routeEmail(mail: RawEmail): Intake | null {
  const from = mail.from.toLowerCase();
  const to = mail.to.toLowerCase();
  const subject = mail.subject ?? "";

  if (from.includes("rentmanager.com") || /submitted from twa|tenant webaccess/i.test(subject)
      || /submitted via TWA/i.test(mail.text)) {
    return parseRentManager(mail);
  }
  if (from.includes("netdialtone.com") || /new mailbox message/i.test(subject)) {
    return parseVoicemail(mail);
  }
  if (from.includes("zillow.com") || /zillow|tour request|showing request/i.test(subject)) {
    return parseZillow(mail);
  }
  if (from.includes("squarespace") || /form submission/i.test(subject)) {
    return parseSquarespace(mail);
  }
  // Zego direct, if TWA ever notifies from there rather than through Rent Manager.
  if (from.includes("zego.io") || from.includes("paylease.com")) {
    return parseRentManager(mail);
  }
  if (to.includes("maintenance")) return parseRentManager(mail);
  if (to.includes("leads")) return parseZillow(mail);
  return null;
}
