-- ============================================================================
-- RHS Band Attendance Manager — Database reset
-- ----------------------------------------------------------------------------
-- Drops every object this app owns (tables, the role enum, and anything that
-- cascades off them) so supabase/schema.sql can be re-applied to a clean slate.
--
-- Use this when the database is in a partial/stale state (e.g. schema.sql was
-- run against an older version and now errors on re-run). Safe to run anytime
-- BEFORE the app has real data you care about — it deletes everything in the
-- public schema that this app created.
--
-- It does NOT touch auth.users or storage, so director/student accounts you've
-- already created survive; re-run seed-production.sql afterwards to re-create
-- the director's profiles row if needed.
-- ============================================================================

drop table if exists public.attendance_records cascade;
drop table if exists public.checkin_sessions cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.chat_channels cascade;
drop table if exists public.events cascade;
drop table if exists public.app_settings cascade;
drop table if exists public.notifications cascade;
drop table if exists public.checkin_attempts cascade;
drop table if exists public.join_code_attempts cascade;
drop table if exists public.profiles cascade;

drop type if exists public.app_role cascade;
