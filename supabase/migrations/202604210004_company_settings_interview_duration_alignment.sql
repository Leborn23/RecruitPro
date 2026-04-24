update public.company_settings
set interview_duration_minutes = 15
where interview_duration_minutes = 10;

alter table public.company_settings
drop constraint if exists company_settings_interview_duration_minutes_check;

alter table public.company_settings
add constraint company_settings_interview_duration_minutes_check
check (interview_duration_minutes in (15, 20, 30, 45));
