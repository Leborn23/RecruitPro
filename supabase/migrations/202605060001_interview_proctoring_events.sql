insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-proctoring',
  'interview-proctoring',
  false,
  1048576,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.interview_proctoring_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.upcoming_interviews(id) on delete cascade,
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  event_type text not null,
  severity text not null,
  confidence numeric(4,3) not null default 0.500,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms integer not null default 0,
  snapshot_paths jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_proctoring_events_event_type_check'
      and conrelid = 'public.interview_proctoring_events'::regclass
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_event_type_check
      check (
        event_type in (
          'camera_check_passed',
          'camera_denied',
          'camera_closed',
          'no_face',
          'multiple_faces',
          'off_screen_attention',
          'head_turned_left',
          'head_turned_right',
          'head_down',
          'head_up',
          'face_occluded',
          'page_hidden',
          'window_blur'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_proctoring_events_severity_check'
      and conrelid = 'public.interview_proctoring_events'::regclass
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_severity_check
      check (severity in ('low', 'medium', 'high'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_proctoring_events_confidence_check'
      and conrelid = 'public.interview_proctoring_events'::regclass
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_confidence_check
      check (confidence >= 0 and confidence <= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_proctoring_events_duration_ms_check'
      and conrelid = 'public.interview_proctoring_events'::regclass
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_duration_ms_check
      check (duration_ms >= 0);
  end if;
end $$;

create index if not exists idx_interview_proctoring_events_interview_created_at
  on public.interview_proctoring_events (interview_id, created_at desc);

create index if not exists idx_interview_proctoring_events_session_created_at
  on public.interview_proctoring_events (session_id, created_at desc);

create index if not exists idx_interview_proctoring_events_event_type
  on public.interview_proctoring_events (event_type);

alter table public.interview_proctoring_events enable row level security;

drop policy if exists interview_proctoring_events_select on public.interview_proctoring_events;
create policy interview_proctoring_events_select
on public.interview_proctoring_events
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists interview_proctoring_events_insert on public.interview_proctoring_events;
create policy interview_proctoring_events_insert
on public.interview_proctoring_events
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_INTERVIEWS')
  and created_by = auth.uid()
  and exists (
    select 1
    from public.interview_sessions s
    where s.id = interview_proctoring_events.session_id
      and s.interview_id = interview_proctoring_events.interview_id
  )
);

drop policy if exists interview_proctoring_events_update on public.interview_proctoring_events;
create policy interview_proctoring_events_update
on public.interview_proctoring_events
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_proctoring_events_delete on public.interview_proctoring_events;
create policy interview_proctoring_events_delete
on public.interview_proctoring_events
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_proctoring_snapshots_select on storage.objects;
create policy interview_proctoring_snapshots_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'interview-proctoring'
  and (
    public.user_has_permission('VIEW_DASHBOARD')
    or public.user_has_permission('VIEW_CANDIDATES')
    or public.user_has_permission('MANAGE_INTERVIEWS')
  )
);

drop policy if exists interview_proctoring_snapshots_insert on storage.objects;
create policy interview_proctoring_snapshots_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'interview-proctoring'
  and public.user_has_permission('MANAGE_INTERVIEWS')
);
