# Running the migrations

The SQL files here are applied in order. Until now that meant pasting
each one into the Supabase SQL editor; `run.mjs` does it from a machine
that can reach the database.

## Once

Get the connection string: Supabase → your project → **Project Settings**
→ **Database** → **Connection string** → **URI**. It looks like

    postgresql://postgres.xxxx:PASSWORD@aws-0-....pooler.supabase.com:5432/postgres

Put it in `apps/inbox/.env.local` as `DATABASE_URL=...`, or export it in
the shell. **It is a password.** It does not belong in a chat window, a
commit, or a screenshot. `.env.local` is already ignored by git.

Then:

    cd apps/inbox && npm install

## Every time

    node docs/shared-line/run.mjs

It applies whatever has not been applied yet, one transaction per file,
and stops at the first failure without leaving half of one behind. Run it
again after fixing and it picks up where it stopped.

## The first time, on a database already in use

It will refuse, and say so. Nothing is written down yet, so every
migration here looks outstanding — including the forty that went in by
hand months ago. Most say they are safe to run twice and most are; a few
drop and recreate, and "most" is not a thing to bet property records on.

Tell it what is already in:

    node docs/shared-line/run.mjs --assume 044

That writes 001–044 down as applied without running them. Then run it
normally and it does only what is left.

Or name them outright, which always works:

    node docs/shared-line/run.mjs 045 046 047 048

## Looking without touching

    node docs/shared-line/run.mjs --list

`lib/__fixtures__/runner-check.mjs` runs all of this against a real
Postgres, including the case that matters: a file that fails must leave
nothing behind and must stop the ones after it.
