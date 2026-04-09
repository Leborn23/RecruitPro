alter table public.company_settings
  add column if not exists llm_retry_enabled boolean not null default true,
  add column if not exists llm_strategy_mode text not null default 'balanced';

alter table public.company_settings
  drop constraint if exists company_settings_llm_strategy_mode_check;

alter table public.company_settings
  add constraint company_settings_llm_strategy_mode_check
  check (llm_strategy_mode in ('quality', 'balanced', 'cost'));

update public.company_settings
set llm_retry_enabled = coalesce(llm_retry_enabled, true),
    llm_strategy_mode = case
      when llm_strategy_mode in ('quality', 'balanced', 'cost') then llm_strategy_mode
      else 'balanced'
    end;
