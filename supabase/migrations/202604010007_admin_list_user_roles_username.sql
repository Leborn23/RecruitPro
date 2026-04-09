begin;

drop function if exists public.admin_list_user_roles();

create function public.admin_list_user_roles()
returns table (
  id uuid,
  username text,
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
  select
    ur.id,
    coalesce(
      nullif(trim(coalesce(au.raw_user_meta_data ->> 'name', au.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(split_part(ur.email, '@', 1), ''),
      ur.email,
      ur.id::text
    ) as username,
    ur.email,
    ur.role,
    ur.permissions,
    ur.created_at,
    ur.updated_at
  from public.user_roles as ur
  left join auth.users as au on au.id = ur.id
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

notify pgrst, 'reload schema';

commit;
