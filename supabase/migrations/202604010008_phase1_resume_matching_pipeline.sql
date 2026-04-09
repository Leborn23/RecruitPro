alter table public.resume_uploads
  add column if not exists pipeline_stage text not null default 'uploaded',
  add column if not exists stage_started_at timestamptz,
  add column if not exists stage_finished_at timestamptz,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists file_hash text;

create index if not exists idx_resume_uploads_pipeline_stage on public.resume_uploads (pipeline_stage);
create index if not exists idx_resume_uploads_status_stage on public.resume_uploads (status, pipeline_stage);

create table if not exists public.parsed_resume_profiles (
  id uuid primary key default gen_random_uuid(),
  resume_upload_id uuid not null unique references public.resume_uploads(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  basic_profile jsonb not null default '{}'::jsonb,
  explicit_skills jsonb not null default '[]'::jsonb,
  inferred_skills jsonb not null default '[]'::jsonb,
  work_experience jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  extraction_confidence jsonb not null default '{}'::jsonb,
  parser_raw_json jsonb,
  llm_raw_json jsonb,
  prompt_version text,
  model_version text,
  pipeline_version text not null default 'phase1',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_parsed_resume_profiles_candidate_id on public.parsed_resume_profiles (candidate_id);
create index if not exists idx_parsed_resume_profiles_created_at on public.parsed_resume_profiles (created_at desc);

create table if not exists public.parsed_resume_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.parsed_resume_profiles(id) on delete cascade,
  project_index integer not null default 0 check (project_index >= 0),
  project_name text not null,
  project_summary text,
  candidate_role text,
  responsibilities jsonb not null default '[]'::jsonb,
  tech_stack jsonb not null default '[]'::jsonb,
  domain text,
  complexity_level text check (complexity_level in ('low', 'medium', 'high', 'unknown')),
  leadership_level text check (leadership_level in ('aware', 'used', 'independent', 'lead', 'unknown')),
  evidence_spans jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_parsed_resume_projects_profile_id on public.parsed_resume_projects (profile_id);
create index if not exists idx_parsed_resume_projects_profile_index on public.parsed_resume_projects (profile_id, project_index);

create table if not exists public.parsed_job_requirements (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.active_positions(id) on delete cascade,
  version_no integer not null default 1 check (version_no >= 1),
  is_active boolean not null default true,
  position_title text not null,
  must_have_skills jsonb not null default '[]'::jsonb,
  nice_to_have_skills jsonb not null default '[]'::jsonb,
  required_experience_years integer check (required_experience_years is null or required_experience_years >= 0),
  education_requirement jsonb not null default '{}'::jsonb,
  industry_preference jsonb not null default '[]'::jsonb,
  project_keywords jsonb not null default '[]'::jsonb,
  seniority_level text,
  core_responsibilities jsonb not null default '[]'::jsonb,
  source_text text,
  llm_raw_json jsonb,
  prompt_version text,
  model_version text,
  pipeline_version text not null default 'phase1',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(position_id, version_no)
);

create index if not exists idx_parsed_job_requirements_position_id on public.parsed_job_requirements (position_id);
create index if not exists idx_parsed_job_requirements_active on public.parsed_job_requirements (position_id, is_active, created_at desc);

create table if not exists public.candidate_position_matches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  position_id uuid not null references public.active_positions(id) on delete cascade,
  profile_id uuid references public.parsed_resume_profiles(id) on delete set null,
  job_requirement_id uuid references public.parsed_job_requirements(id) on delete set null,
  resume_upload_id uuid references public.resume_uploads(id) on delete set null,
  overall_score integer check (overall_score is null or (overall_score between 0 and 100)),
  recommendation text check (recommendation in ('strong_match', 'partial_match', 'weak_match', 'reject')),
  must_have_match_score integer check (must_have_match_score is null or (must_have_match_score between 0 and 100)),
  skill_match_score integer check (skill_match_score is null or (skill_match_score between 0 and 100)),
  project_relevance_score integer check (project_relevance_score is null or (project_relevance_score between 0 and 100)),
  experience_match_score integer check (experience_match_score is null or (experience_match_score between 0 and 100)),
  education_match_score integer check (education_match_score is null or (education_match_score between 0 and 100)),
  matched_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,
  matched_projects jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  summary_reason text,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence_links jsonb not null default '[]'::jsonb,
  requirement_breakdown jsonb not null default '[]'::jsonb,
  llm_raw_json jsonb,
  prompt_version text,
  model_version text,
  pipeline_version text not null default 'phase1',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_candidate_position_matches_candidate on public.candidate_position_matches (candidate_id, created_at desc);
create index if not exists idx_candidate_position_matches_position on public.candidate_position_matches (position_id, created_at desc);
create index if not exists idx_candidate_position_matches_score on public.candidate_position_matches (overall_score desc nulls last);
create index if not exists idx_candidate_position_matches_resume_upload on public.candidate_position_matches (resume_upload_id);

drop trigger if exists trg_parsed_resume_profiles_updated_at on public.parsed_resume_profiles;
create trigger trg_parsed_resume_profiles_updated_at
before update on public.parsed_resume_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_parsed_resume_projects_updated_at on public.parsed_resume_projects;
create trigger trg_parsed_resume_projects_updated_at
before update on public.parsed_resume_projects
for each row
execute function public.set_updated_at();

drop trigger if exists trg_parsed_job_requirements_updated_at on public.parsed_job_requirements;
create trigger trg_parsed_job_requirements_updated_at
before update on public.parsed_job_requirements
for each row
execute function public.set_updated_at();

drop trigger if exists trg_candidate_position_matches_updated_at on public.candidate_position_matches;
create trigger trg_candidate_position_matches_updated_at
before update on public.candidate_position_matches
for each row
execute function public.set_updated_at();

alter table public.parsed_resume_profiles enable row level security;
alter table public.parsed_resume_projects enable row level security;
alter table public.parsed_job_requirements enable row level security;
alter table public.candidate_position_matches enable row level security;

drop policy if exists parsed_resume_profiles_select on public.parsed_resume_profiles;
create policy parsed_resume_profiles_select
on public.parsed_resume_profiles
for select
to authenticated
using (
  public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('VIEW_CANDIDATES')
);

drop policy if exists parsed_resume_profiles_insert on public.parsed_resume_profiles;
create policy parsed_resume_profiles_insert
on public.parsed_resume_profiles
for insert
to authenticated
with check (
  public.user_has_permission('SCREEN_RESUMES')
  and created_by = auth.uid()
);

drop policy if exists parsed_resume_profiles_update on public.parsed_resume_profiles;
create policy parsed_resume_profiles_update
on public.parsed_resume_profiles
for update
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists parsed_resume_profiles_delete on public.parsed_resume_profiles;
create policy parsed_resume_profiles_delete
on public.parsed_resume_profiles
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists parsed_resume_projects_select on public.parsed_resume_projects;
create policy parsed_resume_projects_select
on public.parsed_resume_projects
for select
to authenticated
using (
  public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('VIEW_CANDIDATES')
);

drop policy if exists parsed_resume_projects_insert on public.parsed_resume_projects;
create policy parsed_resume_projects_insert
on public.parsed_resume_projects
for insert
to authenticated
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists parsed_resume_projects_update on public.parsed_resume_projects;
create policy parsed_resume_projects_update
on public.parsed_resume_projects
for update
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists parsed_resume_projects_delete on public.parsed_resume_projects;
create policy parsed_resume_projects_delete
on public.parsed_resume_projects
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists parsed_job_requirements_select on public.parsed_job_requirements;
create policy parsed_job_requirements_select
on public.parsed_job_requirements
for select
to authenticated
using (
  public.user_has_permission('MANAGE_POSITIONS')
  or public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('VIEW_CANDIDATES')
);

drop policy if exists parsed_job_requirements_insert on public.parsed_job_requirements;
create policy parsed_job_requirements_insert
on public.parsed_job_requirements
for insert
to authenticated
with check (
  (public.user_has_permission('MANAGE_POSITIONS') or public.user_has_permission('SCREEN_RESUMES'))
  and created_by = auth.uid()
);

drop policy if exists parsed_job_requirements_update on public.parsed_job_requirements;
create policy parsed_job_requirements_update
on public.parsed_job_requirements
for update
to authenticated
using (public.user_has_permission('MANAGE_POSITIONS') or public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('MANAGE_POSITIONS') or public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists parsed_job_requirements_delete on public.parsed_job_requirements;
create policy parsed_job_requirements_delete
on public.parsed_job_requirements
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists candidate_position_matches_select on public.candidate_position_matches;
create policy candidate_position_matches_select
on public.candidate_position_matches
for select
to authenticated
using (
  public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
  or public.user_has_permission('VIEW_DASHBOARD')
);

drop policy if exists candidate_position_matches_insert on public.candidate_position_matches;
create policy candidate_position_matches_insert
on public.candidate_position_matches
for insert
to authenticated
with check (
  public.user_has_permission('SCREEN_RESUMES')
  and created_by = auth.uid()
);

drop policy if exists candidate_position_matches_update on public.candidate_position_matches;
create policy candidate_position_matches_update
on public.candidate_position_matches
for update
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists candidate_position_matches_delete on public.candidate_position_matches;
create policy candidate_position_matches_delete
on public.candidate_position_matches
for delete
to authenticated
using (public.is_super_admin());
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resume-files',
  'resume-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

drop policy if exists resume_files_select on storage.objects;
create policy resume_files_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'resume-files'
  and (
    public.user_has_permission('SCREEN_RESUMES')
    or public.user_has_permission('VIEW_CANDIDATES')
  )
);

drop policy if exists resume_files_insert on storage.objects;
create policy resume_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'resume-files'
  and public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists resume_files_update on storage.objects;
create policy resume_files_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'resume-files'
  and public.user_has_permission('SCREEN_RESUMES')
)
with check (
  bucket_id = 'resume-files'
  and public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists resume_files_delete on storage.objects;
create policy resume_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'resume-files'
  and public.is_super_admin()
);
