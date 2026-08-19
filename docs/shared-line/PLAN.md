# Larabee Homes — Shared Line Plan

How to run one Twilio number across the whole office for tenants, prospects, and
vendors, with an audit trail of who did what, and where the automation goes next.

Written August 2026. Prices verified at that date; re-check before you commit.

---

## The short answer

**Buy the inbox. Build the routing.**

The part you described first — shared number, everyone can see the thread, notes,
tags, "who answered this" — is a solved product. Three or four vendors do it well
for about the price of a coffee per person per week. Building it yourself means
owning webhook retries, delivery receipts, presence, mobile push, and carrier
compliance forever, and none of that is your edge.

The part you described second — auto-classify the message, dispatch to the right
tech, prequalify a prospect and get them on a showing calendar with confirmations
flying to both sides — is where off-the-shelf gets thin *and* where the actual
money is. That's worth building, or worth buying from a rental-specific vendor.

So: two different decisions, not one.

### One structural decision drives everything else

If you **port the number away from Twilio** into a phone app, you get a great
mobile experience and you lose direct programmable access to that number. Your
Phase 2 automation then has to work through whatever API that vendor exposes.

If you **keep the number on Twilio** and point a shared-inbox front end at it,
the number stays programmable. The same line serves the humans and your
automation. That's the recommendation.

---

## What you actually asked for, split by "buy or build"

| Capability | Buy or build |
| --- | --- |
| One number, everyone sends and receives | Buy |
| Thread history visible to the whole office | Buy |
| Assignment + internal notes so someone can pick up mid-thread | Buy |
| Audit log: who replied, who answered, when | Buy (verify depth — see below) |
| Grouping: maintenance / prospect / tenant / vendor | Buy (tags), build (auto-tagging) |
| Auto-classify inbound and route it | Build |
| Dispatch maintenance to the servicing tech | Build |
| Prequalify a prospect, book a showing, confirm both sides | Buy (rental-specific) |

---

## Phase 1 — the shared inbox (this week)

### Recommended: Missive pointed at your existing Twilio number

Missive connects to a Twilio number using your Account SID, Auth Token, and the
number itself. You keep the number you just registered. No port, no downtime, and
Twilio stays underneath as your programmable layer.

What you get: shared inbox, per-conversation assignment, internal comments that
never reach the tenant, labels, canned responses, rules, search, mobile apps, and
an API.

Pricing: $14/user/mo (Starter, 5-user cap, no rules/API/integrations),
$24/user/mo (Productive — rules, integrations, API), $36/user/mo (Business).
**Take Productive.** Starter has no API and no rules, which kills Phase 2.
30-day trial, no card.

Caveat: Missive is an inbox, not a phone system. Voice needs a separate answer —
see "Calls" below.

### Alternative: Quo (formerly OpenPhone)

Best mobile experience by a distance, and calls and texts live in one product.
Starter $15/user/mo annual ($19 monthly), shared numbers capped at 10 members;
Business $23/user/mo annual ($33 monthly), unlimited members on a shared number.
Extra numbers $5/mo each.

The tradeoff is the structural one above: you port the number in, and Twilio is
no longer directly in the path. Phase 2 then runs through their API and Zapier,
which is workable but less direct.

**Pick Quo if** the office lives on phones and calls matter more than automation.
**Pick Missive if** you intend to build the Phase 2 routing. Given what you
described wanting next, that's Missive.

### Front

Also supports a Twilio SMS channel and has the strongest rules engine of the
three. Costs more and is heavier than a six-person office needs. Worth a look
only if you outgrow Missive.

### Before you sign anything, test the audit trail

Every vendor says "audit log." They mean different things. Run these four checks
during the trial, because you specifically asked for this:

1. Two people reply to the same thread. Does the log show *both* names, or just
   the number?
2. Someone edits a contact's tag from "prospect" to "current tenant." Is that
   recorded, with who and when?
3. Someone deletes a message or a conversation. Is the deletion itself logged?
4. Export the log. Is it a real export, or a screen you can only read?

If #3 and #4 fail and you need the record for eviction or fair-housing disputes,
that's an argument for Option C.

---

## Calls: how "who answered" actually works

Texting is the easy half. Shared *calling* has a specific gotcha worth knowing
before you set it up.

If you simultaneously ring several employees' cell phones, the call goes to
whichever phone answers first — and a phone that's off or out of service answers
instantly with its **personal voicemail**. Your tenant leaves a message on an
employee's private voicemail and nobody ever hears it. This is the single most
common failure in DIY ring groups.

The fix is a whisper with an accept key. Twilio's `<Number>` verb takes a `url`
that runs on that leg *before* the call bridges:

```xml
<Response>
  <Dial timeout="20" callerId="+1LARABEE" answerOnBridge="true"
        action="/voice/after-dial" record="record-from-answer-dual">
    <Number url="/voice/whisper?staff=amy"  statusCallback="/voice/leg">+1AMY</Number>
    <Number url="/voice/whisper?staff=joe"  statusCallback="/voice/leg">+1JOE</Number>
  </Dial>
  <Redirect>/voice/voicemail</Redirect>
</Response>
```

`/voice/whisper` returns:

```xml
<Response>
  <Gather numDigits="1" action="/voice/accept?staff=amy">
    <Say>Larabee Homes call. Press one to accept.</Say>
  </Gather>
  <Hangup/>
</Response>
```

A voicemail box can't press 1, so it never steals the call. The `DialCallSid` and
`To` on the `action` callback tell you exactly which leg won — that *is* your
"who answered" record. Write it to the `calls` table.

Two more notes:

- `record="record-from-answer-dual"` gives you separate channels per party, which
  matters if you ever need to prove what was said. **Check your state's recording
  consent law first** — two-party-consent states require an announcement at the
  top of the call. Add one; it costs you nothing.
- If you'd rather not forward to personal cells at all, give each employee a
  Twilio Client identity and dial `<Client>` instead. Attribution is exact and
  nobody's personal number is exposed.

Quo handles all of this natively. That's its real argument.

---

## Option C — build the whole thing

Worth it if you want to own the data, if the audit-trail tests above failed, or
if you'd rather have one app than four subscriptions. Not worth it just to save
$150/month.

### Stack

- **Next.js on Vercel** — API routes take the Twilio webhooks, same deploy serves
  the UI.
- **Supabase** — Postgres, Auth, Row Level Security, and Realtime. Realtime is
  the piece that makes a shared inbox feel shared: the thread updates on every
  screen at once, so two people don't reply simultaneously.
- **Twilio Messaging Service** (not the bare number). It handles STOP/HELP and
  the opt-out list for you, and it's where 10DLC campaign registration attaches.

This is a real departure from the single-file `localStorage` tools already in
this repo. It has to be: Twilio has to reach a public URL, and the whole point is
that the data is shared, not on one laptop.

### Schema

See `schema.sql` in this folder. The shape:

- `contacts` — one row per phone number, E.164, with a party type and links to
  properties/units.
- `conversations` — the unit of work. Carries `category`, `status`, `assigned_to`,
  `last_message_at`. This is what you group by.
- `messages` — every inbound and outbound message, with `twilio_sid` unique for
  idempotency and `sent_by` naming the employee.
- `calls` — direction, `answered_by`, duration, recording, voicemail transcript.
- `notes` — internal only. Never leaves the building.
- `audit_log` — append-only, written by database triggers rather than app code,
  so it can't be bypassed by a bug or a clever query.
- `work_orders`, `showings`, `templates`, `consent`.

### The inbound webhook, in order

1. **Validate `X-Twilio-Signature`.** Not optional. Without it your endpoint is a
   public API for anyone who guesses the URL.
2. **Check `MessageSid` against `messages`.** Twilio retries on any non-2xx, and
   duplicated tenant messages are worse than a dropped one.
3. Upsert the contact by E.164.
4. Find the open conversation for that contact, or open one.
5. Insert the message.
6. Classify if the conversation is new (below).
7. Return 200 fast. Do the slow work — notifications, classification — after the
   response or on a queue. Twilio's webhook timeout is short.

### Auto-classification

On the first message of a new thread, send the body plus the contact's known
history to the Claude API and ask for structured output: category, urgency,
property/lot if mentioned, and a one-line summary. Route on that. Keep a
confidence threshold — below it, drop the thread in an unassigned queue rather
than guessing wrong and routing a burst pipe to the leasing folder.

Keep a keyword fast path in front of it anyway. "No heat," "water," "leak," and
"lockout" should never wait on an API call.

---

## Phase 2a — dispatch to techs

Once a thread is classified `maintenance`:

1. Create a `work_order` linked to the conversation and the unit. MMS photos from
   the tenant attach here — this is worth a lot on its own.
2. Text the assigned tech **from a second Twilio number**, not the main line, so
   their replies don't land in the tenant inbox. Extra numbers are about
   $1.15/mo.
3. Tech replies with a short code: `ACCEPT`, `ETA 3PM`, `DONE`, `PARTS`. Parse it,
   update the work order, and post the state change back into the tenant thread
   as an internal note so the office sees it without the tenant seeing it.
4. Nobody accepts within N minutes, escalate to the next tech and flag it.

The reason to use a separate number is worth stating plainly: one number for
"people we serve," one for "people who work for us." Mixing them creates exactly
the confusion the shared inbox was supposed to remove.

---

## Phase 2b — prospects, prequalification, showings

**Don't build this on Calendly.** Calendly is a meeting scheduler. It doesn't
prequalify, doesn't scope availability per property, doesn't issue lockbox codes,
and doesn't know what a rental application is. You'd be rebuilding a rental
leasing product on top of it.

Buy the rental-specific tool instead:

- **Tenant Turner** — prospect prescreening against your criteria before booking,
  so unqualified leads never reach the calendar. Self-showing and smart-lock
  integration.
- **ShowMojo** — Pro from $1.43/unit/mo; Ultra from $2.97/unit/mo, which adds
  two-way texting and per-listing tracking numbers. Automated confirmations,
  reminders, and follow-ups are built in.
- **Rently** — prequalification questions plus ID check and a credit-card hold
  before an access code is issued. Strongest access control of the three.

At per-unit pricing this is cheap next to the build, and it replaces the entire
prequalify → schedule → confirm → remind chain you described, including the
confirmations to both the prospect and your shower.

Where you still write code: a webhook from the showing tool back into your system
so the showing lands on the conversation timeline and the office sees the whole
history in one place. That's a small job.

**Set the prequalification criteria in writing before you automate them, and
apply them identically to everyone.** Consistent, templated, logged responses to
prospects are a genuine fair-housing asset — you can show exactly what every
applicant was asked and told. Inconsistent ad-hoc texting is the opposite.

---

## Compliance — the parts that will actually bite you

**A2P 10DLC registration is separate from buying the number.** Having a Twilio
number does not mean you're registered to send business texts. Without an
approved brand and campaign, AT&T, T-Mobile, and Verizon filter or block you, and
you'll spend a week thinking your code is broken.

- Brand: $4 sole proprietor, $48+ standard.
- Campaign: roughly $15–17 to register, then a monthly renewal of $1.50–10
  depending on use case. "Low Volume Mixed" is the cheap tier and likely fits.
- Carrier surcharges: $0.003–0.005 per outbound segment on top of Twilio's rate.
  T-Mobile raised these in January 2026.

Do this first. It takes days to approve, not minutes.

**Opt-outs.** Use a Messaging Service and Twilio maintains the STOP list for you.
If you build your own sender, you must honor STOP yourself and you must not route
around it. Log the opt-out and the source of consent in the `consent` table.

**Quiet hours.** TCPA restricts texting to 8am–9pm in the *recipient's* local
time. Maintenance replies to an inbound message are fine; outbound prospect
follow-ups at 7am are not. Put the check in the send path, not in a policy doc.

**Call recording consent.** Varies by state. If you're in or call into a
two-party-consent state, announce it. One `<Say>` at the top of the flow.

**Retention.** These logs get subpoenaed in eviction and discrimination disputes.
Decide the retention window deliberately and make sure your vendor can export.
Never delete individual messages to tidy up a thread.

---

## Costs

Six employees, roughly 3,000 texts and 600 call-minutes a month.

| Path | Monthly |
| --- | --- |
| **Buy:** Missive Productive ×6 @ $24 | $144 |
| Twilio number + SMS + 10DLC campaign + surcharges | ~$50 |
| Voice (forwarded calls bill both legs, ~$0.022/min) | ~$15 |
| **Buy subtotal** | **~$210** |
| | |
| **Buy + Quo instead of Missive** (Business ×6 @ $23) | ~$140 all-in |
| | |
| **Build:** Vercel Pro $20 + Supabase Pro $25 | $45 |
| Twilio (same as above) | ~$65 |
| **Build subtotal** | **~$110/mo + your build time** |
| | |
| **Showings:** ShowMojo Ultra, ~60 units @ $2.97 | ~$180 |

Building saves roughly $100/month against Missive and costs you weeks of work
plus permanent maintenance. That math only turns in your favor at scale, or if
you need something the vendors genuinely can't do.

---

## Suggested 30 days

The ordering matters — 10DLC gates everything, so it goes first even though it's
the least interesting step.

1. **Days 1–3.** File A2P 10DLC brand and campaign registration. Create a
   Messaging Service and put the number in it. This is the long pole.
2. **Days 3–5.** Start the Missive trial, connect the Twilio number, invite the
   office. Run the four audit-trail tests.
3. **Week 1.** Agree the label set — maintenance, prospect, current tenant,
   vendor, collections — and write five canned responses. Keep the list short;
   labels nobody applies are worse than no labels.
4. **Week 2.** Stand up the voice ring group with the press-1 whisper. Record a
   real voicemail greeting. Confirm every employee's leg reports correctly.
5. **Week 3.** Pick a showing tool, load one property, run a real prospect
   through it end to end before you point any marketing at it.
6. **Week 4.** Build the smallest useful automation: classify inbound, auto-label,
   and dispatch maintenance to the tech's number. Nothing else.

Resist bundling steps 5 and 6 into week 1. The habit of everyone working out of
one inbox is the change that actually removes your bottleneck; the automation is
a multiplier on a habit that has to exist first.
