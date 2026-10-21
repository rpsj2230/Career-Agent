# Database access after Supabase's 30 October 2026 change

Supabase stopped granting Data API access automatically to **new** tables in the `public` schema from 30 October 2026. Existing tables keep their access.

The app talks to the database only with the server-side `service_role` key. Migration `supabase/migrations/0004_data_api_grants.sql` gives that role access to every existing table and makes tables created later inherit it. It grants nothing to `anon` or `authenticated`, so the data stays closed to anyone but the app.

**Run it once** in the Supabase SQL editor (paste the file, press Run). It is safe to run again. Do this before any new feature that adds a table is deployed, and before setting up a fresh project or preview branch from the migration files.

A table added in a future migration then needs no extra grant. If you ever see `permission denied for table …` from the app, run this migration again.
