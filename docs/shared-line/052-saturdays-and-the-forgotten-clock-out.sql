-- 052: Saturdays that are worked some weeks, and the shift nobody clocked
-- out of.
--
--   clock_text_settings.optional_days  days worked SOME weeks. Nobody is told
--                                      to come in; only the men who did are
--                                      texted or put in a report.
--   clock_text_settings.auto_out       "HH:MM" -- a shift still open at this
--                                      time is closed by the clock. Null is off.
--   shifts.auto_clocked_out            the clock closed it, not the man. Paid,
--                                      and flagged on Friday pay and in the
--                                      recap, because the end time is the
--                                      clock's best evidence and not his.
--
-- The owner's answers (Saturday some weeks, no overtime) were set once as
-- data, NOT here: a re-run of this file must not undo a choice made on the
-- Crews & texts screen since.
--
-- Safe to re-run.

alter table shifts add column if not exists auto_clocked_out boolean not null default false;

alter table clock_text_settings add column if not exists optional_days integer[] not null default '{6}';
alter table clock_text_settings add column if not exists auto_out text default '18:00';
alter table clock_text_settings drop constraint if exists clock_text_settings_auto_out_shape;
alter table clock_text_settings add constraint clock_text_settings_auto_out_shape
  check (auto_out is null or auto_out ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
