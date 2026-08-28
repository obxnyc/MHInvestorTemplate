# Larabee Inbox

A shared inbox for one Twilio number. Everyone in the office works the same
threads from their phone, anyone can pick up where someone else left off, and
every reply carries a name.

- **Groups** — conversations route to a team (Maintenance, Leasing, …). The
  whole team sees the thread, not just whoever claimed it.
- **Claiming** — "I've got this" assigns a thread. Two simultaneous taps
  resolve to one winner; the loser is told who beat them.
- **Internal notes** — visible to the team, never sent to the tenant.
- **Audit trail** — written by database triggers, not by this app, so a missed
  call site in the code can't leave a gap.
- **Live** — every open screen refreshes on new activity, so two people don't
  answer the same tenant.

- **Push notifications** — installable to a phone home screen, alerts on new
  texts, missed calls, voicemail, and `@mentions`.
- **Every channel in one queue** — texts, calls and voicemail, Zego maintenance
  requests, Zillow leads, and Squarespace form submissions all open threads in
  the same inbox.

Next.js 16 · Supabase (Postgres, Auth, RLS, Realtime) · Twilio · Cloudflare Email Routing.

---

## Setup

### 1. Database

Create a Supabase project, then in the SQL editor run, in order:

1. `../../docs/shared-line/schema.sql`
2. `supabase/seed.sql`

Then enable Realtime for the `messages` and `conversations` tables
(Database → Replication).

### 2. Environment

Copy `.env.example` to `.env.local` and fill it in.

`SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy. It is used only by the
Twilio webhooks, which have no signed-in user to act as. Never prefix it with
`NEXT_PUBLIC_`.

`PUBLIC_BASE_URL` must match the webhook URL in the Twilio console
byte-for-byte, including scheme. Twilio hashes that exact string when it signs
the request, so a mismatch rejects every webhook with a 403.

### 3. Deploy

```bash
npm install
npx vercel --prod        # or any Node host
```

Set the same environment variables in your host's dashboard, then point
`inbox.larabeehomesllc.com` at the deployment.

Use a **subdomain**, not the apex: `www.larabeehomesllc.com` is your Squarespace
site and must keep pointing there. A CNAME on `inbox` leaves the marketing site
completely untouched.

### 4. Point Twilio at it

In the Twilio console, on your Messaging Service (not the bare number — the
Messaging Service is what your A2P campaign attaches to):

| Setting | Value |
| --- | --- |
| Incoming message webhook | `https://<your-domain>/api/twilio/sms` (POST) |
| Delivery status callback | `https://<your-domain>/api/twilio/status` (POST) |

Confirm your number is in that Messaging Service's sender pool — a number
outside it reads as `UNREGISTERED` and gets filtered even with an approved
campaign. `../../docs/shared-line/preflight.sh` checks this.

### 5. Add your people

Each person signs in once at `/login` with a magic link, which creates their
`auth.users` row. Then add their `staff` row and team memberships — see the
comments at the bottom of `supabase/seed.sql`.

---

## How it fits together

**Inbound.** Twilio POSTs to `/api/twilio/sms`. The route reads the body as raw
text (calling `req.formData()` first would consume the stream and break
signature validation), verifies `X-Twilio-Signature`, checks `MessageSid`
against what's stored, finds or creates the contact and conversation,
classifies a new thread, and returns empty TwiML so no auto-reply goes out.

**Classification** runs keywords first — "no heat" at 2am must not wait on an
API call — and routes to the team registered for that category. Swap in a model
call behind the keyword pass when you want better coverage; keep a confidence
threshold and leave low-confidence threads unassigned rather than filing a
burst pipe under leasing.

**Outbound.** `/api/conversations/[id]/reply` takes the author from the session,
never from the request body. A client that could name its own author would make
the audit trail worthless.

**Claiming** calls `claim_conversation()`, whose conditional `UPDATE ... WHERE
assigned_to IS NULL` is what makes concurrency safe. Read-then-write in
application code is how two employees end up texting the same tenant.

---

## Voice

Point your Twilio number's **Voice** webhook at `/api/twilio/voice`.

An inbound call announces that it may be recorded, then rings every active
staff member's `forward_to` number at once. Each leg must **press 1 to accept**
before the call bridges. That whisper is not a nicety: a phone that is off
answers instantly with its owner's personal voicemail, silently swallowing the
call. A voicemail box cannot press 1.

If nobody accepts, the team gets a push notification immediately and the caller
reaches voicemail. The recording and its transcript land on the caller's thread,
and the call appears on `/calls` flagged **needs callback** until someone taps
**Call back** — which logs who is returning it before opening the dialer, so the
trail exists even if the callback goes unanswered.

Two limits worth knowing:

- Voicemail is capped at **120 seconds** deliberately. Twilio's built-in
  transcription only covers US-English recordings between 2 and 120 seconds, so
  a longer cap would silently produce voicemails with no transcript.
- Recordings are dual-channel (each party on its own track, same price as mono).
  **Check your state's recording-consent law.** The announcement is in the TwiML
  at the top of `app/api/twilio/voice/route.ts`; do not remove it without
  knowing your jurisdiction.

## Intake from other systems

Zego maintenance requests, Zillow leads, and Squarespace form submissions all
arrive as **email**, so one pipe handles all three.

Squarespace form blocks have no webhook — storage is limited to the submitters
list, email, Google Drive, Mailchimp, or Zapier — so email is the path that
costs nothing and needs no Zapier subscription.

### Pick a path based on who handles your mail

**`larabeehomesllc.com` is on Google** — confirmed from the headers of a real
notification, which Google's inbound mail servers stamped on delivery to
`info@larabeehomesllc.com`. So use **Postmark inbound**.

Enabling Cloudflare Email Routing on a domain **replaces that domain's MX
records**, which would stop your real mail from being delivered. It is one mail
handler per domain, and yours is already spoken for. Postmark avoids the
question entirely — no DNS changes at all:

1. Create a Postmark inbound server. It gives you an address like
   `abc123hash@inbound.postmarkapp.com`.
2. Set its webhook to
   `https://inbox.larabeehomesllc.com/api/intake/postmark?secret=<INTAKE_SECRET>`.
   Postmark does not sign inbound webhooks, so that URL **is** a credential —
   treat it like a password.
3. In Gmail, create filters that forward matching mail to the Postmark
   address. Both mailboxes that already receive these need a filter:
   - `from:rentmanager.com` → forward   (maintenance, in `larabeehomesllc@gmail.com`)
   - `from:netdialtone.com` → forward   (voicemail, in `info@larabeehomesllc.com`)
   - `from:zillow.com` → forward
   - `from:squarespace.info` → forward
4. Leave your existing notification recipients exactly as they are. This adds a
   copy; it takes nothing away.

Gmail's spam filtering runs before the forward, which is a free bonus.

Cloudflare Email Routing is **not** an option here: enabling it replaces the
domain's MX records and would stop delivery to `info@larabeehomesllc.com`. The
worker in `cloudflare/` is kept only for a domain with no mail of its own. Deploy `cloudflare/email-worker.js`, route
`intake@larabeehomesllc.com` to it, set its `INTAKE_URL` and `INTAKE_SECRET`
secrets, and add `intake@` as an additional recipient in Zego, Zillow, and
Squarespace.

Both paths feed the same parsers and the same `ingest()`, so you can switch
later without touching any parsing code.

### What each parser handles

| Source | Sender | Status |
| --- | --- | --- |
| Rent Manager Tenant WebAccess | `donotreply@rentmanager.com` | **Verified** against a real message |
| Net Dial Tone voicemail | `noreply@netdialtone.com` | **Verified** against a real message |
| Zillow lead | `*@convo.zillow.com` | **Verified** — both templates |
| Squarespace form | `*@squarespace.info` | Unverified — labels are a guess |

Maintenance requests arrive from **Rent Manager**, not Zego — Tenant WebAccess
submits into Rent Manager and Rent Manager sends the notification. The property
is in the *subject* line, the phone label is `Number:` not `Phone:`, and tenant
names come through as `Last, First`.

Net Dial Tone **transcribes voicemail itself**, so those threads carry the
transcript with no speech-to-text service involved. Its mailbox names
("Existing Tenant GDM") are used to route the thread, and `[BLANK_AUDIO]` is
labelled as no-speech rather than shown as a transcript.

**Zillow gives you no phone number.** Renters are anonymised behind a per-lead
relay address (`…@convo.zillow.com`), so a Zillow lead cannot be texted until
they hand over a number themselves. The parser leaves `phone` null rather than
inventing one, notes on the thread that replying to the relay reaches them, and
uses the relay address as the contact key so every message from that lead
threads together. Zillow also sends two different templates — first contact uses
`<Name> says:`, follow-ups use ALL-CAPS block labels with the value on the next
line — and both are handled. Roughly two thirds of a Zillow email is fair-housing
notices, scam warnings and app badges; that chrome is stripped so the thread
shows the message.

Run the parser tests after touching any template:

```bash
npm run test:parsers
```

Fixtures live in `lib/__fixtures__/samples.mjs` — real provider layouts with
resident details replaced by placeholders, so no tenant data sits in the repo.

For the two unverified parsers, send one real message through and tighten them.
Nothing is lost meanwhile: `ingest()` always creates a thread even when field
parsing returns nothing, so an unparsed request arrives as a readable blob. A
blob is recoverable; a dropped request is not.

For a richer form (the prequalification form, eventually), post JSON directly to
`/api/intake/form` from a Squarespace code block instead.

## Push notifications

Generate keys once, then set both in your environment:

```bash
npx web-push generate-vapid-keys
```

Everyone installs the app the same way, and on iPhone this step is mandatory:

- **iPhone** — open the site in Safari, tap **Share → Add to Home Screen**, then
  open it from the home screen icon. iOS only delivers web push to an installed
  PWA, never from a Safari tab. The app detects this and shows the instruction
  instead of a button that cannot work.
- **Android** — Chrome offers "Install app"; push works either way.
- **Desktop** — works in the browser directly.

Replace `public/icon-192.png` and `public/icon-512.png` with real artwork; the
committed ones are flat placeholder squares.

## Internal coordination

There is no separate chat room, on purpose. Coordination happens as **internal
notes on the thread** — the switch next to the composer — so the plan of action
stays attached to the issue it concerns rather than scrolling away in a general
channel. Notes are never sent to the tenant.

Type `@amy` in a note to notify a teammate; they get a push and it opens
straight to that thread.

## Not built yet

Work orders and tech dispatch, the prequalification form and rules engine, and
the lease-cycle nurture program in `../../docs/shared-line/NURTURE.md`. The
schema covers all of them.

Pulling maintenance requests from the **Rent Manager API** instead of parsing
Zego's notification emails would be more reliable — structured fields, no
template drift. Rent Manager gates API access behind an authorized-customer
programme, so that is a phone call to them, not a code change.
