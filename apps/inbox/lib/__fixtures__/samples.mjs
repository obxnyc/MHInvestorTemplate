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

/** Zillow template A — first contact. Renter details replaced; layout exact. */
export const ZILLOW_FIRST = {
  from: "Renter Name <4pbz5we26qp8ei5h4hq80pcustc@convo.zillow.com>",
  to: "larabeehomesllc@gmail.com",
  subject: "Renter is requesting information about 1140 Northside Rd, Elizabeth City, NC, 27909",
  messageId: "<z-a@convo.zillow.com>",
  text: `Brand logo
New message
1140 Northside Rd, Elizabeth City, NC, 27909.
Renter Name says:
I would like to schedule a tour.
Reply to Renter
Send application
You can also reply directly to this email

About Renter Name

Pets
Not answered
Reminder: The federal Fair Housing Act prohibits housing discrimination on the basis of race, color, national origin, sex (including sexual orientation and gender identity), familial status, disability, and religion.
Learn more about voucher assistance programs and the basics of fair housing laws.

Other helpful links
Found a tenant and no longer wish to get inquiries for this property? Manage this listing
Is this inquiry spam? Report spam
Know your fair housing obligations under Zillow's Respectful Renting Pledge
Have questions or need help? Find answers on our FAQ page, or contact us.

Get it on Google Play\tDownload on the App Store
Download the free Zillow Rental Manager app
Add photos and get notifications of new leads.
Zillow, Inc.
1301 Second Avenue, Floor 36
Seattle, WA 98101
© 2006-2026
Privacy policy | Update your preferences`,
};

/** Zillow template B — follow-up messages use ALL-CAPS block labels. */
export const ZILLOW_REPLY = {
  from: "Renter Name <4pbz5we26qp8ei5h4hq80pcustc@convo.zillow.com>",
  to: "larabeehomesllc@gmail.com",
  subject: "New message from a renter",
  messageId: "<z-b@convo.zillow.com>",
  text: `Brand logo
New message from a renter
Regarding your listing at:
1140 Northside Rd, Elizabeth City, NC 27909
Reply on Zillow

Some rental inquiries may be scams. If a message asks you to scan a QR code, select a link, verify your identity, or send payment, don't respond. Report it to us instead.
Learn about staying safe.

RENTER'S NAME
Renter Name
RENTER'S MESSAGE
Hi, I'm still interested in this rental. I pay $1350 per month currently. Not sure of my current credit score but I can pull it. I don't have any pets and I don't have any roommates. I am able to get a co-signer/guarantor if needed.`,
};
