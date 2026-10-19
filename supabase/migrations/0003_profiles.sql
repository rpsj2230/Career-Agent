-- 0003: several profiles in one app (yourself, family members, a second profile of your own).
-- Everything that belongs to one person (resume data, answers, jobs, applications, schedules, settings, logs, ...) gets a profile_id.
-- Everything that belongs to the whole app stays shared: model rows and keys, job-source keys, who may sign in.
-- Idempotent: safe to run more than once. Run after 0002. Your existing data becomes the first (default) profile; nothing is lost.

-- ---------------------------------------------------------------- the profiles
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  email text,                                   -- this person's own address: they get every notification for their profile
  is_default boolean not null default false,    -- the profile that existed before profiles did (yours)
  enabled boolean not null default true,        -- off = the automation skips this profile
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_one_default on profiles (is_default) where is_default;
alter table profiles enable row level security;

-- the first profile = the data that already exists
insert into profiles (name, email, is_default)
select coalesce(nullif(btrim((select data #>> '{basics,name}' from profile limit 1)), ''), 'Main profile'),
       (select value ->> 'email' from settings where key = 'owner'),
       true
where not exists (select 1 from profiles);

-- rows written without a profile (for example by an older copy of the app during an update) land in the default profile
create or replace function default_profile_id() returns uuid language sql stable as $$
  select id from profiles where is_default limit 1
$$;

-- ---------------------------------------------------------------- app-wide settings move to their own table
create table if not exists shared_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table shared_settings enable row level security;
insert into shared_settings (key, value, updated_at)
  select key, value, updated_at from settings
  where key in ('owner', 'team', 'model_keys', 'model_keys_shared', 'integration_keys', 'telegram_buttons', 'apify_usage', 'automation_tick', 'local_model', 'local_model_test')
on conflict (key) do nothing;
delete from settings
  where key in ('owner', 'team', 'model_keys', 'model_keys_shared', 'integration_keys', 'telegram_buttons', 'apify_usage', 'automation_tick', 'local_model', 'local_model_test');

-- ---------------------------------------------------------------- profile_id on everything personal
do $$
declare t text;
begin
  foreach t in array array[
    'profile', 'answer_bank', 'settings', 'jobs', 'job_scores', 'documents', 'applications', 'apply_events',
    'integrations', 'schedules', 'automation_runs', 'portal_scans', 'activity_log', 'country_prefs', 'daily_reports'
  ] loop
    execute format('alter table %I add column if not exists profile_id uuid references profiles(id) on delete cascade', t);
    execute format('update %I set profile_id = default_profile_id() where profile_id is null', t);
    execute format('alter table %I alter column profile_id set default default_profile_id()', t);
    execute format('alter table %I alter column profile_id set not null', t);
    execute format('create index if not exists %I on %I (profile_id)', t || '_profile_idx', t);
  end loop;
end $$;

-- a job's score, documents, application and history always belong to the same profile as the job
update job_scores s set profile_id = j.profile_id from jobs j where j.id = s.job_id and s.profile_id <> j.profile_id;
update documents d set profile_id = j.profile_id from jobs j where j.id = d.job_id and d.profile_id <> j.profile_id;
update applications a set profile_id = j.profile_id from jobs j where j.id = a.job_id and a.profile_id <> j.profile_id;
update apply_events e set profile_id = a.profile_id from applications a where a.id = e.application_id and e.profile_id <> a.profile_id;

-- ---------------------------------------------------------------- keys that were unique across the app are now unique per profile
create or replace function pg_temp.rekey(tbl regclass, kind "char", newcols text) returns void language plpgsql as $$
declare c record;
begin
  if exists (select 1 from pg_constraint where conrelid = tbl and contype = kind and pg_get_constraintdef(oid) like '%profile_id%') then
    return;
  end if;
  for c in select conname from pg_constraint where conrelid = tbl and contype = kind loop
    execute format('alter table %s drop constraint %I', tbl, c.conname);
  end loop;
  execute format('alter table %s add %s (%s)', tbl, case kind when 'p' then 'primary key' else 'unique' end, newcols);
end $$;

select pg_temp.rekey('settings', 'p', 'profile_id, key');
select pg_temp.rekey('answer_bank', 'p', 'profile_id, key');
select pg_temp.rekey('integrations', 'p', 'profile_id, id');
select pg_temp.rekey('country_prefs', 'p', 'profile_id, country');
select pg_temp.rekey('jobs', 'u', 'profile_id, source, external_id');
select pg_temp.rekey('daily_reports', 'u', 'profile_id, report_date, timezone');

-- the old table allowed exactly one row (id = 1); it now holds one row per profile
do $$
declare c record;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'profile'::regclass and contype = 'p' and pg_get_constraintdef(oid) like '%profile_id%') then
    for c in select conname from pg_constraint where conrelid = 'profile'::regclass and contype in ('c', 'p') loop
      execute format('alter table profile drop constraint %I', c.conname);
    end loop;
    alter table profile add primary key (profile_id);
  end if;
end $$;

-- the mailbox (the address a person applies from, and where their job alerts arrive) belongs to one profile; the other job-source keys stay shared
insert into settings (profile_id, key, value)
select default_profile_id(), 'mailbox_keys', jsonb_object_agg(e.k, e.v)
from shared_settings s, jsonb_each(s.value) as e(k, v)
where s.key = 'integration_keys' and e.k like 'mailbox.%'
having count(*) > 0
on conflict (profile_id, key) do nothing;
update shared_settings
set value = coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(shared_settings.value) as e(k, v) where e.k not like 'mailbox.%'), '{}'::jsonb)
where key = 'integration_keys';
