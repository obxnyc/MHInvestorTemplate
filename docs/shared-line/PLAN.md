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
| Prequalify a prospect against your own metrics | Build |
| Calendar, availability, reminders once they qualify | Buy (Cal.com) |

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
   $1.15/mo — but confirm your campaign type allows a second registered number
   first (see the Sole Proprietor note under Compliance). If it doesn't, route
   techs by sender identity on the single number instead.
3. Tech replies with a short code: `ACCEPT`, `ETA 3PM`, `DONE`, `PARTS`. Parse it,
   update the work order, and post the state change back into the tenant thread
   as an internal note so the office sees it without the tenant seeing it.
4. Nobody accepts within N minutes, escalate to the next tech and flag it.

The reason to use a separate number is worth stating plainly: one number for
"people we serve," one for "people who work for us." Mixing them creates exactly
the confusion the shared inbox was supposed to remove.

---

## Phase 2b — prospects, prequalification, showings

**Build the rules. Don't build the calendar.**

The screening logic is yours and should be — a form capturing credit score,
monthly household income, other income sources, and rental history, scored
against your metrics, with three outcomes: book straight through, route to human
review, or decline. No off-the-shelf product will encode your thresholds as
faithfully as you will, and this is the part that actually removes humans from
the loop. Build it.

What you shouldn't build is availability management, double-booking prevention,
timezone handling, reschedules, cancellations, and reminder delivery. That's a
solved, boring, surprisingly deep problem.

### The handoff

Use **Cal.com**, not Calendly. The difference that matters: Cal.com has advanced
private links — a booking URL that only works for the person you issued it to and
can be made single-use. That is exactly the gate your design needs. A prospect
can't reach the calendar without passing your rules, because the link doesn't
exist until they do. Calendly's links are public by default; you'd be
reimplementing the gate in front of it.

It also has a proper API v2 with signed webhooks (`X-Cal-Signature-256`, HMAC-SHA256
over the raw body) and a self-host option if you'd rather own the data. Note that
API v1 is discontinued as of February 28, 2026 — build against v2.

Flow:

1. Prospect fills your form. You write a `prequal_submission` with their raw
   answers, untouched.
2. Your rule set evaluates it and returns a per-criterion verdict plus reason
   codes. Store the whole thing, including which rule set version ran.
3. **Pass** — mint a Cal.com private link scoped to that property, text it to
   them, done. No human touched it.
4. **Marginal** — open a conversation in the review queue with the reason codes
   attached, so whoever picks it up sees exactly which criterion was short and by
   how much.
5. **Decline** — send the decline copy (see below), and record it.
6. Cal.com webhook `BOOKING_CREATED` fires back to you. Write the `showing`,
   confirm to both the prospect and the assigned shower, and schedule the T-24h
   and T-1h reminders.

### Rules as data, not code

Put the thresholds in a versioned table, not in an `if` statement. Two reasons,
and the second one is the important one:

- You change criteria without a deploy.
- **Every decision records the rule set version that produced it.** When someone
  asks why an applicant was declined in March, you can reconstruct the exact
  ruleset that ran, rather than reading current code and hoping it hasn't
  changed. This is the difference between an audit trail and a guess.

```json
{
  "version": 4,
  "effective_from": "2026-09-01",
  "criteria": [
    { "key": "income_ratio",       "basis": "tenant_share",
      "pass": ">= 3.0",  "marginal": ">= 2.5" },
    { "key": "credit_score",       "source": "self_reported",
      "pass": ">= 620",  "marginal": ">= 560" },
    { "key": "rental_history_months",
      "pass": ">= 24",   "marginal": ">= 12" },
    { "key": "years_since_eviction_judgment",
      "pass": ">= 5",    "marginal": ">= 3" }
  ]
}
```

Resolution is deliberately simple, and simple is the point — it's explainable to
a regulator:

- any criterion **fails** → decline
- otherwise any criterion **marginal** → human review
- all **pass** → issue the booking link

Resist the urge to build a weighted composite score. A single number is harder to
explain, harder to defend, and hides which criterion actually drove the outcome.
Per-criterion verdicts with reason codes give you the same routing and a real
explanation.

### Four things that will get you sued if you build this naively

Automated screening is legal and common. It is also the subject of **HUD's 2024
FHEO guidance on tenant screening that relies on algorithms and AI**, and of
active litigation — the SafeRent case turned on a screening algorithm's disparate
impact on Black and Hispanic applicants. Since you're automating, you're in
scope. Four specifics:

**1. Count all lawful income, and compute the ratio on the tenant's share.**
Many states and cities protect source of income as a class, which means voucher,
SSI, disability, and child support income all count. More subtly: if a prospect
has a Housing Choice Voucher and pays 30% of rent, applying a 3× multiplier to
the *full* rent screens out nearly every voucher holder and is a textbook
disparate-impact claim. California's rules already require minimum-income tests
to use only the tenant's share. Set `"basis": "tenant_share"` and mean it.

The gap isn't marginal, it's decisive. A real case, run against the schema in
this folder:

| | |
| --- | --- |
| Rent | $1,200 |
| Voucher covers | $840 |
| Applicant pays | $360 |
| Applicant earns | $1,400/mo |
| Ratio vs **full rent** | **1.17×** — declined |
| Ratio vs **tenant's share** | **3.89×** — comfortably qualifies |

Same applicant, same 3× threshold, opposite outcomes. The naive denominator
doesn't screen out people who can't afford the home; it screens out voucher
holders as a class. That is the disparate impact, and it's one line of SQL.

**2. Your decline copy is the riskiest text in the whole system.** "We don't have
anything that's a fit right now, keep checking our availability" tells the
applicant the *unit is unavailable*. If it's actually available and you told a
qualified applicant otherwise, that's an availability misrepresentation — the
single most common thing fair-housing testers are sent to catch, and it looks
terrible precisely because your logs will show the unit was open and someone else
got booked into it the same day.

Say the criteria instead:

> Thanks for your interest in [address]. Based on what you shared, this home
> isn't a match for our current rental criteria — we look for household income of
> at least 3× the rent you'd pay, a credit score of 620 or above, and 24 months of
> rental history. You're welcome to apply again with a co-signer or additional
> income documentation, and our full criteria are at [link].

Longer, less comfortable to send, and dramatically safer. It's truthful, it's
identical for everyone who fails the same way, and it gives the applicant a real
path forward.

**3. Publish the criteria before you apply them.** A public page listing your
thresholds, dated and versioned, is the cheapest defense you can buy. Consistency
you can *demonstrate* is the entire ballgame; the audit log plus a published
ruleset is a much stronger position than most landlords can produce.

**4. The human review tier is where bias sneaks back in.** You've built a
consistent automated path and then routed the ambiguous cases to human
discretion. Give reviewers written criteria for that tier too, require a reason
code on every decision, and log who decided. Otherwise the marginal queue becomes
the unexamined gap in an otherwise defensible process.

One thing your design already gets right, and it's worth knowing why: because the
credit score is **self-reported on your form** rather than pulled, the prescreen
isn't a consumer report and an automated decline at this stage isn't an FCRA
adverse action. That's a real advantage — it's why prescreening on self-reported
data is cleaner than running credit up front. FCRA does attach later, when you
pull an actual report at application: a denial then requires an adverse action
notice naming the reporting agency and the applicant's right to dispute. Keep the
two stages clearly separate in the code and in your head.

None of this is legal advice, and the source-of-income rules in particular are
intensely local. Have a fair-housing attorney read the ruleset and the decline
copy once, before it sends a single message. It's an hour of their time against a
category of claim that routinely costs six figures.

## Phase 3 — re-engaging past inquiries

Retaining everyone who inquired and reaching back out at 8 and 11 months, when
their 12-month lease is coming up for renewal. The timing logic is sound and
it's the cheapest lead source you'll ever have.

It's also the first thing in this plan that is unambiguously **marketing** rather
than conversation, which puts it in a different legal category from everything
above. Design, message copy, consent capture, the reassigned-number trap, and
the fair-housing constraint on who you market to: **see `NURTURE.md`.**

The one-line version: **send it over email, not text.**

---

## Compliance — the parts that will actually bite you

**Your brand and campaign are approved — that clears the long pole.** Three
things are still worth confirming, because an approved campaign that isn't
wired to the number you're actually sending from still gets filtered, and the
symptom looks exactly like a bug in your code.

Run `preflight.sh` in this folder against your account, or check by hand:

1. **Is the number in the Messaging Service the campaign is linked to?** The
   campaign attaches to a Messaging Service, not to a number. A number sitting
   outside that service's sender pool shows as `UNREGISTERED` and gets filtered
   even though the campaign says approved. This is the single most common
   version of "approved but still blocked."
2. **Which use case did you register?** This constrains what you're allowed to
   send — see the warning below. It's the one that will actually limit Phase 2.
3. **What throughput did you get?** Message-per-second and daily caps depend on
   brand vetting score. Fine for conversation; it's bulk sends that hit the
   ceiling.

Ongoing costs, now that registration is behind you: campaign renewal of
$1.50–10/mo depending on use case, plus carrier surcharges of $0.003–0.005 per
outbound segment on top of Twilio's rate. T-Mobile raised those in January 2026.

### If you registered as a Sole Proprietor, read this before Phase 2a

A Sole Proprietor campaign can register **exactly one number**. If that's what
you have, the second number I recommended for tech dispatch isn't available to
you — adding another number to the sender pool doesn't register it, and Twilio
will pick one at random to register if the pool has several.

Three ways around it, cheapest first:

- **Keep one number and separate by convention.** Techs get a distinct reply
  vocabulary (`ACCEPT`, `DONE`) and your webhook routes on sender identity —
  a known tech's phone number never opens a tenant conversation. Costs nothing,
  works fine at six employees.
- **Don't text techs at all.** Push notifications through the app you build, or
  email. Techs are staff, not customers; they don't need to be on the A2P line.
- **Re-register as a Standard brand** ($48+) if you want multiple registered
  numbers. Worth it if you're adding numbers per property or per campaign later.

Check which you have before you build the dispatch flow. It's a five-minute
check that saves a rebuild.

### Your registered use case is a ceiling on Phase 2

The campaign you registered declares what kind of messages you send, and carriers
enforce it. Traffic that doesn't match what you described is what gets you
filtered *after* approval — and the mismatch is usually invisible until volume
picks up.

The distinction that matters for you is **conversational versus lead
generation**:

- Answering a tenant who texted you first is conversational. Nothing about that
  is at risk under any use case.
- Texting a prospect who filled in a web form is a different animal, and texting
  a lead list you bought or scraped is a different animal again.

If you registered a narrow customer-care use case, the Phase 2b prospect
follow-ups — showing invitations, "still interested?" nudges, vacancy
announcements — may fall outside it. A mixed use case generally covers both.
Pull up the campaign's registered description and message samples and compare
them against the automated messages you're planning to send. If the samples you
submitted are all "your work order is scheduled" and you're about to start
sending "we have a 3-bedroom opening on Tuesday," amend the campaign before you
build it, not after carriers start dropping traffic.

The same split governs your TCPA exposure, which is the more expensive risk.
Replying to an inbound message is safe ground. Initiating contact with a
prospect needs prior express consent, captured and logged with its source — the
`consent` table exists for exactly this. Do not import an old lead list into the
new number and start texting it.

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
| **Showings:** Cal.com Teams, 2 seats @ $15 (or $0 self-hosted) | ~$30 |

Building saves roughly $100/month against Missive and costs you weeks of work
plus permanent maintenance. That math only turns in your favor at scale, or if
you need something the vendors genuinely can't do.

---

## Suggested first three weeks

Registration is done, which pulls the whole plan forward by a week. The
sequencing that's left is about habit before automation.

1. **Day 1.** Run the preflight check. Confirm the number is in the campaign's
   Messaging Service, note the registered use case, note the throughput, and
   confirm whether you're Sole Proprietor or Standard.
2. **Day 1.** Start the Missive trial, connect the Twilio number, invite the
   office. You can do this the same afternoon.
3. **Days 2–5.** Run the four audit-trail tests. Agree the label set —
   maintenance, prospect, current tenant, vendor, collections — and write five
   canned responses. Keep the list short; labels nobody applies are worse than
   no labels.
4. **Week 2.** Stand up the voice ring group with the press-1 whisper. Record a
   real voicemail greeting. Confirm every employee's leg reports correctly.
5. **Week 2.** Write the ruleset down as data and have a fair-housing attorney
   read it and the decline copy. Publish the criteria page. Stand up Cal.com with
   one property and book a test showing end to end.
6. **Week 3.** Build the smallest useful automation: classify inbound, auto-label,
   dispatch maintenance to whichever channel your campaign type allows, and wire
   the prequal form to the ruleset with all three outcomes logging reason codes.

Resist pulling steps 5 and 6 into day one. The habit of everyone working out of
one inbox is the change that actually removes your bottleneck; the automation is
a multiplier on a habit that has to exist first.
