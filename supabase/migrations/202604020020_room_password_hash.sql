alter table public.upcoming_interviews
  add column if not exists room_password_hash text,
  add column if not exists room_password_salt text,
  add column if not exists room_password_set_at timestamptz;

comment on column public.upcoming_interviews.room_password_hash is
  '候选人考场密码哈希（sha256(password:salt)）';

comment on column public.upcoming_interviews.room_password_salt is
  '候选人考场密码盐值（hex）';

comment on column public.upcoming_interviews.room_password_set_at is
  '候选人考场密码设置时间';

with prepared as (
  select
    id,
    room_password,
    encode(gen_random_bytes(16), 'hex') as salt
  from public.upcoming_interviews
  where coalesce(room_password, '') <> ''
    and (room_password_hash is null or room_password_salt is null)
)
update public.upcoming_interviews u
set
  room_password_salt = p.salt,
  room_password_hash = encode(digest(p.room_password || ':' || p.salt, 'sha256'), 'hex'),
  room_password_set_at = coalesce(u.room_password_set_at, timezone('utc', now())),
  room_password = null
from prepared p
where u.id = p.id;
