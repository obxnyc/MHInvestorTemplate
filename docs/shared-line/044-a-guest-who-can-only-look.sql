-- A guest who can only look
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- The editor will say "Potential issue detected" -- it flags any query
-- containing alter, drop or update. The only one here is `alter type ... add
-- value`, which adds a word to the list of roles a person can have. Nothing
-- is dropped, nothing is deleted, and no existing row changes.
--
-- Somebody wants to hand an account to a person who will look round the
-- application and say what they think of it. Handing over an admin password
-- for that is the wrong trade: a stranger poking at buttons on a live system
-- can close a tenant's thread, reassign a job, or turn somebody's access off,
-- and none of it is obviously undoable.
--
-- So: a role that can read everything and change nothing.
--
-- WHERE IT IS ENFORCED MATTERS. Not in the screens -- a hidden button is a
-- suggestion, and every one of these routes is reachable with a URL and a
-- fetch. It is refused in the proxy, which every request passes through,
-- for every method that is not a read. One place, and nothing to remember
-- when the next route is written.

alter type staff_role add value if not exists 'viewer';

-- Nothing else is needed here. Reading is already governed by
-- `is_active_staff()`, which a viewer satisfies like anybody else -- that is
-- the point of them. Writing does not go through row-level security on most
-- paths, because the application writes with the service role, which is
-- exactly why the refusal lives in front of the routes rather than under them.
