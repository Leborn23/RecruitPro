alter table public.company_settings
  add column if not exists active_interview_llm_model_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_active_interview_llm_model_id_fkey'
  ) then
    alter table public.company_settings
      add constraint company_settings_active_interview_llm_model_id_fkey
      foreign key (active_interview_llm_model_id)
      references public.llm_model_configs(id)
      on delete set null;
  end if;
end;
$$;
