begin;

create extension if not exists "pgcrypto";

create table if not exists public.candidate_salary_profiles (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  position_id uuid references public.active_positions(id) on delete set null,
  expected_salary_min numeric,
  expected_salary_max numeric,
  current_salary numeric,
  budget_min numeric,
  budget_max numeric,
  offer_salary numeric,
  offer_status text not null default 'draft',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (candidate_id, position_id)
);

create index if not exists idx_candidate_salary_profiles_candidate_id
  on public.candidate_salary_profiles (candidate_id);

create index if not exists idx_candidate_salary_profiles_position_id
  on public.candidate_salary_profiles (position_id);

drop trigger if exists trg_candidate_salary_profiles_updated_at on public.candidate_salary_profiles;
create trigger trg_candidate_salary_profiles_updated_at
before update on public.candidate_salary_profiles
for each row
execute function public.set_updated_at();

alter table public.candidate_salary_profiles enable row level security;

drop policy if exists candidate_salary_profiles_select on public.candidate_salary_profiles;
create policy candidate_salary_profiles_select
on public.candidate_salary_profiles
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_SALARY')
  or public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists candidate_salary_profiles_insert on public.candidate_salary_profiles;
create policy candidate_salary_profiles_insert
on public.candidate_salary_profiles
for insert
to authenticated
with check (
  public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists candidate_salary_profiles_update on public.candidate_salary_profiles;
create policy candidate_salary_profiles_update
on public.candidate_salary_profiles
for update
to authenticated
using (
  public.user_has_permission('SCREEN_RESUMES')
)
with check (
  public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists candidate_salary_profiles_delete on public.candidate_salary_profiles;
create policy candidate_salary_profiles_delete
on public.candidate_salary_profiles
for delete
to authenticated
using (
  public.is_super_admin()
);

commit;
