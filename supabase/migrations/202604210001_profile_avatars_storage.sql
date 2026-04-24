insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do nothing;

drop policy if exists profile_avatars_select on storage.objects;
create policy profile_avatars_select
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-avatars');

drop policy if exists profile_avatars_insert on storage.objects;
create policy profile_avatars_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_avatars_update on storage.objects;
create policy profile_avatars_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_avatars_delete on storage.objects;
create policy profile_avatars_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
