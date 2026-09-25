-- Messages in another language
--
-- Run in the Supabase SQL editor. Safe to run twice.
--
-- `body` is always what actually went over the wire -- what the tenant typed,
-- or what we sent them. It is never overwritten with a translation. A
-- translation is a reading of what someone said, not the thing they said, and
-- the difference matters the day a conversation is read back in a dispute.
--
-- `body_en` is the English rendering alongside it, and `lang` is the language
-- `body` is in. On an inbound Spanish text, body is Spanish and body_en is
-- English. On an outbound one it is the other way round: body is the Spanish
-- we sent, body_en is what the person actually typed.

alter table messages
  add column if not exists body_en text,
  add column if not exists lang    text;

-- What this person reads. Set from the first message we see in another
-- language, and changeable by hand -- a tenant who texts in Spanish once may
-- still prefer English, and only they know that.
alter table contacts
  add column if not exists language text;

create index if not exists contacts_language on contacts (language)
  where language is not null and language <> 'en';

do $$ begin
  raise notice 'messages can carry a translation alongside the original';
end $$;
