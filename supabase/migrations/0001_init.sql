-- Career-Agent schema. Single-user personal tool: access is via the service-role key
-- from server code only; RLS is enabled with no policies so the anon key can read nothing.

create extension if not exists pgcrypto;

create table if not exists profile (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  source_notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists answer_bank (
  key text primary key,
  question text not null,
  answer text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  dedupe_key text not null,
  title text not null,
  company text not null,
  country text,
  location text,
  url text not null,
  description text not null default '',
  salary_text text,
  posted_at timestamptz,
  found_at timestamptz not null default now(),
  apply_type text not null default 'unknown'
    check (apply_type in ('greenhouse','lever','email','linkedin','portal','unknown')),
  status text not null default 'new'
    check (status in ('new','queued','skipped','saved','prepared','applied')),
  skip_reason text,
  unique (source, external_id)
);
create index if not exists jobs_dedupe_idx on jobs (dedupe_key);
create index if not exists jobs_status_idx on jobs (status, found_at desc);

create table if not exists job_scores (
  job_id uuid primary key references jobs(id) on delete cascade,
  score int not null check (score between 0 and 100),
  detail jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('resume','cover_letter')),
  version int not null default 1,
  content jsonb not null,            -- structured tailored resume / cover letter text
  diff jsonb,                        -- per-bullet original vs tailored
  verification jsonb,                -- fact-id mapping + issues found
  storage_path text,                 -- docx in the 'documents' bucket
  model text,
  created_at timestamptz not null default now(),
  unique (job_id, kind, version)
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  resume_doc_id uuid references documents(id),
  cover_doc_id uuid references documents(id),
  answers jsonb not null default '[]'::jsonb,   -- [{question, answer, source}]
  status text not null default 'prepared'
    check (status in ('prepared','approved','submitting','submitted','assisted_pending','needs_input','failed')),
  method text check (method in ('automated','assisted')),
  lifecycle text not null default 'none'
    check (lifecycle in ('none','applied','interview','rejected','offer','withdrawn')),
  notes text,
  error text,
  screenshot_path text,
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists apply_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  detail jsonb not null default '{}'::jsonb
);

create table if not exists model_configs (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  provider text not null,
  base_url text not null,
  model text not null,
  api_key_env text,                 -- NAME of the env var holding the key (never the key)
  tasks text[] not null default '{score,tailor,extract}',
  priority int not null default 100, -- lower = tried first
  daily_cap int,                     -- max successful calls per UTC day; null = unlimited
  enabled boolean not null default true,
  notes text
);

create table if not exists model_usage (
  id bigint generated always as identity primary key,
  model_config_id uuid references model_configs(id) on delete set null,
  model_label text not null,
  task text not null,
  job_id uuid,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists model_usage_day_idx on model_usage (model_label, created_at desc);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into settings (key, value) values
  ('discovery', '{"countries":["in"],"roles":["Product Manager"],"greenhouse_boards":[],"lever_companies":[],"max_age_days":14}'),
  ('scoring',   '{"threshold":65}'),
  ('caps',      '{"daily_total":15,"daily_linkedin":10,"weekly_linkedin":40,"linkedin_automation_enabled":false}')
on conflict (key) do nothing;

-- Free-tier / low-cost providers (OpenAI-compatible). Model ids and limits change often:
-- verify them and edit on the Models page. A row is skipped automatically if its key env var is unset.
insert into model_configs (label, provider, base_url, model, api_key_env, priority, daily_cap, notes) values
  ('gemini-flash',   'google',     'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-flash-latest',                    'GEMINI_API_KEY',     10, 200, 'Google AI Studio free tier'),
  ('groq-llama',     'groq',       'https://api.groq.com/openai/v1',                           'llama-3.3-70b-versatile',                'GROQ_API_KEY',       20, 500, 'Groq free tier'),
  ('cerebras-llama', 'cerebras',   'https://api.cerebras.ai/v1',                               'llama-3.3-70b',                          'CEREBRAS_API_KEY',   30, 500, 'Cerebras free tier'),
  ('openrouter-free','openrouter', 'https://openrouter.ai/api/v1',                             'meta-llama/llama-3.3-70b-instruct:free', 'OPENROUTER_API_KEY', 40, 100, 'OpenRouter :free models'),
  ('mistral-small',  'mistral',    'https://api.mistral.ai/v1',                                'mistral-small-latest',                   'MISTRAL_API_KEY',    50, 200, 'Mistral free experimentation tier'),
  ('github-models',  'github',     'https://models.github.ai/inference',                       'openai/gpt-4.1-mini',                    'GITHUB_MODELS_TOKEN',60, 100, 'GitHub Models free tier'),
  ('ollama-local',   'ollama',     'http://localhost:11434/v1',                                 'llama3.1:8b',                            null,                 90, null,'Local only; disable on Vercel'),
  ('claude-sonnet',  'anthropic',  'https://api.anthropic.com/v1',                             'claude-sonnet-5-5',                      'ANTHROPIC_API_KEY',  5,  null,'Optional paid; needs API credits (not a Claude subscription). Disabled by default.')
on conflict (label) do nothing;
update model_configs set enabled = false where label in ('ollama-local','claude-sonnet');

alter table profile        enable row level security;
alter table answer_bank    enable row level security;
alter table settings       enable row level security;
alter table jobs           enable row level security;
alter table job_scores     enable row level security;
alter table documents      enable row level security;
alter table applications   enable row level security;
alter table apply_events   enable row level security;
alter table model_configs  enable row level security;
alter table model_usage    enable row level security;
