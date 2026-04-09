begin;

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.clean_permissions(input_permissions text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct permission order by permission),
    '{}'::text[]
  )
  from (
    select nullif(btrim(value), '') as permission
    from unnest(coalesce(input_permissions, '{}'::text[])) as value
  ) cleaned
  where permission is not null
$$;

create table if not exists public.user_roles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  permissions text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_user_roles_email_lower on public.user_roles (lower(email));
create index if not exists idx_user_roles_role on public.user_roles (role);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.role
  from public.user_roles ur
  where ur.id = auth.uid()
  limit 1
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;

create or replace function public.has_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
    from public.user_roles ur
    where ur.role = 'super_admin'
  )
$$;

create or replace function public.user_has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then false
    when public.is_super_admin() then true
    else exists (
      select 1
      from public.user_roles ur
      where ur.id = auth.uid()
        and required_permission = any(ur.permissions)
    )
  end
$$;

create or replace function public.sync_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.user_roles (id, email, role, permissions)
  values (
    new.id,
    coalesce(new.email, ''),
    'admin',
    '{}'::text[]
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sync_role on auth.users;
create trigger on_auth_user_created_sync_role
after insert on auth.users
for each row
execute function public.sync_new_user_role();

insert into public.user_roles (id, email, role, permissions)
select
  u.id,
  coalesce(u.email, ''),
  'admin',
  '{}'::text[]
from auth.users u
on conflict (id) do update
set email = excluded.email;

create table if not exists public.active_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text,
  location text,
  status text,
  threshold_score integer not null default 80 check (threshold_score between 0 and 100),
  technical_requirements text,
  max_age integer check (max_age is null or (max_age >= 16 and max_age <= 80)),
  min_edu text,
  min_exp integer not null default 0 check (min_exp >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_active_positions_created_at on public.active_positions (created_at desc);
create index if not exists idx_active_positions_status on public.active_positions (status);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  p_id uuid references public.active_positions(id) on delete set null,
  name text not null,
  title text,
  exp text,
  exp_years integer check (exp_years is null or exp_years >= 0),
  edu text,
  edu_level text,
  age integer check (age is null or (age >= 16 and age <= 100)),
  match integer check (match is null or (match between 0 and 100)),
  prev_company text,
  tag text,
  highlight text,
  city text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_candidates_created_at on public.candidates (created_at desc);
create index if not exists idx_candidates_position on public.candidates (p_id);
create index if not exists idx_candidates_match on public.candidates (match desc);

create table if not exists public.upcoming_interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  name text not null,
  stage text,
  position text,
  schedule_time timestamptz,
  interviewer text,
  location_type text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_upcoming_interviews_created_at on public.upcoming_interviews (created_at desc);
create index if not exists idx_upcoming_interviews_schedule_time on public.upcoming_interviews (schedule_time);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  ai_screening_enabled boolean not null default true,
  resume_privacy boolean not null default true,
  mandatory_feedback boolean not null default false,
  default_model text not null default 'GPT-4o',
  salary_drift_threshold integer not null default 75 check (salary_drift_threshold between 0 and 100),
  admin_avatar text,
  admin_name text,
  admin_role text,
  admin_email text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_company_settings_singleton on public.company_settings ((true));

insert into public.company_settings (
  ai_screening_enabled,
  resume_privacy,
  mandatory_feedback,
  default_model,
  salary_drift_threshold,
  admin_name,
  admin_role,
  admin_email
)
select
  true,
  true,
  false,
  'GPT-4o',
  75,
  'System Admin',
  'Super Admin',
  ''
where not exists (
  select 1 from public.company_settings
);

create table if not exists public.market_salaries (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  city text not null,
  min_salary integer not null check (min_salary >= 0),
  max_salary integer not null check (max_salary >= min_salary),
  average_salary integer generated always as ((min_salary + max_salary) / 2) stored,
  source text,
  collected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_market_salaries_average_salary on public.market_salaries (average_salary desc);
create index if not exists idx_market_salaries_role_city on public.market_salaries (role, city);

create table if not exists public.resume_uploads (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  position_id uuid references public.active_positions(id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_size_bytes bigint,
  mime_type text,
  status text not null default 'pending',
  parsed_payload jsonb,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_resume_uploads_candidate_id on public.resume_uploads (candidate_id);
create index if not exists idx_resume_uploads_position_id on public.resume_uploads (position_id);
create index if not exists idx_resume_uploads_uploaded_by on public.resume_uploads (uploaded_by);
create index if not exists idx_resume_uploads_created_at on public.resume_uploads (created_at desc);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  title text,
  status text not null default 'open',
  created_by uuid not null default auth.uid() references auth.users(id),
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_conversations_candidate_id on public.chat_conversations (candidate_id);
create index if not exists idx_chat_conversations_created_by on public.chat_conversations (created_by);
create index if not exists idx_chat_conversations_last_message_at on public.chat_conversations (last_message_at desc nulls last);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id),
  body text not null check (char_length(btrim(body)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  recalled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_chat_messages_conversation_id on public.chat_messages (conversation_id);
create index if not exists idx_chat_messages_created_at on public.chat_messages (created_at asc);
create index if not exists idx_chat_messages_sender_id on public.chat_messages (sender_id);

create or replace function public.touch_chat_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.chat_conversations
  set
    last_message_at = new.created_at,
    updated_at = timezone('utc', now())
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists trg_user_roles_updated_at on public.user_roles;
create trigger trg_user_roles_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_active_positions_updated_at on public.active_positions;
create trigger trg_active_positions_updated_at
before update on public.active_positions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_candidates_updated_at on public.candidates;
create trigger trg_candidates_updated_at
before update on public.candidates
for each row
execute function public.set_updated_at();

drop trigger if exists trg_upcoming_interviews_updated_at on public.upcoming_interviews;
create trigger trg_upcoming_interviews_updated_at
before update on public.upcoming_interviews
for each row
execute function public.set_updated_at();

drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_market_salaries_updated_at on public.market_salaries;
create trigger trg_market_salaries_updated_at
before update on public.market_salaries
for each row
execute function public.set_updated_at();

drop trigger if exists trg_resume_uploads_updated_at on public.resume_uploads;
create trigger trg_resume_uploads_updated_at
before update on public.resume_uploads
for each row
execute function public.set_updated_at();

drop trigger if exists trg_chat_conversations_updated_at on public.chat_conversations;
create trigger trg_chat_conversations_updated_at
before update on public.chat_conversations
for each row
execute function public.set_updated_at();

drop trigger if exists trg_chat_messages_touch_conversation on public.chat_messages;
create trigger trg_chat_messages_touch_conversation
after insert on public.chat_messages
for each row
execute function public.touch_chat_conversation_last_message();

alter table public.user_roles enable row level security;
alter table public.active_positions enable row level security;
alter table public.candidates enable row level security;
alter table public.upcoming_interviews enable row level security;
alter table public.company_settings enable row level security;
alter table public.market_salaries enable row level security;
alter table public.resume_uploads enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own
on public.user_roles
for select
to authenticated
using (id = auth.uid());

drop policy if exists active_positions_select on public.active_positions;
create policy active_positions_select
on public.active_positions
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('MANAGE_POSITIONS')
  or public.user_has_permission('SCREEN_RESUMES')
);

drop policy if exists active_positions_insert on public.active_positions;
create policy active_positions_insert
on public.active_positions
for insert
to authenticated
with check (public.user_has_permission('MANAGE_POSITIONS'));

drop policy if exists active_positions_update on public.active_positions;
create policy active_positions_update
on public.active_positions
for update
to authenticated
using (public.user_has_permission('MANAGE_POSITIONS'))
with check (public.user_has_permission('MANAGE_POSITIONS'));

drop policy if exists active_positions_delete on public.active_positions;
create policy active_positions_delete
on public.active_positions
for delete
to authenticated
using (public.user_has_permission('MANAGE_POSITIONS'));

drop policy if exists candidates_select on public.candidates;
create policy candidates_select
on public.candidates
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists candidates_insert on public.candidates;
create policy candidates_insert
on public.candidates
for insert
to authenticated
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists candidates_update on public.candidates;
create policy candidates_update
on public.candidates
for update
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists candidates_delete on public.candidates;
create policy candidates_delete
on public.candidates
for delete
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists upcoming_interviews_select on public.upcoming_interviews;
create policy upcoming_interviews_select
on public.upcoming_interviews
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists upcoming_interviews_insert on public.upcoming_interviews;
create policy upcoming_interviews_insert
on public.upcoming_interviews
for insert
to authenticated
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists upcoming_interviews_update on public.upcoming_interviews;
create policy upcoming_interviews_update
on public.upcoming_interviews
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists upcoming_interviews_delete on public.upcoming_interviews;
create policy upcoming_interviews_delete
on public.upcoming_interviews
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists company_settings_select on public.company_settings;
create policy company_settings_select
on public.company_settings
for select
to authenticated
using (public.user_has_permission('MANAGE_SETTINGS'));

drop policy if exists company_settings_update on public.company_settings;
create policy company_settings_update
on public.company_settings
for update
to authenticated
using (public.user_has_permission('MANAGE_SETTINGS'))
with check (public.user_has_permission('MANAGE_SETTINGS'));

drop policy if exists market_salaries_select on public.market_salaries;
create policy market_salaries_select
on public.market_salaries
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_SALARY')
);

drop policy if exists market_salaries_insert on public.market_salaries;
create policy market_salaries_insert
on public.market_salaries
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists market_salaries_update on public.market_salaries;
create policy market_salaries_update
on public.market_salaries
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists market_salaries_delete on public.market_salaries;
create policy market_salaries_delete
on public.market_salaries
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists resume_uploads_select on public.resume_uploads;
create policy resume_uploads_select
on public.resume_uploads
for select
to authenticated
using (
  public.user_has_permission('SCREEN_RESUMES')
  or public.user_has_permission('VIEW_CANDIDATES')
);

drop policy if exists resume_uploads_insert on public.resume_uploads;
create policy resume_uploads_insert
on public.resume_uploads
for insert
to authenticated
with check (
  public.user_has_permission('SCREEN_RESUMES')
  and uploaded_by = auth.uid()
);

drop policy if exists resume_uploads_update on public.resume_uploads;
create policy resume_uploads_update
on public.resume_uploads
for update
to authenticated
using (public.user_has_permission('SCREEN_RESUMES'))
with check (public.user_has_permission('SCREEN_RESUMES'));

drop policy if exists resume_uploads_delete on public.resume_uploads;
create policy resume_uploads_delete
on public.resume_uploads
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select
on public.chat_conversations
for select
to authenticated
using (
  public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists chat_conversations_insert on public.chat_conversations;
create policy chat_conversations_insert
on public.chat_conversations
for insert
to authenticated
with check (
  (public.user_has_permission('VIEW_CANDIDATES') or public.user_has_permission('MANAGE_INTERVIEWS'))
  and created_by = auth.uid()
);

drop policy if exists chat_conversations_update on public.chat_conversations;
create policy chat_conversations_update
on public.chat_conversations
for update
to authenticated
using (
  public.is_super_admin()
  or created_by = auth.uid()
)
with check (
  public.is_super_admin()
  or created_by = auth.uid()
);

drop policy if exists chat_conversations_delete on public.chat_conversations;
create policy chat_conversations_delete
on public.chat_conversations
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select
on public.chat_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.chat_conversations c
    where c.id = chat_messages.conversation_id
      and (
        public.user_has_permission('VIEW_CANDIDATES')
        or public.user_has_permission('MANAGE_INTERVIEWS')
      )
  )
);

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert
on public.chat_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.chat_conversations c
    where c.id = chat_messages.conversation_id
      and (
        public.user_has_permission('VIEW_CANDIDATES')
        or public.user_has_permission('MANAGE_INTERVIEWS')
      )
  )
);

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update
on public.chat_messages
for update
to authenticated
using (
  sender_id = auth.uid()
  and recalled_at is null
)
with check (sender_id = auth.uid());

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete
on public.chat_messages
for delete
to authenticated
using (public.is_super_admin());

create or replace function public.admin_list_user_roles()
returns table (
  id uuid,
  email text,
  role text,
  permissions text[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'only super admin can list user roles' using errcode = '42501';
  end if;

  return query
  select
    ur.id,
    ur.email,
    ur.role,
    ur.permissions,
    ur.created_at,
    ur.updated_at
  from public.user_roles ur
  order by ur.created_at asc;
end;
$$;

create or replace function public.admin_update_user_permissions(target_user_id uuid, new_permissions text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'only super admin can update permissions' using errcode = '42501';
  end if;

  if not exists (select 1 from public.user_roles where id = target_user_id) then
    raise exception 'target user not found';
  end if;

  update public.user_roles
  set
    permissions = public.clean_permissions(new_permissions),
    updated_at = timezone('utc', now())
  where id = target_user_id;
end;
$$;

create or replace function public.admin_update_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  super_admin_count integer;
  target_current_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'only super admin can update role' using errcode = '42501';
  end if;

  if new_role not in ('admin', 'super_admin') then
    raise exception 'invalid role value';
  end if;

  select role into target_current_role
  from public.user_roles
  where id = target_user_id;

  if target_current_role is null then
    raise exception 'target user not found';
  end if;

  if target_current_role = 'super_admin' and new_role = 'admin' then
    select count(*) into super_admin_count
    from public.user_roles
    where role = 'super_admin';

    if super_admin_count <= 1 then
      raise exception 'cannot demote the last super admin';
    end if;
  end if;

  update public.user_roles
  set
    role = new_role,
    updated_at = timezone('utc', now())
  where id = target_user_id;
end;
$$;

create or replace function public.claim_initial_super_admin()
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid;
  current_email text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.claim_initial_super_admin'));

  if exists (
    select 1
    from public.user_roles
    where role = 'super_admin'
  ) then
    return false;
  end if;

  select u.email
  into current_email
  from auth.users u
  where u.id = current_user_id;

  if current_email is null then
    raise exception 'current auth user not found';
  end if;

  insert into public.user_roles (id, email, role, permissions)
  values (
    current_user_id,
    current_email,
    'super_admin',
    '{}'::text[]
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = 'super_admin',
    updated_at = timezone('utc', now());

  return true;
end;
$$;

revoke all on function public.admin_list_user_roles() from public;
revoke all on function public.admin_update_user_permissions(uuid, text[]) from public;
revoke all on function public.admin_update_user_role(uuid, text) from public;
revoke all on function public.claim_initial_super_admin() from public;

grant execute on function public.admin_list_user_roles() to authenticated;
grant execute on function public.admin_update_user_permissions(uuid, text[]) to authenticated;
grant execute on function public.admin_update_user_role(uuid, text) to authenticated;
grant execute on function public.claim_initial_super_admin() to authenticated;
grant execute on function public.has_super_admin() to authenticated;

commit;
