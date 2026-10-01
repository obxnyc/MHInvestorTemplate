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

Click by click, with the thing to type in a code block. Say which screen, which
button, and what the right answer looks like when it works.
