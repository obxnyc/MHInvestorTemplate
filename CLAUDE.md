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
