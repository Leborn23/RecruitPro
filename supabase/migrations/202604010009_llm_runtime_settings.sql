alter table public.company_settings
  add column if not exists llm_mode text not null default 'bootstrap' check (llm_mode in ('bootstrap', 'local', 'api_key')),
  add column if not exists llm_base_url text,
  add column if not exists llm_model_name text,
  add column if not exists llm_api_key text,
  add column if not exists llm_temperature numeric(3,2) not null default 0.2 check (llm_temperature >= 0 and llm_temperature <= 2),
  add column if not exists llm_timeout_ms integer not null default 45000 check (llm_timeout_ms between 5000 and 180000);

update public.company_settings
set llm_model_name = coalesce(llm_model_name, default_model)
where llm_model_name is null;
