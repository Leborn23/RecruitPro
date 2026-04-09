begin;

-- Normalize user_roles.role checks to support owner > super_admin > admin.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.user_roles'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table public.user_roles drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('admin', 'super_admin', 'owner'));

-- Normalize permissions column to jsonb array for stable role/permission operations.
do $$
declare
  col_type text;
begin
  select data_type
  into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'user_roles'
    and column_name = 'permissions';

  if col_type = 'ARRAY' then
    alter table public.user_roles
      alter column permissions type jsonb
      using to_jsonb(permissions);
  end if;
end
$$;

alter table public.user_roles
  alter column permissions set default '[]'::jsonb;

update public.user_roles
set permissions = '[]'::jsonb
where permissions is null;

alter table public.user_roles
  alter column permissions set not null;

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

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_user_role() = 'owner', false)
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'owner'), false)
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
    where ur.role in ('super_admin', 'owner')
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
        and coalesce(ur.permissions, '[]'::jsonb) ? required_permission
    )
  end
$$;

-- Remove direct broad-mutation policy; role writes should go through controlled RPC only.
drop policy if exists "Super admins can manage all roles" on public.user_roles;

drop policy if exists "Users can view their own role" on public.user_roles;
drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own
on public.user_roles
for select
to authenticated
using (id = auth.uid());

drop policy if exists user_roles_select_super_admin on public.user_roles;
create policy user_roles_select_super_admin
on public.user_roles
for select
to authenticated
using (public.is_super_admin());

create or replace function public.admin_list_user_roles()
returns table (
  id uuid,
  email text,
  role text,
  permissions jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'only owner or super admin can list user roles' using errcode = '42501';
  end if;

  insert into public.user_roles (id, email, role, permissions)
  select
    u.id,
    coalesce(u.email, ''),
    'admin',
    '[]'::jsonb
  from auth.users u
  on conflict (id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

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
declare
  caller_role text;
  target_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  caller_role := public.current_user_role();

  if caller_role not in ('owner', 'super_admin') then
    raise exception 'only owner or super admin can update permissions' using errcode = '42501';
  end if;

  select role into target_role
  from public.user_roles
  where id = target_user_id;

  if target_role is null then
    raise exception 'target user not found';
  end if;

  if caller_role = 'super_admin' and target_role = 'owner' then
    raise exception 'super admin cannot modify owner permissions' using errcode = '42501';
  end if;

  update public.user_roles
  set permissions = to_jsonb(public.clean_permissions(new_permissions)),
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
  caller_role text;
  target_current_role text;
  owner_count integer;
  super_admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  caller_role := public.current_user_role();

  if caller_role not in ('owner', 'super_admin') then
    raise exception 'only owner or super admin can update role' using errcode = '42501';
  end if;

  if new_role not in ('admin', 'super_admin', 'owner') then
    raise exception 'invalid role value';
  end if;

  select role into target_current_role
  from public.user_roles
  where id = target_user_id;

  if target_current_role is null then
    raise exception 'target user not found';
  end if;

  if caller_role = 'super_admin' then
    if target_current_role = 'owner' then
      raise exception 'super admin cannot modify owner role' using errcode = '42501';
    end if;

    if new_role = 'owner' then
      if exists (select 1 from public.user_roles where role = 'owner') then
        raise exception 'only owner can assign owner role' using errcode = '42501';
      end if;

      if target_user_id <> auth.uid() then
        raise exception 'super admin can only self-upgrade to owner when no owner exists' using errcode = '42501';
      end if;
    end if;
  end if;

  if target_current_role = 'owner' and new_role <> 'owner' then
    select count(*) into owner_count
    from public.user_roles
    where role = 'owner';

    if owner_count <= 1 then
      raise exception 'cannot demote the last owner';
    end if;
  end if;

  if target_current_role = 'super_admin' and new_role = 'admin' and caller_role = 'super_admin' then
    select count(*) into super_admin_count
    from public.user_roles
    where role = 'super_admin';

    if super_admin_count <= 1 then
      raise exception 'cannot demote the last super admin without owner';
    end if;
  end if;

  update public.user_roles
  set role = new_role,
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
    where role in ('super_admin', 'owner')
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
    '[]'::jsonb
  )
  on conflict (id) do update
  set email = excluded.email,
      role = 'super_admin',
      updated_at = timezone('utc', now());

  return true;
end;
$$;

revoke all on function public.admin_list_user_roles() from public;
revoke all on function public.admin_update_user_permissions(uuid, text[]) from public;
revoke all on function public.admin_update_user_role(uuid, text) from public;
revoke all on function public.claim_initial_super_admin() from public;
revoke all on function public.has_super_admin() from public;
revoke all on function public.is_owner() from public;

grant execute on function public.admin_list_user_roles() to authenticated;
grant execute on function public.admin_update_user_permissions(uuid, text[]) to authenticated;
grant execute on function public.admin_update_user_role(uuid, text) to authenticated;
grant execute on function public.claim_initial_super_admin() to authenticated;
grant execute on function public.has_super_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;

commit;
