alter table public.company_settings
  add column if not exists match_weight_must_have integer not null default 35,
  add column if not exists match_weight_skills integer not null default 25,
  add column if not exists match_weight_project integer not null default 20,
  add column if not exists match_weight_experience integer not null default 15,
  add column if not exists match_weight_education integer not null default 5;

alter table public.company_settings
  drop constraint if exists company_settings_match_weight_must_have_check;
alter table public.company_settings
  add constraint company_settings_match_weight_must_have_check check (match_weight_must_have between 0 and 100);

alter table public.company_settings
  drop constraint if exists company_settings_match_weight_skills_check;
alter table public.company_settings
  add constraint company_settings_match_weight_skills_check check (match_weight_skills between 0 and 100);

alter table public.company_settings
  drop constraint if exists company_settings_match_weight_project_check;
alter table public.company_settings
  add constraint company_settings_match_weight_project_check check (match_weight_project between 0 and 100);

alter table public.company_settings
  drop constraint if exists company_settings_match_weight_experience_check;
alter table public.company_settings
  add constraint company_settings_match_weight_experience_check check (match_weight_experience between 0 and 100);

alter table public.company_settings
  drop constraint if exists company_settings_match_weight_education_check;
alter table public.company_settings
  add constraint company_settings_match_weight_education_check check (match_weight_education between 0 and 100);
