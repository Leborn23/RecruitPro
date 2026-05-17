-- Business modules are available to every authenticated company account.
-- Super admin / owner remains required only for account ownership and role management.

create or replace function public.business_permissions()
returns text[]
language sql
immutable
as $$
  select array[
    'VIEW_DASHBOARD',
    'MANAGE_POSITIONS',
    'SCREEN_RESUMES',
    'VIEW_CANDIDATES',
    'MANAGE_INTERVIEWS',
    'VIEW_SALARY',
    'MANAGE_SETTINGS'
  ]::text[]
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
    when required_permission = any(public.business_permissions()) then true
    else exists (
      select 1
      from public.user_roles ur
      where ur.id = auth.uid()
        and (
          case
            when jsonb_typeof(coalesce(ur.permissions, '[]'::jsonb)) = 'array'
              then coalesce(ur.permissions, '[]'::jsonb) ? required_permission
            else false
          end
        )
    )
  end
$$;

update public.user_roles
set permissions = (
  select jsonb_agg(distinct permission)
  from (
    select jsonb_array_elements_text(coalesce(user_roles.permissions, '[]'::jsonb)) as permission
    union
    select unnest(public.business_permissions()) as permission
  ) as merged_permissions
),
updated_at = timezone('utc', now())
where role in ('user', 'admin', 'super_admin', 'owner');

notify pgrst, 'reload schema';
