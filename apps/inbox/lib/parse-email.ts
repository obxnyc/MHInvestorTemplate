import type { Intake } from "./intake";

export type RawEmail = {
  from: string; to: string; subject: string; text: string; messageId: string;
};

/** Pull "Label: value" pairs out of a notification email. Tolerant on purpose:
 *  providers reword these templates without warning, and a missed field must
 *  degrade to an unparsed thread, never to a dropped request. */
function field(text: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+)$`, "im");
    const m = re.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

const PHONE = /(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

function firstPhone(text: string) {
  const m = PHONE.exec(text);
  return m ? m[0] : null;
}

/** Zego / Tenant Web Access maintenance notification.
 *  TUNE ME: the label list below is a best guess at the template. Forward one
 *  real email to the intake address and adjust -- until then the request still
 *  arrives, just with the raw body as the summary. */
export function parseZego(mail: RawEmail): Intake {
  const t = mail.text;
  const name = field(t, "Tenant", "Tenant Name", "Resident", "Resident Name", "Submitted By", "Name");
  const unit = field(t, "Unit", "Unit Number", "Property", "Address", "Lot");
  const issue = field(t, "Description", "Details", "Issue", "Request", "Work Order Description", "Comments");
  const phone = field(t, "Phone", "Phone Number", "Contact Number") ?? firstPhone(t);
  const priority = field(t, "Priority", "Urgency");

  const bits = [unit && `Unit ${unit}`, issue, priority && `(${priority})`].filter(Boolean);
  return {
    source: "zego",
    name, phone,
    email: field(t, "Email", "Email Address"),
    unitHint: unit,
    summary: bits.length ? bits.join(" — ") : mail.subject || "Maintenance request",
    raw: t,
    category: "maintenance",
    externalId: mail.messageId,
  };
}

/** Zillow rental lead. Same caveat: forward a real one and tighten the labels. */
export function parseZillow(mail: RawEmail): Intake {
  const t = mail.text;
  const name = field(t, "Name", "From", "Contact", "Renter");
  const phone = field(t, "Phone", "Phone Number") ?? firstPhone(t);
  const email = field(t, "Email") ?? EMAIL.exec(t.replace(mail.from, ""))?.[0] ?? null;
  const property = field(t, "Property", "Address", "Listing", "Regarding");
  const moveIn = field(t, "Move In", "Move-in", "Move in date", "Moving");
  const message = field(t, "Message", "Comments", "Note");

  const bits = [
    property && `Interested in ${property}`,
    moveIn && `move-in ${moveIn}`,
    message,
  ].filter(Boolean);

  return {
    source: "zillow",
    name, phone, email,
    unitHint: property,
    summary: bits.length ? bits.join(" · ") : mail.subject || "Zillow inquiry",
    raw: t,
    category: "prospect",
    externalId: mail.messageId,
  };
}

/** Squarespace form submission.
 *  Squarespace form blocks have no webhook -- storage is limited to the
 *  submitters list, email, Google Drive, Mailchimp, or Zapier. So we take the
 *  email option and parse it here, which costs nothing and needs no Zapier
 *  subscription. Its notification emails are "Label: value" per line, which is
 *  exactly what field() handles.
 */
export function parseSquarespace(mail: RawEmail): Intake {
  const t = mail.text;
  const name = field(t, "Name", "First Name", "Your Name", "Full Name");
  const last = field(t, "Last Name");
  const phone = field(t, "Phone", "Phone Number", "Cell") ?? firstPhone(t);
  const email = field(t, "Email", "Email Address") ?? EMAIL.exec(t)?.[0] ?? null;
  const message = field(t, "Message", "Comments", "Tell us more", "How can we help");
  const property = field(t, "Property", "Which home", "Interested in", "Address");

  const full = [name, last].filter(Boolean).join(" ") || null;
  return {
    source: "website",
    name: full, phone, email,
    unitHint: property,
    summary: [property && `Interested in ${property}`, message].filter(Boolean).join(" · ")
             || mail.subject || "Website form submission",
    raw: t,
    category: "prospect",
    externalId: mail.messageId,
  };
}

/** Route by who the mail was addressed to, then by sender as a fallback. */
export function routeEmail(mail: RawEmail): Intake | null {
  const to = mail.to.toLowerCase();
  const from = mail.from.toLowerCase();
  if (to.includes("maintenance") || from.includes("zego") || from.includes("paylease")
      || /tenant web access|work order|maintenance request/i.test(mail.subject)) {
    return parseZego(mail);
  }
  if (from.includes("zillow") || /zillow|tour request|showing request/i.test(mail.subject)) {
    return parseZillow(mail);
  }
  if (from.includes("squarespace") || /form submission/i.test(mail.subject)) {
    return parseSquarespace(mail);
  }
  if (to.includes("leads")) return parseZillow(mail);
  return null;
}
