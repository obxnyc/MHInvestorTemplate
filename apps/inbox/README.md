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

Next.js 16 · Supabase (Postgres, Auth, RLS, Realtime) · Twilio.

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

Set the same environment variables in your host's dashboard.

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

## Not built yet

Voice (the ring group with the press-1 whisper is specified in
`../../docs/shared-line/PLAN.md`), work orders and tech dispatch, the
prequalification form and rules engine, and the lease-cycle nurture program in
`../../docs/shared-line/NURTURE.md`. The schema covers all of them.
