alter table public.upcoming_interviews
  add column if not exists status text not null default 'scheduled',
  add column if not exists join_url text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists session_id uuid,
  add column if not exists ai_report_id uuid,
  add column if not exists updated_by uuid references auth.users(id);

update public.upcoming_interviews
set status = 'scheduled'
where status is null
   or status not in ('scheduled', 'ready', 'in_progress', 'completed', 'cancelled', 'no_show', 'failed');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'upcoming_interviews_status_check'
  ) then
    alter table public.upcoming_interviews
      add constraint upcoming_interviews_status_check
      check (status in ('scheduled', 'ready', 'in_progress', 'completed', 'cancelled', 'no_show', 'failed'));
  end if;
end;
$$;

create index if not exists idx_upcoming_interviews_status on public.upcoming_interviews (status);

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.upcoming_interviews(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  position_id uuid references public.active_positions(id) on delete set null,
  mode text not null default 'async_qa',
  status text not null default 'preparing',
  question_plan jsonb not null default '[]'::jsonb,
  context_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_sessions_mode_check'
  ) then
    alter table public.interview_sessions
      add constraint interview_sessions_mode_check
      check (mode in ('async_qa', 'ai_live', 'ai_copilot'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_sessions_status_check'
  ) then
    alter table public.interview_sessions
      add constraint interview_sessions_status_check
      check (status in ('preparing', 'ready', 'running', 'scoring', 'done', 'failed', 'cancelled'));
  end if;
end;
$$;

create index if not exists idx_interview_sessions_interview_id on public.interview_sessions (interview_id);
create index if not exists idx_interview_sessions_candidate_id on public.interview_sessions (candidate_id);
create index if not exists idx_interview_sessions_status on public.interview_sessions (status);
create index if not exists idx_interview_sessions_created_at on public.interview_sessions (created_at desc);
create unique index if not exists idx_interview_sessions_one_active
  on public.interview_sessions (interview_id)
  where status in ('preparing', 'ready', 'running', 'scoring');

create table if not exists public.interview_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  turn_no integer not null check (turn_no >= 1),
  speaker text not null,
  content text not null check (char_length(btrim(content)) > 0),
  input_mode text not null default 'text',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  tokens_in integer check (tokens_in is null or tokens_in >= 0),
  tokens_out integer check (tokens_out is null or tokens_out >= 0),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique(session_id, turn_no)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_turns_speaker_check'
  ) then
    alter table public.interview_turns
      add constraint interview_turns_speaker_check
      check (speaker in ('system', 'ai', 'candidate', 'interviewer'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_turns_input_mode_check'
  ) then
    alter table public.interview_turns
      add constraint interview_turns_input_mode_check
      check (input_mode in ('text', 'audio', 'video', 'metadata'));
  end if;
end;
$$;

create index if not exists idx_interview_turns_session_id on public.interview_turns (session_id);
create index if not exists idx_interview_turns_created_at on public.interview_turns (created_at asc);

create table if not exists public.interview_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.interview_sessions(id) on delete cascade,
  interview_id uuid not null references public.upcoming_interviews(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  overall_score integer check (overall_score is null or (overall_score between 0 and 100)),
  dimension_scores jsonb not null default '{}'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  recommendation text,
  evidence jsonb not null default '[]'::jsonb,
  summary text,
  risk_score integer check (risk_score is null or (risk_score between 0 and 100)),
  human_confirmed boolean not null default false,
  human_confirmed_by uuid references auth.users(id),
  human_confirmed_at timestamptz,
  generated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_reports_recommendation_check'
  ) then
    alter table public.interview_reports
      add constraint interview_reports_recommendation_check
      check (recommendation in ('hire', 'hold', 'reject', 'needs_review'));
  end if;
end;
$$;

create index if not exists idx_interview_reports_interview_id on public.interview_reports (interview_id);
create index if not exists idx_interview_reports_candidate_id on public.interview_reports (candidate_id);
create index if not exists idx_interview_reports_recommendation on public.interview_reports (recommendation);
create index if not exists idx_interview_reports_created_at on public.interview_reports (created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'upcoming_interviews_session_id_fkey'
  ) then
    alter table public.upcoming_interviews
      add constraint upcoming_interviews_session_id_fkey
      foreign key (session_id)
      references public.interview_sessions(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'upcoming_interviews_ai_report_id_fkey'
  ) then
    alter table public.upcoming_interviews
      add constraint upcoming_interviews_ai_report_id_fkey
      foreign key (ai_report_id)
      references public.interview_reports(id)
      on delete set null;
  end if;
end;
$$;

drop trigger if exists trg_interview_sessions_updated_at on public.interview_sessions;
create trigger trg_interview_sessions_updated_at
before update on public.interview_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_interview_reports_updated_at on public.interview_reports;
create trigger trg_interview_reports_updated_at
before update on public.interview_reports
for each row
execute function public.set_updated_at();

alter table public.interview_sessions enable row level security;
alter table public.interview_turns enable row level security;
alter table public.interview_reports enable row level security;

drop policy if exists interview_sessions_select on public.interview_sessions;
create policy interview_sessions_select
on public.interview_sessions
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists interview_sessions_insert on public.interview_sessions;
create policy interview_sessions_insert
on public.interview_sessions
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_INTERVIEWS')
  and created_by = auth.uid()
);

drop policy if exists interview_sessions_update on public.interview_sessions;
create policy interview_sessions_update
on public.interview_sessions
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_sessions_delete on public.interview_sessions;
create policy interview_sessions_delete
on public.interview_sessions
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_turns_select on public.interview_turns;
create policy interview_turns_select
on public.interview_turns
for select
to authenticated
using (
  exists (
    select 1
    from public.interview_sessions s
    where s.id = interview_turns.session_id
      and (
        public.user_has_permission('VIEW_DASHBOARD')
        or public.user_has_permission('VIEW_CANDIDATES')
        or public.user_has_permission('MANAGE_INTERVIEWS')
      )
  )
);

drop policy if exists interview_turns_insert on public.interview_turns;
create policy interview_turns_insert
on public.interview_turns
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_INTERVIEWS')
  and created_by = auth.uid()
  and exists (
    select 1
    from public.interview_sessions s
    where s.id = interview_turns.session_id
  )
);

drop policy if exists interview_turns_update on public.interview_turns;
create policy interview_turns_update
on public.interview_turns
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_turns_delete on public.interview_turns;
create policy interview_turns_delete
on public.interview_turns
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_reports_select on public.interview_reports;
create policy interview_reports_select
on public.interview_reports
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists interview_reports_insert on public.interview_reports;
create policy interview_reports_insert
on public.interview_reports
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_INTERVIEWS')
  and generated_by = auth.uid()
);

drop policy if exists interview_reports_update on public.interview_reports;
create policy interview_reports_update
on public.interview_reports
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_reports_delete on public.interview_reports;
create policy interview_reports_delete
on public.interview_reports
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));
