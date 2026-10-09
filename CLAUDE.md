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

No project id here yet. Give https://supabase.com/dashboard/projects plus the
clicks, and say why it cannot be exact. Ask for the address bar once and this
section stops being a paragraph.

### The rule when an id is missing

Give the top-level link plus the clicks, say why it cannot be exact, and ask
the owner to paste the address bar when they land. Then write it down here.

## Shipping

The site deploys from `main`. Pushing the feature branch alone changes nothing
the owner can see; the merge is what ships it. Standing permission to merge
`claude/twilio-shared-number-property-4i3yu1` into `main`.

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

