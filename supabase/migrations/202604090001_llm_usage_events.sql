create table if not exists public.llm_usage_events (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.llm_model_configs(id) on delete set null,
  provider text not null,
  model_name text not null,
  api_protocol text not null check (api_protocol in ('openai', 'anthropic', 'gemini')),
  scene text not null,
  request_scope text,
  resume_upload_id uuid references public.resume_uploads(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,
  position_id uuid references public.active_positions(id) on delete set null,
  interview_session_id uuid references public.interview_sessions(id) on delete set null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  success boolean not null default true,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_llm_usage_events_created_at on public.llm_usage_events (created_at desc);
create index if not exists idx_llm_usage_events_scene_created_at on public.llm_usage_events (scene, created_at desc);
create index if not exists idx_llm_usage_events_model_created_at on public.llm_usage_events (model_name, created_at desc);
create index if not exists idx_llm_usage_events_resume_upload_id on public.llm_usage_events (resume_upload_id);
create index if not exists idx_llm_usage_events_position_id on public.llm_usage_events (position_id);
create index if not exists idx_llm_usage_events_interview_session_id on public.llm_usage_events (interview_session_id);

alter table public.llm_usage_events enable row level security;

drop policy if exists llm_usage_events_select on public.llm_usage_events;
create policy llm_usage_events_select
on public.llm_usage_events
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
  or public.user_has_permission('MANAGE_SETTINGS')
);

drop policy if exists llm_usage_events_insert on public.llm_usage_events;
create policy llm_usage_events_insert
on public.llm_usage_events
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.user_has_permission('VIEW_CANDIDATES')
    or public.user_has_permission('MANAGE_INTERVIEWS')
    or public.user_has_permission('MANAGE_SETTINGS')
  )
);
