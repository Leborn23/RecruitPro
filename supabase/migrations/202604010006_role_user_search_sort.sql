begin;

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('user', 'admin', 'super_admin', 'owner'));

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

  insert into public.user_roles as ur (id, email, role, permissions)
  select u.id, coalesce(u.email, ''), 'admin', '[]'::jsonb
  from auth.users as u
  on conflict on constraint user_roles_pkey do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

  return query
  select ur.id, ur.email, ur.role, ur.permissions, ur.created_at, ur.updated_at
  from public.user_roles as ur
  order by
    case ur.role
      when 'owner' then 4
      when 'super_admin' then 3
      when 'admin' then 2
      else 1
    end desc,
    ur.created_at asc,
    ur.email asc;
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
  owner_id uuid;
  super_admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  caller_role := public.current_user_role();

  if caller_role not in ('owner', 'super_admin') then
    raise exception 'only owner or super admin can update role' using errcode = '42501';
  end if;

  if new_role not in ('user', 'admin', 'super_admin', 'owner') then
    raise exception 'invalid role value';
  end if;

  select role into target_current_role
  from public.user_roles
  where id = target_user_id;

  if target_current_role is null then
    raise exception 'target user not found';
  end if;

  if new_role = 'owner' then
    if target_current_role = 'owner' then
      return;
    end if;

    select id into owner_id
    from public.user_roles
    where role = 'owner'
    limit 1;

    if owner_id is null then
      if caller_role = 'super_admin' and target_user_id <> auth.uid() then
        raise exception 'super admin can only self-upgrade to owner when no owner exists' using errcode = '42501';
      end if;

      update public.user_roles
      set role = 'owner',
          updated_at = timezone('utc', now())
      where id = target_user_id;

      return;
    end if;

    if caller_role <> 'owner' then
      raise exception 'only owner can transfer owner role' using errcode = '42501';
    end if;

    if owner_id <> auth.uid() then
      raise exception 'current operator is not the active owner' using errcode = '42501';
    end if;

    update public.user_roles
    set role = 'super_admin',
        updated_at = timezone('utc', now())
    where id = owner_id;

    update public.user_roles
    set role = 'owner',
        updated_at = timezone('utc', now())
    where id = target_user_id;

    return;
  end if;

  if target_current_role = 'owner' and new_role <> 'owner' then
    raise exception 'owner role must be transferred, cannot be removed directly';
  end if;

  if target_current_role = 'super_admin' and new_role in ('admin', 'user') and caller_role = 'super_admin' then
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

notify pgrst, 'reload schema';

commit;
