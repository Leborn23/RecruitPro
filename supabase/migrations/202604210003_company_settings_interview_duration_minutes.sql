alter table public.company_settings
add column if not exists interview_duration_minutes integer not null default 20;

alter table public.company_settings
drop constraint if exists company_settings_interview_duration_minutes_check;

alter table public.company_settings
add constraint company_settings_interview_duration_minutes_check
check (interview_duration_minutes in (10, 15, 20, 30));
