alter table public.company_settings
  add column if not exists active_llm_model_id uuid;

create table if not exists public.llm_model_configs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('custom','openai','anthropic','google','deepseek','openrouter','ollama','vllm','zhipu','moonshot')),
  mode text not null check (mode in ('local','api_key')),
  model_name text not null,
  base_url text,
  api_key_encrypted text,
  api_version text not null default '2023-06-01',
  max_tokens integer not null default 2048 check (max_tokens between 128 and 8192),
  temperature numeric(3,2) not null default 0.2 check (temperature >= 0 and temperature <= 2),
  timeout_ms integer not null default 45000 check (timeout_ms between 5000 and 180000),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(provider, mode, model_name, base_url)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_active_llm_model_id_fkey'
  ) then
    alter table public.company_settings
      add constraint company_settings_active_llm_model_id_fkey
      foreign key (active_llm_model_id)
      references public.llm_model_configs(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_llm_model_configs_is_active on public.llm_model_configs (is_active);
create index if not exists idx_llm_model_configs_created_at on public.llm_model_configs (created_at desc);

-- migrate legacy single-model settings into one config row once
insert into public.llm_model_configs (
  provider,
  mode,
  model_name,
  base_url,
  api_key_encrypted,
  api_version,
  max_tokens,
  temperature,
  timeout_ms,
  is_active
)
select
  coalesce(nullif(cs.llm_provider, ''), 'custom'),
  case when cs.llm_mode = 'local' then 'local' else 'api_key' end,
  nullif(cs.llm_model_name, ''),
  cs.llm_base_url,
  cs.llm_api_key,
  coalesce(nullif(cs.llm_api_version, ''), '2023-06-01'),
  coalesce(cs.llm_max_tokens, 2048),
  coalesce(cs.llm_temperature, 0.2),
  coalesce(cs.llm_timeout_ms, 45000),
  true
from public.company_settings cs
where cs.active_llm_model_id is null
  and nullif(cs.llm_model_name, '') is not null
on conflict (provider, mode, model_name, base_url) do nothing;

update public.company_settings cs
set active_llm_model_id = sub.id
from (
  select id
  from public.llm_model_configs
  order by created_at asc
  limit 1
) sub
where cs.active_llm_model_id is null;

drop trigger if exists trg_llm_model_configs_updated_at on public.llm_model_configs;
create trigger trg_llm_model_configs_updated_at
before update on public.llm_model_configs
for each row
execute function public.set_updated_at();

alter table public.llm_model_configs enable row level security;

drop policy if exists llm_model_configs_select on public.llm_model_configs;
create policy llm_model_configs_select
on public.llm_model_configs
for select
to authenticated
using (public.user_has_permission('MANAGE_SETTINGS'));

drop policy if exists llm_model_configs_insert on public.llm_model_configs;
create policy llm_model_configs_insert
on public.llm_model_configs
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_SETTINGS')
  and created_by = auth.uid()
);

drop policy if exists llm_model_configs_update on public.llm_model_configs;
create policy llm_model_configs_update
on public.llm_model_configs
for update
to authenticated
using (public.user_has_permission('MANAGE_SETTINGS'))
with check (public.user_has_permission('MANAGE_SETTINGS'));

drop policy if exists llm_model_configs_delete on public.llm_model_configs;
create policy llm_model_configs_delete
on public.llm_model_configs
for delete
to authenticated
using (public.user_has_permission('MANAGE_SETTINGS'));
