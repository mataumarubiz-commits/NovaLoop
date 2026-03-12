-- 007_invoice_pdf_storage.sql (idempotent)
-- invoices.pdf_path 追加、invoices バケット作成、Storage RLS（暫定: authenticated 許可）

-- A) invoices.pdf_path（保管パス）
alter table invoices add column if not exists pdf_path text;

-- B) storage bucket "invoices"（private）
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do update set name = excluded.name, public = excluded.public;

-- C) storage.objects policies for bucket "invoices"（暫定: authenticated なら read/insert/update/delete）
--    重複回避のため drop if exists してから作成
drop policy if exists invoices_objects_select on storage.objects;
create policy invoices_objects_select on storage.objects
  for select using (bucket_id = 'invoices' and auth.role() = 'authenticated');

drop policy if exists invoices_objects_insert on storage.objects;
create policy invoices_objects_insert on storage.objects
  for insert with check (bucket_id = 'invoices' and auth.role() = 'authenticated');

drop policy if exists invoices_objects_update on storage.objects;
create policy invoices_objects_update on storage.objects
  for update using (bucket_id = 'invoices' and auth.role() = 'authenticated')
  with check (bucket_id = 'invoices' and auth.role() = 'authenticated');

drop policy if exists invoices_objects_delete on storage.objects;
create policy invoices_objects_delete on storage.objects
  for delete using (bucket_id = 'invoices' and auth.role() = 'authenticated');
