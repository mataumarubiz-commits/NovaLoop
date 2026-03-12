-- 003_storage_policies.sql

create policy vault_objects_read
  on storage.objects
  for select
  using (
    bucket_id = 'vault'
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );

create policy vault_objects_insert
  on storage.objects
  for insert
  with check (
    bucket_id = 'vault'
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );

create policy vault_objects_update
  on storage.objects
  for update
  using (
    bucket_id = 'vault'
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  )
  with check (
    bucket_id = 'vault'
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );