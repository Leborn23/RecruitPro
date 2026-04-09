alter table public.upcoming_interviews
  add column if not exists room_password text;

comment on column public.upcoming_interviews.room_password is
  '候选人考场访问口令（MVP 阶段为明文，后续建议改为哈希存储）';
