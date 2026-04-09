begin;

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
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'only super admin can list user roles' using errcode = '42501';
  end if;

  insert into public.user_roles (id, email, role, permissions)
  select
    u.id,
    coalesce(u.email, ''),
    'admin',
    '{}'::text[]
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

drop policy if exists user_roles_select_super_admin on public.user_roles;
create policy user_roles_select_super_admin
on public.user_roles
for select
to authenticated
using (public.is_super_admin());

commit;
