# Working agreements

## Give the whole link, never a path

When there is something for the owner to go and do, write the full clickable
URL. Not `/setup`, not "the setup page" — the address, in full, on its own
line. A path is a thing you have to assemble, and assembling it wrong is how
an evening gets spent on a 404.

This cost a real hour: a dead hostname was lifted out of `.env.example` and
handed over as though it were the live site, and three rounds of instructions
were aimed at a domain that does not resolve.

### The live site

```
https://mh-investor-template.vercel.app
```

| Page | Link |
| --- | --- |
| Home dashboard | https://mh-investor-template.vercel.app/home |
| Messages (shared line) | https://mh-investor-template.vercel.app/ |
| Team chat | https://mh-investor-template.vercel.app/team |
| Jobs | https://mh-investor-template.vercel.app/jobs |
| Properties | https://mh-investor-template.vercel.app/properties |
| Setup check | https://mh-investor-template.vercel.app/setup |
| Which build is live | https://mh-investor-template.vercel.app/api/whoami |

`inbox.larabeehomesllc.com` in `.env.example` and the README is a placeholder
and has never resolved. `app.larabeehomesllc.com` already points at Vercel and
is the domain the owner wants; DNS for `larabeehomesllc.com` is at Squarespace.

### Vercel

Team slug `larabee-inbox`, project `mh-investor-template`.

| Screen | Link |
| --- | --- |
| Environment variables | https://vercel.com/larabee-inbox/mh-investor-template/settings/environment-variables |
| Deployments | https://vercel.com/larabee-inbox/mh-investor-template/deployments |
| Domains | https://vercel.com/larabee-inbox/mh-investor-template/settings/domains |
| Runtime logs | https://vercel.com/larabee-inbox/mh-investor-template/logs |

Not https://vercel.com/dashboard, and not the team-wide Environment Variables
page in the left sidebar — that one lists every project's variables and has no
Add button, which cost a round trip.

`ANTHROPIC_API_KEY` exists three times, one per environment. Production is the
one that matters; replacing only Development changes nothing and reads as the
fix having failed.

### Supabase

Organisation **Larabee-inbox**, project **Larabee-inbox**, on the Free plan.
The branch is `main`, marked PRODUCTION. Still no project ref, because the
screenshot that gave the names was of the app and not of the address bar --
so https://supabase.com/dashboard/projects plus the clicks, and ask for the
address bar when they land.

The SQL editor is the second-to-top icon in the far-left rail. The Run button
is top right; the right answer to a migration is `Success. No rows returned`.

**Every migration raises "Potential issue detected".** The editor flags any
query containing `alter`, `drop` or `update`, and a migration contains all
three by definition. Say so in the same message as the link, before they hit
it -- a warning nobody warned them about reads as "I have been handed
something dangerous", and stopping to ask costs a round every time.

Then say what the destructive-looking lines actually are, in one sentence, so
the reassurance is checkable rather than just confident.

### A filename is not a thing to paste

"Paste in `docs/shared-line/037-....sql`" came back as that path typed into
the SQL editor and a `syntax error at or near "docs"`. Of course it did: the
only thing in the message that looked like something to copy was in a code
block, and a code block says copy me.

The owner has no checkout. A path means nothing on their machine, and asking
for file CONTENTS by naming the file is asking them to do a step that does not
exist for them.

So: link the file on GitHub and say which button copies it.

https://github.com/obxnyc/MHInvestorTemplate/blob/main/docs/shared-line/037-the-vacancy-clock-and-the-inquiry.sql

The copy icon is the two overlapping squares at the top right of the file,
beside the download arrow. One press puts the whole file on the clipboard,
which beats four hundred lines of SQL in a chat message and beats a path
every time.

The general rule, and it is the same one as the whole-link rule at the top:
**anything the owner has to go and do must be a thing they can click or copy,
not a thing they have to assemble.** A repo path is an instruction to a person
with the repo open. Nobody reading these messages has the repo open.

### The rule when an id is missing

Give the top-level link plus the clicks, say why it cannot be exact, and ask
the owner to paste the address bar when they land. Then write it down here.

## Shipping

The site deploys from `main`. Pushing the feature branch alone changes nothing
the owner can see; the merge is what ships it. Standing permission to merge
`claude/twilio-shared-number-property-4i3yu1` into `main`.

**A merge is not a deployment.** Vercel builds when GitHub's webhook tells it
to, and that webhook does not always arrive -- during a GitHub outage it does
not arrive at all. Eleven commits sat on `main` through a whole session while
the live site served a build from fourteen hours earlier, and every screen
written in that session was a 404 nobody had looked at.

Nothing about that is visible from here: this machine cannot reach
mh-investor-template.vercel.app, so "I merged it" is the last thing Claude can
honestly say about whether something shipped.

So **before telling the owner to go and look at a new screen, ask them for**
https://mh-investor-template.vercel.app/api/whoami **and compare the commit to
`git log origin/main -1`.** That page exists for exactly this and it was in
this file the whole time -- three rounds were spent on "it is probably still
building" and "it is probably your browser" when one link would have answered
it in the first.

When they do not match, the fix is **Create Deployment** in the left sidebar
of https://vercel.com/larabee-inbox/mh-investor-template/deployments. It
builds what is actually on the branch and owes nothing to the webhook.

**Put `main` in that box, not a commit SHA.** Every commit here exists on
both `main` and the feature branch it was merged from, and Vercel resolves a
SHA to whichever branch it likes -- it picked the feature branch, warned
"this commit exists on multiple branches", and offered only **Create Preview
Deployment**. A preview is not the live site. The branch name gives **Deploy
to Production**, which is the button that matters.

The Create Deployment dialog is also the only place the real build error is
printed. The deployments list showed a failed cron deployment as an
unexplained Preview row; the dialog said "Hobby accounts are limited to daily
cron jobs" in full. **When a deployment is not happening and the list does not
say why, open that dialog.**

The general shape, and it is the oldest one in this file: **silence and
success look identical.** A merge that shipped and a merge that went nowhere
are the same thing on this end. Ask the deployment which it was.

## Instructions

Short. One task at a time, not a numbered plan with branches in it.

Links go inline in the sentence, as ordinary clickable text. Not in a fenced
code block -- a block says "this is something to copy", and a link is something
to click. Code blocks are for what gets typed or pasted: SQL, a variable name,
a value.

Say which screen, which button, and what the right answer looks like. Leave out
the reasoning unless it changes what they do.

## Laying out a park, or anything else drawn from a map

This took sixteen rounds and it should have taken one. Almost none of that
was the owner's fault: the instructions that were missing are ones Claude
should have asked for before writing a line, and the question "what should
I have told you?" has a short answer and a longer one.

### The short answer: six facts, asked for up front

Before drawing a park, ask for these. They are five minutes to answer and
they are the whole job.

1. **The rows.** Street, which side, and the house numbers in order,
   starting from a named end. "Lady Viola, even side, 3124 at the Pamalee
   entrance counting down to 3100 at the loop, thirteen lots."
2. **Which pads are empty**, and that empty is not the same as missing.
3. **Whether every home is the same model.** If it is, every rectangle is
   the same rectangle and they are all parallel -- rungs on a ladder.
4. **The shape of the property line**, and what forms each edge. "Square,
   and the west perimeter is Pamalee Drive."
5. **The road layout.** Here: two streets joined at the east end by a
   square connector behind 3100 and 3101, not a curve.
6. **A county GIS screenshot with the lot numbers on it.** This one was
   given early and is worth more than the other five together.

### The longer answer: what went wrong, so it does not again

**Ask before inferring.** Six attempts were spent deriving the park from
Cumberland's GIS and then from OpenStreetMap, when the owner knew every
answer. A map says where buildings are. It does not say which of them is a
home, which lot it is, which way the numbers run, or where the deed line
goes. Derive geometry; ask for meaning.

**Draw it and look at it before shipping.** Three rounds shipped on green
tests and came back obviously broken, because the tests asked whether the
numbers were in order and never asked what it looked like. A row folded
back on itself passes "fifty one lots, each with its own id".
`lib/__fixtures__/park-picture.mjs` renders the park and fails on the
things a picture answers: anything outside the line, rows that fold, lots
overlapping, homes not parallel, rows not starting level, the road leaving
the property. Run it before every push.

**Build the test park with the real shape.** A toy fixture hides the bugs
that matter. The horseshoe, the street names continuing past the site, the
rows short at one end -- each of those was a real fault that only appeared
once the fixture had that shape.

**Never move the fixture to make the check pass.** Done twice here. A
fixture is the claim about the world; bending it only hides what the check
found.

**When the correction is faster than the inference, build the correction.**
"Move homes" -- drag a pad, angle locked -- took twenty minutes and ended
the argument. It should have been offered ten rounds earlier.

### The same rule for a screen, not just a map

The owner card shipped with its fields off the side of the page, a tick
box stretched to the width of the card, and a date field clipped to
`mm/dd/y`. A type checker cannot see any of that and neither can a test
that asks what the data is.

`apps/inbox/lib/__fixtures__/card-picture.mjs` renders the card against
the real stylesheet at four widths and fails on what a picture answers:
anything out of the card, a page that scrolls sideways, a field too
narrow to type into, a tick box stretched into a box. Run it before
every push that touches the card or `globals.css`.

Two things it caught that are worth remembering. A bare `1fr` column is
`minmax(auto,1fr)`, so it never shrinks below the default width of the
input inside it -- three of those will not fit in a 23rem card, and the
fix is `minmax(0,1fr)` or `repeat(auto-fit,…)`. And `width:100%` on
`input` includes the checkboxes.

**A state name is not a class name.** `check` was already the setup
page's result card -- bordered, padded, coloured left edge -- and a tick
beside a sentence borrowed it on six screens. The stylesheet had the
same note about `.empty` from the last time this happened.

### A thing you have to aim at is a thing that is hard to use

Moving the homes shipped working and unusable. A single-wide is about
twelve pixels across at the zoom that shows a whole park, so taking hold
of one meant hitting a target smaller than the mouse cursor's own point,
and missing grabbed the map and panned the park instead. Worse, a click
while moving homes did nothing at all -- it returned early, so there was
no way to say *which* home you meant, and nothing for a key or a button
to point at.

Neither is visible to a type checker, to a test that asks where the
homes are, or to a picture: the map looks fine. What catches it is the
rule, and the browser.

`apps/inbox/lib/__fixtures__/grab-check.mjs` puts eight real
single-wides on a real MapLibre map in a real browser at the zoom a park
is looked at, and puts the pointer where a hand puts it -- on the pad,
just off it, between two, and nowhere near. It found a bug that reading
the code could not:

**MapLibre decides whether its first argument is a place or an options
object with `instanceof Point || Array.isArray`.** A plain `{x, y}` is
neither, so it is read as options, the query silently becomes the whole
viewport, and the answer is the topmost home on screen. Which is a home,
and looks like one, and is not the one under the hand. Pass `[x, y]`.

`apps/inbox/lib/__fixtures__/move-check.mjs` guards the rest as rules:
the grab widens into a box, a click still chooses a home while the park
is being arranged, the arrow keys give way to a text box and to the
browser's own shortcuts, a held key does not write once per frame, and a
rename that matched no lot is not reported as done. Each fault was
reintroduced in turn to confirm the check catches it.

Run both before every push that touches the map.

### Some parks are not rows, and the answer is a home at a time

Northside is a loop with homes along it, a cluster in the middle at its
own angle, and three that never fit any pattern -- the office, the
laundry, the one turned sideways at the end. Every attempt to say that
with one bearing and one spacing produced a park wrong in a way no
slider could fix, and the last one stacked fifty-nine pads on top of
each other.

**Add a home** drops one where you tap, and the panel beside the map
gives it its own angle and its own rectangle. The data model needed
nothing new: a row placed by its two ends already owes nothing to the
grid, and a row of one sits on its first end. So a home put down by
hand IS a row, with one number in it, whose ends are a metre apart. The
`turn` and `size` that make it its own shape live on the row, which
means a whole row can be angled or resized in one go and a single home
can be split out of one -- "give this one its own shape" -- without a
second idea for either.

**Sizes are offered in feet.** The model is metric because the earth
is; a home is 16 by 60 to everybody who has ever stood next to one.

Two traps worth keeping:

A size field cleared on the way to a new number reads as zero, and a
pad of no width is a pad nobody can find again. Ignore anything under
4 ft rather than applying it.

And `.btn.danger` is already the filled destructive button -- red
ground, white text. Overriding only its colour for a quieter one gave
**red on red**: a solid block with the words invisible inside it. That
is the third time a state name has been borrowed here (`.check`,
`.empty`, now `.danger`), so `card-picture.mjs` now also fails on text
whose colour is within 1.6:1 of what is behind it. Not a contrast
audit: this stylesheet uses a deliberately quiet grey for small labels
and that is a choice. The floor is "these words are not there at all".

**Clearing the drawing is part of placing by hand.** Fifty-nine pads
stacked on each other are in the way of the ones being put down, and
taking them off one at a time is fifty-nine confirmations. The clear-all
lives inside Add a home, not in the header -- a destructive button in
the header is one somebody presses by accident; inside the mode that
needs it, it is the step before the next one.

It also found the thing clearing them would have broken. A park whose
homes are all taken off has a plan with a boundary and no rows, and the
load keyed "has this park been described" on rows alone -- so the next
reload would have called it undescribed, offered the describe form
again, declined to load the plan, and lost the line somebody had drawn
by hand along with the homes. **A boundary counts as knowing the park.**

`apps/inbox/lib/__fixtures__/drop-check.mjs` holds the arithmetic: it
lands where you tapped, it points where you said, it is the size you
typed, a home split out of a row does not move or turn, and doing any
of it to one home does not touch its neighbours.

### The sale papers say what the generator says

`mobilehomedocumentgenerator.html` at the repo root is the owner's own
tool: fill in twenty-four boxes, get a Purchase Agreement and a Park
Land Lease, print to PDF, send off for signing. Both documents are
strictly per-home, so eight homes to one investor is sixteen documents
and sixteen passes through those boxes.

`apps/inbox/lib/papers.ts` is that generator's wording, **lifted
verbatim**, as pure functions over a typed deal. Nothing rewrites a
sentence of it. What the app adds is where the numbers come from: the
owner, the lot, the sale and the park's terms, read from the database.

**A contract that reads almost right reads right**, which is why
`lib/__fixtures__/papers-check.mjs` compares every fixed sentence in
`papers.ts` against the generator's own, character for character. It
also checks that no clause was dropped on the way across.

Two things that harness taught:

The first version of its prose extractor read the TypeScript as prose
and reported that `export function amortisation(...)` was missing from
a contract. True, and not the question. **Compare what is inside the
backticks**, with the `${...}` holes cut out first so no backtick hides
inside one.

And the expected monthly payment was a number I typed, thirty cents
wrong. **A figure written into a test is a figure somebody invented.**
It now checks the payment by paying the loan off -- 240 payments, and
the balance must land on zero -- with a second case proving a cent more
a month would not.

The owner's own page (`/owners/<id>`) is where this lives, reached by
clicking the owner's name on a lot card: every home they hold across
every park, what they are charged each month, and the papers.

**The header at the top of the printed page is the browser**, not the
document -- Chrome and Safari print the page's title and address into
the page margin unless the tick box is cleared. There is no CSS for it.
The one trick that works, `@page { margin: 0 }`, leaves the browser no
margin to draw in and takes the top and bottom margin off every
continuation page with it: measured at 14 pages against 10 on the same
two agreements, which is a page 2 whose text starts at the paper's edge.
Not a trade worth making on a contract.

So the margin stays, the print dialog's **Headers and footers** is the
answer (each browser remembers it), and both the app and the generator
set `document.title` to the document's own name -- because the header
shows the title beside the address, and a contract headed
`file:///Users/.../Downloads/mobilehomedocumentgenerator (4).html` is the
sort of thing that loses a deal.

### A line drawn by eye is not the deed line

Above the map, over a boundary the owner had drawn by hand with the
mouse because the county's service had not answered: "The property line
is the county's, from parcel P139-50A."

The sentence only ever asked whether there WAS a line. The two look
identical on screen and are not the same claim -- and the difference
decides whether the next park takes a minute or another afternoon, so
it is exactly the thing somebody plans around.

`plan.fenceFrom` is now `"county"`, `"hand"`, or absent, and the
sentence says which. Absent is its own answer -- "does not say whether
it came from the county or was drawn by hand" -- because a park whose
line predates the question is not evidence either way, and guessing
there is the same lie in a new place.

The general shape, and it has now cost four rounds in three places: **a
screen that reports a state by testing whether anything is there at
all.** `described` keyed on rows. `has` keyed on a line. Both answer a
narrower question than the one being asked, and both answer it
confidently.

### The camera belongs to whoever is using it

Putting fifty-nine homes down by hand means zooming in on a corner of
the park and tapping. Between every pair of taps the map re-framed --
a four-hundred-millisecond zoom out, back to the whole parcel, so the
next tap had to begin by zooming in again. "It would fidget and
unzoom."

Two causes, and both are the map deciding it knew better.

**The number of homes was in the framing key.** Every home put down
changed it. What the framing is actually for is the park *arriving* on
screen, and that happens once -- so the key now asks whether there are
homes, not how many.

**The panel opening re-fitted the map.** The box narrows when the panel
appears and MapLibre has to be told, but telling it its new size with
`m.resize()` is the whole of what is needed. Re-fitting as well zoomed
the park out on the first tap of every session and again every time the
panel shut.

Underneath both: **while somebody is working on the map, the camera is
theirs.** Placing, moving, drawing the line, fitting the block -- in all
of those they have chosen a zoom and a corner, and the map taking it
back is the screen arguing with the hand. `Fit view` is there for when
they want it back. A view that arrives while the tools are out is still
recorded as framed, so putting them down does not then yank it.

The decision lives in `apps/inbox/lib/reframe.ts` rather than inline in
the effect, because the bug was one word in a cache key and nothing
about that is visible in a type, in a test of where the homes are, or
in a picture of the park. `apps/inbox/lib/__fixtures__/still-check.mjs`
runs the afternoon through it: fifty-nine homes, and the map may not
move.

**Either fix alone stops the fidget**, which made the first two guards
pass on the fault. A check that cannot tell two fixes apart cannot tell
you which one broke -- so the one that tests the key asks it with
nobody working, and the one that tests the guard asks it with somebody.

### Ask for the thing, do not wait to be told about it

Tenants had been submitting maintenance requests in Rent Manager's
Tenant Web Access for weeks and none of them reached the inbox.

The email path was built and is correct -- `parseRentManager` reads the
TWA notification, and `routeEmail` recognises it three ways (the
`rentmanager.com` sender, the "submitted from TWA" subject, and
"submitted via TWA" in the body). I suspected that path twice before
reading it, and both times it was already right.

The path is just long: Rent Manager sends a notification, a Gmail
filter forwards it, Postmark receives it, a webhook reaches here. A
request can fall down silently at any of the four, and nothing says so
until a tenant rings up.

**The issue itself never falls down. It is in Rent Manager, which is
where the tenant put it.** `/ServiceManagerIssues` is an endpoint the
probe has always been able to reach, and nothing ever fetched it --
it appeared twice in the codebase and both were diagnostics. So
`apps/inbox/lib/rm-issues.ts` asks for them. It backfills everything
already submitted, and re-running is safe because `ingest` refuses an
`external_id` it has seen.

The setup page at https://mh-investor-template.vercel.app/setup already
diagnoses the email half precisely -- including which Postmark status
means which failure -- so the answer to "is the forward working" was
always one page away. Read it before theorising.

**Field names from this account are a hypothesis, and the code says so
out loud.** Rent Manager Express, docs unreachable, no credentials on
this machine. So every field is read through `pick`, which tries the
spellings rmAPI is known to use, and the result reports BOTH the record's
real field names and which spelling answered for each thing. The preview
button is what settles it. A guess that reports what it saw can be
corrected in one round; a guess that fails silently cannot be corrected
at all.

One guard worth keeping: an empty field must not be reported as the one
that answered. `text()` already nulls the value, so the only thing that
goes wrong without the empty-string check in `pick` is the MAP -- and
the map is the entire diagnosis when a field comes back missing.

### What the deep probe said about Service Manager

The owner ran it against `larabee.api.rentmanager.com`. This is the
answer, not a guess, and it corrected three things I had wrong.

**The base record** is `ServiceManagerIssueID, Title, Description,
Resolution, IsClosed, CloseDate, CloseUserID, AssignedOpenDate,
AssignedCloseDate, AssignedToUserID, IsCustomerInitiated,
CustomerDescription, NoteText, CreateDate, CreateUserID, UpdateDate,
UpdateUserID, CreateWebUserID, IsAllowedToEnter, Age`.

**The embeds that answer are `Category`, `Status` and `Priority`.** My
first six -- Property, Unit, Tenant, ServiceManagerStatus,
ServiceManagerCategory, ServiceManagerPriority -- returned 404 every
one. Asked as a single list, one bad name fails the whole request, so
that version would have fallen back to bare records and silently
dropped the status and the category.

**`CustomerDescription` is what the tenant typed; `Description` is what
the office typed.** On a request somebody submitted themselves the
first is the one that says what is wrong, so it is read first.

**And the thing that is still open: a Service Manager issue, as this
endpoint hands it over, does not say which lot it is for.** No
PropertyID, no UnitID, no TenantID, and those embeds are refused.
`CreateWebUserID` is the Tenant Web Access user who submitted it and is
the most promising thread to pull; the deep probe's candidate list is
now the hunt for it. Until that is answered an issue arrives honestly
saying its location is unknown, because a request filed against the
wrong lot is worse than one filed against none.

`IsClosed`, `CloseDate` and `Resolution` are on the record, so closing
one here can be written back. The VERB rmAPI wants is not documented
anywhere reachable, so `closeIssue` tries PATCH, PUT and POST-as-a-list,
reports exactly what each attempt did, and remembers the one that
worked. It writes those three fields and the id, and nothing else --
checked as an exact key set, because a check that only asserts the three
are present lets a fourth be added to somebody's live
property-management system without anything objecting.

**Three of this round's guards passed on the fault**, all for the same
reason: the fixture could not tell the orderings apart. A record whose
`Description` is empty reads the same whichever way round the list is.
**A fixture that cannot distinguish the two answers is not testing the
thing it names.**

### The plan is part of the design

This deployment is on Vercel's **Hobby** plan, and two things I shipped
assumed otherwise.

**A function is killed at sixty seconds.** `maxDuration = 300` is not a
grant, it is a request the plan refuses. And a killed function does not
return JSON -- it returns whatever Vercel serves -- so the browser said
"Unexpected end of JSON input", which names the parser and tells you
nothing. The pull now stops with time to spare and reports `more: true`;
pressing again carries on, because everything already filed is skipped.
The browser reads the reply as text and parses it itself, so a 504 says
it was cut off rather than blaming the parser.

**A cron is triggered once a day**, whatever the expression says, within
a flexible hour. A more frequent expression is not clamped quietly: it
**FAILS THE BUILD**, with "Hobby accounts are limited to daily cron jobs".

That sentence used to read "can fail the deployment", and the very next
thing committed after it was `15 * * * *` -- hourly. Every deployment for
a day was refused. Twelve commits of work sat on `main` while the live
site served the build from before them, three rounds went on "it is
probably still building" and "it is probably your browser", and the owner
found it by opening the Create Deployment dialog, which prints the real
error where the deployments list does not.

So the schedule asks for once a day, and `lib/__fixtures__/plan-check.mjs`
holds it there: on Hobby every cron's minute AND hour must be fixed
numbers, because a star, a step, a list or a range in either one is more
than one firing. On Pro, change the expression and tell that file the
plan -- it names the plan in one line for exactly that reason.

**A rule a person has to remember is a rule that gets forgotten.** This
one was written down in this file, in bold, and shipped against anyway on
the same day. Writing it down is not the fix; the fix is the suite.

A third, smaller: **a cron expression beginning with a star and a slash
ends a block comment.** Written in words in the source for that reason.

The general shape: **the hosting plan is a constraint on the design, not
a detail of the deployment.** A timeout, a cron frequency and a function
size decide what a feature can be, and finding that out from a user's
screenshot is finding it out late.

### Run the migration against a real Postgres, do not read it

The photo in the team chat was not migration 027 and was not the
attachment check, both of which I offered before looking. It was this,
from 013:

    body text not null check (length(trim(body)) > 0)

027 added `media_paths`, the screen started saying "a screenshot with
no words is a whole message", and nobody came back to the constraint.
The rule was never "the body must say something" -- it was "the MESSAGE
must say something", and a photograph says plenty. 036 replaces it.

**The one line that matters has a trap in it that reading cannot
find.** `array_length('{}', 1)` is null, not zero; a CHECK that
evaluates to null PASSES; so a constraint written without the coalesce
lets every empty message through while looking exactly right.

So `apps/inbox/lib/__fixtures__/photo-check.mjs` starts a Postgres,
builds the table as 013 made it, and runs the migration: the photo-only
insert must fail BEFORE and go in after, words must still work, empty
must still be refused, and the whole thing must apply and replay on a
database where 027 was never run. It skips where there is no postgres,
the way the picture harnesses skip without a browser.

Three things that cost a round each:

**A fault that is a no-op proves nothing.** `if true and exists (...)`
is `if exists (...)`, so the guard passed and I nearly believed it had
teeth.

**A migration that will not apply is the most important failure a
harness can report**, and it was the one case that threw instead --
taking the whole run down as "the harness fell over" rather than naming
it. It is a named check now.

**Dropping `if exists` breaks the replay, not the first apply.** The
guard was right and my pairing was wrong. When a fault fails a
different check than expected, read which one before changing anything.

### A send that failed must not look like a send that worked

Dragging a photo into a team chat and pressing enter emptied the
composer, dropped the thumbnail, and showed no message. "It goes away
and nothing happens."

The route was careful and said exactly what was wrong -- which
attachment is not this thread's, that ten is the limit, that the
attachment could not be kept because migration 027 has not been run.
**The send fired the request and never read the answer.** It cleared the
words and the picture whatever came back, so a refusal and a success
looked identical from the chair.

Underneath it, a worse one. The route's fallback for the missing column
drops the attachment and inserts the words -- and a picture with no
words is a row with an empty body: a message nobody can see, reported
as sent. It now refuses instead, naming the migration.

Nothing is cleared until the server says it took it, and what it says
goes on screen. **The same shape as the park layout in a debounce and
the Saving…/Saved line: silence and success look identical, and the one
time they are not the same is the time it matters.**

`apps/inbox/lib/__fixtures__/send-check.mjs` has two halves and they are
not equal. The first states the contract runnably against a stand-in
server -- but it is a MODEL of the composer, not the composer, and
changing `DmPane` does not change it. Finding that out cost two guards
that passed on the fault. **The teeth are the source rules**, and one of
them checks ordering by position rather than by pattern, because a regex
for "clears before the fetch" matched none of the ways that line can be
written.

### An afternoon of work must not live in a debounce

Fifty-nine homes put down one tap at a time is an afternoon, and the
layout they make sat in an eight-hundred-millisecond debounce with two
missing ways out. Both are silent.

**Re-reading the park overwrote it.** `load()` replaces the layout on
screen with the server's copy, and a layout still waiting in the
debounce is the newer of the two -- so the very next thing anybody does
after placing the homes, pressing *Add lots*, would have put the
afternoon back the way it was. No error. Nothing on screen. `load()`
now awaits a flush first, and `flush` is in its dependencies, because a
stale flush closed over an old plan writes the old plan.

**Closing the tab never sent it.** The cleanup cleared the timer and
dropped what it was holding. Now `pagehide` sends it with
`keepalive: true` -- a fetch started as the tab closes is not sent
otherwise -- and the effect's own cleanup sends it too, because
navigating inside the app unmounts the screen without ever firing
`pagehide`.

**The plan waiting to be written lives in a ref**, not only inside the
timer's closure, because two separate paths have to be able to reach it.

And the screen now says *Saving…* / *Saved*, with a Try again on a
failed write. Silence and success look identical, and the one time they
are not the same is the time it matters.

`apps/inbox/lib/__fixtures__/keep-check.mjs` runs the real debounce
against a stand-in server: fifty-nine remembers, then a re-read, and all
fifty-nine have to come back. It also runs the same sequence *without*
the flush and requires that one to lose them -- a race check that cannot
fail is not checking a race.

### A park the map has never heard of is still a park

Northside drew fifty-nine numbered pads and nothing could be done with
any of them: no Move homes button, a drag that saved nothing, a nudge
that found no home to nudge. The homes were on screen the whole time,
which is what made it baffling.

`real` was what the TILES carried -- buildings, named streets, a
boundary -- and Pasquotank's basemap carries none of that there, so it
stayed null. The map falls back to the plan for *drawing*, so the park
appeared; but every feature that works ON a home was keyed on `real`,
and so none of them existed.

The two are now separate. `harvested` is what the map handed over, and
only the sentences that are *claims about the map* read it -- "All N
lots, laid along…", "Fit to aerial", the reading hint. `real` is the
park however it came to be known: the harvest when there is one, the
plan's own drawing otherwise. Everything that moves, saves or opens a
home works on that.

The general shape of this: **a fallback that covers the drawing but not
the doing.** The screen looks complete and is inert, and nothing fails
loudly enough to find.

### A fit that overlaps the pads is not a fit

The same park then fitted inside its boundary by squeezing fifty-nine
pads into room for thirty, and drew as one grey smear. Every number
present, in order, inside the line -- and nothing on it could be taken
hold of, because you cannot grab what you cannot tell apart.

`fitInside` now never shrinks below the room a home actually takes
along the row. Not its width: a home turned off square reaches further
along the row than it is wide, so it is
`width·cos(turn) + length·sin(turn)`. A row that then will not fit
overflows, and the screen counts the lots outside and says the number.
An overflow somebody can see beats a fit that lies.

### A park drawn past its own deed line still looks like a park

1140 Northside Rd shipped with fifty-nine numbered pads strung out in
two rows running a couple of hundred metres past the property line and
across a neighbouring field. Tidy rows, numbers in order, homes all
parallel -- `park-picture.mjs` is happy, and so is anyone who does not
happen to notice the blue line it crosses.

Two things were missing, and both are the same mistake: a correction
that exists but is not reachable, and a state that is wrong but is not
said.

**Fitting inside the boundary happened only on the way back from the
county lookup** -- a path a park takes once. A park whose line arrived
any other way had no way to ask for it. It is a button now, in the
header, whenever there is a line and rows to put inside it.

**Nothing counted the lots that were out.** The screen now says
"N of 59 lots are drawn outside the property line" above the map, so
the state is read rather than noticed.

`apps/inbox/lib/__fixtures__/inside-check.mjs` builds a park the size
of the real one inside a 12.5-acre parcel, at a spacing deliberately
far too wide, and asks the question the owner was asking: does pressing
the button put them all back inside? It also holds the rules the
arithmetic cannot see -- the button exists, the count is said, and a row
placed by hand is not quietly re-fitted (fitting changes the spacing,
and a placed row has none, so it would report success and move
nothing).

Three of its guards passed on a fault the first time, and each for a
reason worth remembering. A test parcel sharing the plan's own centre
makes the re-centring step untestable, because it has nothing to do --
offset it. And a source rule that greps for a phrase matches the
sentence explaining the phrase as readily as the button carrying it --
anchor on the call, not the words.

### One park must never be drawn as another

Three rounds were lost to a park in Pasquotank being drawn as the park
in Fayetteville, each time by a different route, and each time it read
as the new park being laid out badly rather than the old one still
being on screen.

**The screen started as Cross Creek.** The map reads the ground the
moment it loads, which is before the database has said which park this
is -- so the wrong park was harvested, and nothing afterwards threw it
away. A screen now starts as nothing: the spacings, and no rows.

**And then "nothing" was still Cross Creek.** The empty plan was
`{ ...RETREAT, rows: [] }` -- the rows taken off and *everything else
kept*, including the centre. So every park nobody had placed opened on
Fayetteville, along with Cross Creek's bearing, the end its numbers
count from, and the road its deed line runs out to. The guard above
allowed that line **by name**, so this check waved through the fourth
instance of the thing it exists to catch.

The empty plan now starts at `[0, 0]` and carries only what is general:
how far apart homes and streets usually are, and how big a single-wide
is. A park with no plan is placed by the pin on the property, which the
plan endpoint now returns. And **a park nobody has placed gets no map
at all** -- a sentence saying so, and the box to give it an address. An
empty screen that says why is not a worse answer than a map of the
wrong county; it is the only honest one.

Two lessons, both general. **A whitelist in a guard is a hole in the
guard** -- `one-park-check` now strips comments and forbids the screen
from naming the default park on any running line, full stop. And
**stripping the obvious part of a wrong default leaves the rest of
it**: taking the rows off a park does not stop it being that park.

**A flag that is null before it is false.** `described === false`
looked like "not described", but the answer is null until it is known,
and in that window the default drew. Ask `!== true`.

**An allowance spent before anyone was listening.** Harvest attempts
are capped so a hopeless map stops being asked; the counter ticked even
with no handler attached, so the cap was reached before the plan
arrived and the tiles were never read again.

**One park's street name in shared code.** The property line ran out to
`/pamalee/i` on every park in the system. Harmless, because no other
park has that road, and wrong, because the park that does is not
special. Facts about a park belong on its plan.

A picture does not catch any of these -- the picture looks like a park.
`apps/inbox/lib/__fixtures__/one-park-check.mjs` guards the rule
instead: outside the line defining an empty plan, the screen may not
name the park written into the code, and it may not draw or harvest
before that park's own plan has arrived. Each fault above was
reintroduced in turn to confirm the check catches it. Do that too when
adding to it -- a guard nobody has seen fail is a guard nobody has
tested.

### What is not reachable from here

arcgis.com, services.nconemap.gov, the Census geocoder, Nominatim and
Overpass are all refused by egress policy, through curl and through the
fetch tool alike. Web search is not. So county data cannot be tested
against the real service from this machine, and guessing coordinates
from a screenshot produced a park four kilometres from where it stands
-- do not do that again. Test the logic against a stand-in server, say
plainly what could not be verified, and let the deployment, which is
not blocked, do the real call.


### A phone does not know where it is, and the answer has an error bar

The crew clock has to say whether somebody is on the property. A browser's
position comes with an accuracy in metres -- the radius it is about 68% sure
the handset is inside -- and indoors that is routinely 50 to 200, and on a
cold start a kilometre. A seventy-five-metre fence tested with
`distance <= radius` against a fix accurate to two hundred metres is not
answering the question. It is reading noise, confidently, with somebody's
wages on the other end.

So `lib/fence.ts` has three answers and not two: inside when the WHOLE error
circle is inside the fence, outside when the whole of it is outside, and
**cannot tell** otherwise -- which is the common case, not the edge. A fix
with no accuracy at all is not a fix with accuracy of zero: a device that did
not say how sure it is has not said it is certain.

The same shape as the property line that only ever said whether a line
existed, and `described` keyed on rows, and `has` keyed on a line. **A screen
that reports a state by testing whether one number is under another answers a
narrower question than the one being asked, and answers it confidently.**

Two rules around it that are not geometry. **The fix is recorded, never
enforced** -- a clock-in off site goes in as off site, because a man who
cannot clock in has no record of his hours at all, which is worse for him and
much worse in front of a wage claim. And **the tracking belongs to the shift,
not to the login** -- a ping may only be written against an open shift, in the
row policy and not only in the route, and the screen says so in a sentence.

### A guard standing behind a second guard is a guard nobody has tested

Four of this round's guards passed when the rule they name was deleted,
because something else answered first.

The assistance-animal rule looked proven until it was removed and nothing
changed -- the pet patterns happen not to match "service dog" either. Ask it
where both rules fire: "I have a dog, she is a service dog".

The bathroom bound could be widened from 4 to 31 without a check noticing,
because the bedroom bound rejects 11/15 on the eleven. Ask it with 4/15.

The rate rule was never reached, because "an hour" and "a week" are already
not-a-budget words. What it catches on its own is "$40,000 a year".

And the vagueness threshold was redundant on a 75m fence, where the error-bar
rule refuses a kilometre-wide fix anyway. What it is for is a big fence: a fix
accurate to a kilometre, standing on the pin of a 1.5km boundary, is
geometrically inside and tells you nothing.

In each case the fault was a no-op, and **a fault that is a no-op proves
nothing**. The fix is never to weaken the code -- it is to find the case where
only that rule can answer.

### A harness that dies on a fault reads as a harness that is broken

Four faults took a run down with a TypeError and a line number, because an
assertion reached into a field the fault had just removed. That reads as "the
harness fell over", not as "the fault defeated this one check", and it is the
same lesson as the migration that would not apply in 036.

Every assertion is a thunk now, and `t` reports a thrown one as a named
failure. Wrapping them mechanically needs a scanner that understands comments:
an apostrophe in a `// person's` comment ran the first version off the end of
the file.

### An anchor that runs on past its own block

`/action === "sign-off"[\s\S]{0,600}?\.eq\("staff_id", me\.id\)/` matched the
`.eq` in the block AFTER the one it was about. So deleting the filter from
sign-off still matched, and a sign-off reaching every person's shifts passed.

**Cut the block out first, then match inside it.** Same family as anchoring on
the call rather than the words, which cost a round in `inside-check.mjs`.

And a guard that bans one setter's name is a guard the next person walks past
with a different name. Ask the real question: nothing may be written to state
before the answer has been read.

### A fixture that gives one of everything cannot tell two answers apart

The best-fit rule in `lib/leaks.ts` -- each person's single best lot, never
every pairing -- passed with the rule deleted, because the fixture gave each
person exactly one clean match. With one match, best-of and sum-of-all are the
same number. Two matching lots, and they differ.

Third time this exact shape has come up (the Service Manager orderings, the
adrift lots, this). **If you cannot say which number the wrong answer would
give, the fixture is not asking the question.**

### Things that typecheck and are wrong

**A positional destructure with a query inserted in the middle.** The
dashboard's `Promise.all` hands every query after the insertion point the
wrong rows, and it compiles, because the shapes happened to be compatible.
New queries go at the end.

**A Supabase select built by concatenation.** The client infers the row type
from the select text, so a joined string turns every field on the result into
an error rather than a column. One string literal.

**A radius table listing kinds the codebase does not have.** `quad` and
`apartment` were invented and `mh`, `multi` and `lot` were missing, so three
real kinds would have fallen to a default wrong for all three. The harness
reads the kinds out of `property.ts` and checks the two lists against each
other rather than trusting either.

### What running 038 found that reading it could not

A **GRANT to a role that does not exist is an error, not a no-op** -- the
migration did not apply at all until the harness created `anon` and
`authenticated`.

A **policy naming a schema that is not there fails at CREATE POLICY**, not at
query time, so a missing `auth` schema is a migration that will not apply
rather than policies that misbehave later.

The whole file **does** survive being pasted into the SQL editor as one
transaction, which `alter type ... add value` is the sort of statement that
historically would not. Worth knowing rather than assuming.

And **`revoke delete` changes nothing on a clean database**, because a new
table grants nothing to `authenticated` anyway -- so that guard was a no-op.
What the revoke is for is a project carrying a blanket
`grant all on all tables in schema public`, so the harness hands over that
grant first and then checks the migration takes it back.

One thing that nearly went out silently: the enum statement was wrapped in a
`do $$ ... exception when others then null $$`. `if not exists` already makes
it safe to re-run, and the handler would have meant the role quietly not
existing with nothing on screen to say so. **Ask whether the thing is there
afterwards rather than taking the absence of an error as an answer.**

### A fixture that trips its own guard is testing the guard, not the thing

Half an hour went on a failing check that read, every way I looked at it,
like `approve_shift_edit` was not committing. The function was correct the
whole time: the fixture opened a second correction against a shift that
already had one open, which is exactly what the unique index in 039 refuses,
and the resulting error came back wearing the clothes of the failure before
it.

Two things made it take half an hour rather than two minutes.

**I ran the harness twice and compared the two runs to each other.** Each run
builds a fresh database, so the state printed by one and the check results
printed by the other were never about the same rows. They contradicted each
other because they were different worlds.

**And the diagnostics printed in a different order than the results.** `t()`
collects into an array and prints at the end, so a `console.log` in the middle
appears ABOVE every ok and FAIL -- including the ones that ran before it. The
output reads as a timeline and is not one.

The thing that actually settled it was running the migration and the scenario
by hand in psql and reading what came back. Four commands, and the answer was
unambiguous. **When a harness and your reading of the code disagree, ask the
database directly before instrumenting the harness a third time.**

One real guard came out of it. `t("...", () => { try { ... } catch { return
true; } })` passes on ANY exception, including the wrong one -- so it now
matches the message: `/that request is not open/`.

### A guard that names a thing breaks when the thing is renamed

The clock screen's source rules listed three allowed setters by name. The
screen was rewritten with four, and two guards failed -- on a rename, not on
a fault, which is the same noise as a guard that passes on a fault and
exactly as useless.

The rule those guards are for is about one thing: the state holding the
server's record must not be written before the answer has been read. So the
setter's name is now read out of its own declaration
(`useState<State | null>`) and the checks are built from that. A proper
rename moves the guard with the code; deleting the write still fails. Both
were confirmed by doing each.

The pair to the lesson already in here -- a guard that BANS one name is a
guard the next person walks past with a different name. Either way: **derive
the name from the code, do not write it into the check.**

### Two different questions about a property

The crew clock's "Which job are you on?" dropdown came up empty on the first
phone that opened it. The list was built from the geofences, and a fence
needs a pin on the map, and most properties have never had one dropped.

Those are not the same question. The fence answers "can the phone tell me
where this man is" -- which most properties cannot answer. "Which job are you
on" is about every property on file, and **the whole reason for asking is
that the phone could not tell.**

Same shape as the park whose features were keyed on what the TILES carried.
A list keyed on the narrower question looks complete and is empty.
