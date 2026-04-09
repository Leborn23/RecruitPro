# Permissions Model

This project enforces admin/authorization in Postgres (Supabase), not only in frontend UI.

## Roles

- `user`
- `admin`
- `super_admin`
- `owner`

Role data is stored in `public.user_roles`.

Role hierarchy:

- `owner` > `super_admin` > `admin` > `user`
- `owner` is a singleton role: only one owner can exist at a time.

## Permission Keys

- `VIEW_DASHBOARD`
- `MANAGE_POSITIONS`
- `SCREEN_RESUMES`
- `VIEW_CANDIDATES`
- `MANAGE_INTERVIEWS`
- `VIEW_SALARY`
- `MANAGE_SETTINGS`

`owner` and `super_admin` bypass permission checks in SQL (`public.user_has_permission`).

## user_roles Security

Direct table updates are blocked by RLS for normal clients. Only these RPCs can mutate roles/permissions:

- `public.admin_update_user_permissions(target_user_id uuid, new_permissions text[])`
- `public.admin_update_user_role(target_user_id uuid, new_role text)`

Both functions enforce:

- caller must be `owner` or `super_admin`
- invalid roles are rejected
- `admin` can be downgraded to `user`
- `super_admin` can be downgraded to `admin`/`user` with last-super-admin safeguards
- `owner` cannot be removed directly; owner must be transferred
- `super_admin` cannot promote other users to `owner`

Read access to `user_roles` is limited to own row by RLS (`user_roles_select_own`).
High-privilege user listing is exposed through controlled RPC:

- `public.admin_list_user_roles()`

## Initial Privileged Claim (Bootstrap)

`public.claim_initial_super_admin()` allows a logged-in user to become `super_admin` only when no privileged user exists.

Backend protections:

- advisory lock to avoid race conditions
- server-side existence check for current privileged users
- write performed in SQL function (not frontend direct update)

## RLS Coverage

RLS is enabled on:

- `user_roles`
- `active_positions`
- `candidates`
- `upcoming_interviews`
- `company_settings`
- `market_salaries`
- `resume_uploads`
- `chat_conversations`
- `chat_messages`

Policies map table operations to permission keys via SQL helper functions:

- `public.user_has_permission(required_permission text)`
- `public.is_super_admin()`
- `public.has_super_admin()`

## Operational Notes

- New auth users are auto-provisioned to `user_roles` via trigger on `auth.users`.
- Existing auth users are backfilled in migration.
- Audit target: `supabase/migrations` folder is the source of truth.
