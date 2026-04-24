alter table public.company_settings
add column if not exists interview_question_count integer not null default 5;

alter table public.company_settings
drop constraint if exists company_settings_interview_question_count_check;

alter table public.company_settings
add constraint company_settings_interview_question_count_check
check (interview_question_count in (3, 5, 8, 10));
