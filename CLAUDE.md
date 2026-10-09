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

