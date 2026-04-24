begin;

create extension if not exists "pgcrypto";

create table if not exists public.market_salary_raw_records (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_job_title text not null,
  source_city text,
  source_salary_text text not null default '',
  salary_min numeric,
  salary_max numeric,
  salary_period text not null default 'monthly',
  currency text not null default 'CNY',
  experience_text text,
  education_text text,
  company_name text,
  captured_at timestamptz not null default timezone('utc', now()),
  raw_payload jsonb not null default '{}'::jsonb,
  hash_key text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_market_salary_raw_records_source_captured_at
  on public.market_salary_raw_records (source, captured_at desc);

create table if not exists public.market_salary_normalized_records (
  id uuid primary key default gen_random_uuid(),
  raw_record_id uuid not null references public.market_salary_raw_records(id) on delete cascade,
  normalized_role text not null default 'unknown',
  normalized_city text not null default 'unknown',
  normalized_level text not null default 'unknown',
  salary_min_monthly numeric,
  salary_median_monthly numeric,
  salary_max_monthly numeric,
  source text not null,
  captured_at timestamptz not null,
  is_valid boolean not null default false,
  invalid_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (raw_record_id)
);

create index if not exists idx_market_salary_normalized_records_dimensions
  on public.market_salary_normalized_records (normalized_role, normalized_city, normalized_level);

create table if not exists public.market_salary_benchmarks (
  id uuid primary key default gen_random_uuid(),
  role_key text not null,
  city_key text not null,
  level_key text not null,
  min_salary numeric not null,
  median_salary numeric not null,
  max_salary numeric not null,
  sample_size integer not null default 0,
  source_count integer not null default 0,
  latest_source_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (role_key, city_key, level_key)
);

create index if not exists idx_market_salary_benchmarks_updated_at
  on public.market_salary_benchmarks (updated_at desc);

create table if not exists public.market_salary_crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  records_fetched integer not null default 0,
  records_valid integer not null default 0,
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_market_salary_crawl_jobs_created_at
  on public.market_salary_crawl_jobs (created_at desc);

create index if not exists idx_market_salary_crawl_jobs_status
  on public.market_salary_crawl_jobs (status);

drop trigger if exists trg_market_salary_benchmarks_updated_at on public.market_salary_benchmarks;
create trigger trg_market_salary_benchmarks_updated_at
before update on public.market_salary_benchmarks
for each row execute function public.set_updated_at();

commit;
