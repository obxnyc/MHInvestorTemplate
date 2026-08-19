# Re-engaging past inquiries

Retaining everyone who ever asked about housing, then reaching back out when
their current lease is running down.

Companion to `PLAN.md`. Written August 2026.

---

## The idea is right, and the timing logic is better than you think

Most people sign a 12-month lease. Someone who inquired in March and leased
somewhere else in April is deciding whether to renew around the following
February — because renewal notice periods are typically 60 days, the decision
lands *before* the lease actually ends. Your instinct to touch at 8 and 11
months is well-aimed: the 11-month touch is the real one, and the 8-month touch
exists to arrive before the renewal conversation starts rather than after.

This is also the cheapest lead source you will ever have. These people already
raised their hand, already know who you are, and cost you nothing to acquire a
second time.

So build it. But the channel you build it on decides whether it's a marketing
program or a liability, and that's the whole substance of this document.

---

## Anchor on the outcome, not just the date

A timestamp alone will send follow-ups to people who bought a house. Capture
*why* the inquiry ended, and branch:

| Outcome | What happens |
| --- | --- |
| Leased with us | Different track entirely — that's renewal retention, not re-acquisition |
| Leased elsewhere | **The core case.** Touch at 8 and 11 months from inquiry |
| Wrong location / too far | Nurture, but only on new availability near them |
| Price wasn't right | Nurture, and lead with what's in their range |
| Bought a home | **Suppress permanently** |
| Relocated out of area | **Suppress permanently** |
| Didn't qualify | See the fair-housing note below |
| Went quiet, no outcome known | Treat as leased elsewhere; it's the safe assumption |

"Went a different direction" is doing a lot of work in your description, and it
splits into at least three of those rows. Ask the question explicitly on the way
out — a single "mind telling us what you ended up doing?" text closes the loop
and is worth more than any inference you could make from silence.

Capture what they wanted, too — bedrooms, price ceiling, area, pets, move-in
window. Then a new vacancy is a query, not a blast: everyone who wanted 3
bedrooms under $1,400 near this park. Better response rates and a much better
compliance posture, because you're matching on stated preferences rather than
guessing.

---

## Send this over email, not text

This is the single most important decision in the whole feature, so it gets its
own section.

An 11-month-later "are you looking again?" is **marketing**, not conversation.
That puts it in a different legal category from everything else in `PLAN.md`,
where you were replying to people who texted you first.

**The exposure is per message and uncapped.** TCPA statutory damages are $500
per message, $1,500 if willful, with no cap. Five hundred archived inquiries is
a $250,000 mailing. There is an active plaintiffs' bar that looks for exactly
this pattern, and re-engagement campaigns against year-old lists are the
archetypal fact pattern.

**Email is a fundamentally cheaper mistake.** CAN-SPAM has no private right of
action and no per-message statutory damages to a plaintiff. You need a working
unsubscribe, a real physical mailing address, honest headers, and opt-outs
honored within 10 business days. That's a checklist, not a lawsuit.

So:

- **Email carries the nurture program.** Long-cycle follow-ups, new-availability
  notices, the 8- and 11-month touches.
- **SMS stays conversational and transactional.** Replies, showing
  confirmations, work-order updates — things the person just asked for.
- **SMS nurture only for people who explicitly ticked a marketing-texts box**,
  and even then, treat it as a small high-intent segment rather than the default.

You lose some reach. You lose vastly more if one of these lands on a plaintiff.

---

## The reassigned number problem

This is the specific trap in an 8-to-11-month delay, and it deserves naming
because it defeats the defense you think you have.

Phone numbers get recycled. The number that consented in March may belong to a
different person by February. That person never consented, so your consent
record doesn't protect you — you have a documented intent to text a stranger.
The longer your delay, the more of your list has quietly turned over. An 11-month
campaign is the worst case by design.

The FCC built the **Reassigned Numbers Database** for exactly this, and it comes
with an actual safe harbor: query the number, get back "not disconnected," send
promptly, and you're protected from liability if it turns out to have been
reassigned anyway. Administered by SomosGov at
[reassigned.us](https://www.reassigned.us/about).

It is cheap. The extra-small tier runs about **$10 for 1,000 queries a month** —
comfortably more than your entire archive, for the price of lunch.

Two limits worth knowing:

- The safe harbor covers **only the first contact after the check**. Re-query
  before each campaign; don't check once and text for a year.
- It protects you on reassignment specifically. It does nothing about whether
  the original consent was valid.

If you send any SMS to a contact older than about 90 days, query the RND first
and **log the query and its response**. An unlogged check is not a safe harbor,
because you can't prove it happened.

---

## Consent, captured properly at the front door

The inquiry form is where this is won or lost. Retrofitting consent onto an
archive is not possible.

- **Two separate checkboxes, neither pre-ticked.** One for transactional
  messages about their inquiry, one for marketing about future availability.
  Bundling them is the most common defect.
- **Log the exact disclosure text they saw**, verbatim, along with timestamp, IP,
  and user agent. Not "consent: true" — the actual sentence. When this is
  challenged in three years, the form will have been redesigned twice, and the
  only thing that matters is what *this* person was shown on *that* day.
- **Version the form copy** the same way you version the screening ruleset, and
  for the same reason.

On revocation: rules effective **April 11, 2025** require honoring opt-outs made
by **any reasonable method**, within **10 business days**, and **across
channels**. "STOP" to your texts, "unsubscribe" in an email, or "quit texting me"
said out loud to whoever answers the phone all count, and one of them means all
of them. Your `consent` and `audit_log` tables need to reflect that a
conversational opt-out flips the marketing flag too. The Do Not Call registry now
covers texts as well.

**The law here is actively moving.** The FCC's one-to-one consent rule was
vacated by the Eleventh Circuit in January 2025 and formally eliminated that
September; in March 2026 the Fifth Circuit rejected the prior-express-written-
consent rule. The direction of travel is arguably looser, but relying on that
while it's unsettled is a bad trade for a business your size. Build to the
stricter standard — separate written consent for marketing — and you're
insulated from whichever way it lands.

---

## Two fair-housing notes

**Don't suppress the "didn't qualify" group on the quiet.** If your nurture list
is everyone-who-inquired *minus* the people your screening declined, and your
screening criteria correlate with a protected class — credit thresholds
demonstrably do — then you've built a marketing program that systematically
excludes that class from hearing about available housing. That's a discriminatory
advertising claim, and it's a separate violation from anything in the screening
itself.

Safest posture: **market availability broadly to everyone who consented and
hasn't opted out**, and let the prequalification engine do the screening when
they respond. The engine is documented, versioned, and defensible. Silent list
suppression is none of those things.

**Segment on stated preferences only.** Bedrooms, price range, area, pets,
move-in timing — things they told you. Never on anything inferred, and never on
anything that proxies for family status, national origin, or disability.
"Families with kids" is not a segment. "Wanted 3+ bedrooms" is.

---

## The messages

Yours was close. Three changes: identify yourself in the first clause, make
declining genuinely easy, and give them something concrete rather than a survey
question.

**Email, month 11:**

> Subject: Still looking for a place around [area]?
>
> Hi [First],
>
> You reached out to Larabee Homes last [Month] about a rental in [area]. If
> you're on a 12-month lease, you may be thinking about what's next right about
> now.
>
> Here's what we expect to have available in the next 60 days:
>
> - [Address] — 3 bed, $1,350/mo, available [date]
> - [Address] — 2 bed, $1,150/mo, available [date]
>
> If the timing isn't right, no problem at all — [unsubscribe] and we'll leave
> you alone.
>
> [Name], Larabee Homes · [phone] · [physical address]

The concrete listings are the point. "Are you in the market?" asks them to do
work; two addresses with prices lets them decide in four seconds.

**SMS, month 11 — only for contacts who ticked the marketing box:**

> Larabee Homes here — you asked about a rental last [Month]. We have a 3BR at
> [street] opening [month] at $1,350. Want details? Reply STOP to opt out.

Under 160 characters, names the business immediately, one concrete unit, opt-out
in the message.

**Month 8** is the same shape with softer framing — "we're planning what's coming
open next spring, want us to keep you posted?" It's a permission refresh as much
as a pitch, and a reply to it is fresh consent, which is worth having.

---

## Things that will quietly break this

- **Don't backfill.** Do not import your existing archive of inquiries into this
  and start sending. Those people were never shown a consent disclosure. Start
  the program with people who come in through the new form, and let it fill up
  over the year. Painful, correct.
- **Your A2P campaign use case has to cover marketing.** A customer-care campaign
  does not, and carriers will filter this traffic regardless of what the TCPA
  says. See the use case section in `PLAN.md`.
- **Quiet hours still apply** — 8am to 9pm in the recipient's local time, and a
  scheduled job at 6am is exactly how that gets violated. Put the check in the
  send path.
- **Suppress on any inbound signal.** Someone who replied "we bought a house"
  should never see touch two. Parse the replies; a nurture message that ignores
  the answer to the last one reads as a robot and generates complaints, which
  generates carrier filtering.
- **Cap the frequency.** Two touches per cycle, plus availability notices that
  actually match their stated preferences. This list's value is that it's warm;
  over-mailing is how it stops being warm.

---

## Schema

Tables are in `schema.sql`: `inquiries`, `nurture_touches`,
`reassigned_number_checks`, and an extended `consent` that records channel,
purpose, and the verbatim disclosure text. The scheduling query is a single
select over `inquiries` joined against suppressions — the interesting logic is
all in what you refuse to send, not in what you send.
