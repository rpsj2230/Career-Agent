-- 0002: portals, scans, automation runs, activity log, schedules, country preferences, daily reports,
-- application snapshots. Idempotent: safe to run more than once. Run after 0001.

-- ---------------------------------------------------------------- integrations (data sources)
create table if not exists integrations (
  id text primary key,                          -- adzuna | jsearch | remotive | greenhouse | lever | mailbox | manual
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,    -- non-secret settings only; credentials live encrypted in settings
  status text not null default 'unknown'
    check (status in ('unknown','ok','degraded','error','needs_setup','disabled')),
  last_scan_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  jobs_found_total int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- schedules
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  paused boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily','weekdays','weekly','every_n_hours')),
  days int[] not null default '{}',             -- weekly: 0 (Sun) to 6 (Sat)
  interval_hours int check (interval_hours is null or interval_hours between 1 and 168),
  time_of_day text not null default '09:00' check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Asia/Kolkata',
  countries text[] not null default '{}',       -- empty = all enabled countries
  integrations text[] not null default '{}',    -- empty = all enabled integrations
  mode text not null default 'scan_prepare' check (mode in ('scan','scan_prepare','scan_prepare_apply')),
  require_approval boolean not null default true,
  max_prepare int not null default 20 check (max_prepare between 0 and 200),
  max_apply int not null default 10 check (max_apply between 0 and 100),
  last_run_at timestamptz,
  last_run_status text,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists schedules_due_idx on schedules (next_run_at) where enabled and not paused;

-- ---------------------------------------------------------------- automation runs
create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references schedules(id) on delete set null,
  trigger text not null default 'manual' check (trigger in ('schedule','manual','api','worker')),
  kind text not null default 'pipeline' check (kind in ('pipeline','scan','score','prepare','apply','report','test')),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed','cancelled')),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  scope jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists runs_started_idx on automation_runs (started_at desc);
create index if not exists runs_status_idx on automation_runs (status) where status = 'running';

-- ---------------------------------------------------------------- portal scans (one row per source query)
create table if not exists portal_scans (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references automation_runs(id) on delete set null,
  integration text not null,
  portal text,
  country text,
  query text,
  status text not null default 'running' check (status in ('running','ok','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched int not null default 0,
  inserted int not null default 0,
  duplicates int not null default 0,
  stale int not null default 0,
  invalid int not null default 0,
  error text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists scans_started_idx on portal_scans (started_at desc);
create index if not exists scans_integration_idx on portal_scans (integration, started_at desc);
create index if not exists scans_run_idx on portal_scans (run_id);

-- ---------------------------------------------------------------- new columns on existing tables
alter table jobs add column if not exists portal text;               -- where the posting lives (linkedin, indeed, naukri, greenhouse...)
alter table jobs add column if not exists scan_id uuid references portal_scans(id) on delete set null;
alter table jobs add column if not exists run_id uuid references automation_runs(id) on delete set null;
alter table jobs add column if not exists salary_min numeric;
alter table jobs add column if not exists salary_max numeric;
alter table jobs add column if not exists salary_currency text;
alter table jobs add column if not exists decided_at timestamptz;     -- when the match decision was made
create index if not exists jobs_portal_idx on jobs (portal);
create index if not exists jobs_country_idx on jobs (country);
create index if not exists jobs_run_idx on jobs (run_id);

alter table applications add column if not exists job_snapshot jsonb;        -- job as it was when prepared
alter table applications add column if not exists profile_snapshot jsonb;    -- original (master) resume source at that moment
alter table applications add column if not exists submission jsonb;          -- exactly what was entered and attached, and the outcome
alter table applications add column if not exists run_id uuid references automation_runs(id) on delete set null;
alter table applications add column if not exists portal text;
alter table applications add column if not exists country text;
create index if not exists applications_country_idx on applications (country);
create index if not exists applications_portal_idx on applications (portal);

-- Backfill origin portal for jobs stored before this migration. Mirrors portalFromUrl() in src/lib/jobs/portal.ts
-- (matches the real hostname, so "linkedin.com.evil.com" is not LinkedIn).
update jobs j set portal = case
  when h.host ~ '(^|\.)linkedin\.com$'                          then 'linkedin'
  when h.host ~ '(^|\.)indeed\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$'                 then 'indeed'
  when h.host ~ '(^|\.)glassdoor\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$'              then 'glassdoor'
  when h.host ~ '(^|\.)naukri\.com$'                            then 'naukri'
  when h.host ~ '(^|\.)(foundit\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})|monsterindia\.com)$'  then 'foundit'
  when h.host ~ '(^|\.)shine\.com$'                             then 'shine'
  when h.host ~ '(^|\.)instahyre\.com$'                         then 'instahyre'
  when h.host ~ '(^|\.)cutshort\.io$'                           then 'cutshort'
  when h.host ~ '(^|\.)(wellfound\.com|angel\.co)$'            then 'wellfound'
  when h.host ~ '(^|\.)internshala\.com$'                       then 'internshala'
  when h.host ~ '(^|\.)timesjobs\.com$'                         then 'timesjobs'
  when h.host ~ '(^|\.)apna\.co$'                               then 'apna'
  when h.host ~ '(^|\.)greenhouse\.io$'                         then 'greenhouse'
  when h.host ~ '(^|\.)lever\.co$'                              then 'lever'
  when h.host ~ '(^|\.)remotive\.(com|io)$'              then 'remotive'
  else split_part(j.source, ':', 1)
end
from (select id, lower(coalesce(substring(url from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#@]+)'), '')) as host from jobs where portal is null) h
where j.id = h.id;

update applications a set portal = j.portal, country = j.country
from jobs j where a.job_id = j.id and a.portal is null;

-- ---------------------------------------------------------------- activity log
create table if not exists activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  level text not null default 'info' check (level in ('info','warn','error')),
  kind text not null,                           -- scan.finished, job.rejected, resume.generated, application.submitted, config.changed ...
  run_id uuid references automation_runs(id) on delete set null,
  scan_id uuid references portal_scans(id) on delete set null,
  integration text,
  portal text,
  country text,
  company text,
  job_id uuid references jobs(id) on delete set null,
  application_id uuid references applications(id) on delete set null,
  status text,
  message text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists log_at_idx on activity_log (at desc);
create index if not exists log_kind_idx on activity_log (kind, at desc);
create index if not exists log_portal_idx on activity_log (portal, at desc);
create index if not exists log_country_idx on activity_log (country, at desc);
create index if not exists log_company_idx on activity_log (company);
create index if not exists log_run_idx on activity_log (run_id);
create index if not exists log_job_idx on activity_log (job_id);
create index if not exists log_app_idx on activity_log (application_id);

-- ---------------------------------------------------------------- country preferences
create table if not exists country_prefs (
  country text primary key check (country ~ '^[a-z]{2}$'),
  enabled boolean not null default true,
  titles text[] not null default '{}',
  industries text[] not null default '{}',
  locations text[] not null default '{}',
  remote text not null default 'any' check (remote in ('any','remote_only','hybrid_ok','onsite_only')),
  salary_min numeric check (salary_min is null or salary_min >= 0),
  salary_max numeric check (salary_max is null or salary_max >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  work_authorisation text,
  needs_sponsorship boolean,
  notes text,
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_min <= salary_max)
);

-- ---------------------------------------------------------------- daily reports
create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  timezone text not null default 'UTC',
  status text not null default 'ok' check (status in ('ok','error')),
  generated_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  body text not null default '',
  delivered boolean not null default false,
  error text,
  unique (report_date, timezone)
);

-- ---------------------------------------------------------------- row level security (server uses the service role)
alter table integrations   enable row level security;
alter table schedules      enable row level security;
alter table automation_runs enable row level security;
alter table portal_scans   enable row level security;
alter table activity_log   enable row level security;
alter table country_prefs  enable row level security;
alter table daily_reports  enable row level security;

-- make the API layer notice the new tables and columns immediately
notify pgrst, 'reload schema';
