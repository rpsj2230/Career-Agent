-- 0004: keep the app's database access working after Supabase's 30 October 2026 change.
-- From that date Supabase no longer grants Data API access to NEW tables in the "public" schema automatically. The app reads and writes
-- only through the server-side service_role key, so only that role needs access; the browser-facing roles (anon, authenticated) get none,
-- which keeps every table closed to anyone who is not the app itself.
-- Idempotent: safe to run more than once. Run it once in the Supabase SQL editor (before or after 30 October; existing tables are not affected either way).

grant usage on schema public to service_role;

-- everything that exists now
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- everything created from now on by migrations (which run as the postgres role)
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
