/**
 * Real notification formats, with tenant details replaced by placeholders.
 * The LABELS and LAYOUT are exactly as the providers send them — that is what
 * the parsers key on. Values are fake so no resident data lives in the repo.
 */
export const RENT_MANAGER = {
  from: "donotreply@rentmanager.com",
  to: "larabeehomesllc@gmail.com",
  subject: "New Issue Submitted from TWA: 1140 Northside #51, 1140 Northside Rd, Lot #51",
  messageId: "<rm-sample-1@rentmanager.com>",
  text: `Tenant WebAccess
The following issue was submitted via TWA:
Issue Title: Kitchen sink faucet leaking.
Description: Kitchen sink leaking from riser
Assigned To:

Tenant: Doe, Jane
Number: (555) 555-0100`,
};

export const VOICEMAIL = {
  from: "noreply@netdialtone.com",
  to: "info@larabeehomesllc.com",
  subject: "New Mailbox Message from +15555550100",
  messageId: "<ndt-sample-1@netdialtone.com>",
  text: `A new message has been left for mailbox 402 (Existing Tenant GDM). The message is 0:42 minutes, and has been attached to this email.

Transcription:
Hi this is Jane in lot fifty one, the kitchen faucet is still dripping, please call me back.

-- 
Net Dial Tone
+1 513-583-0840
support@netdialtone.com`,
};

export const VOICEMAIL_BLANK = {
  ...VOICEMAIL,
  messageId: "<ndt-sample-2@netdialtone.com>",
  text: VOICEMAIL.text
    .replace(/Transcription:\n[^\n]+/, "Transcription:\n[BLANK_AUDIO]")
    .replace("0:42", "0:01"),
};
