-- 003_pdf_storage.sql (idempotent)
-- invoices.pdf_path、invoices バケット、Storage policies（DO で既存時は作成しない）
-- 方針: 暫定で authenticated に read/write 許可。将来 org/role で絞る（decision-log に記載）

-- A) invoices.pdf_path
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_path text;

-- B) storage bucket "invoices" (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO UPDATE SET name = excluded.name, public = excluded.public;

-- C) storage.objects policies（既存なら作成しない）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_objects_select') THEN
    CREATE POLICY invoices_objects_select ON storage.objects FOR SELECT
      USING (bucket_id = 'invoices' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_objects_insert') THEN
    CREATE POLICY invoices_objects_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'invoices' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_objects_update') THEN
    CREATE POLICY invoices_objects_update ON storage.objects FOR UPDATE
      USING (bucket_id = 'invoices' AND auth.role() = 'authenticated')
      WITH CHECK (bucket_id = 'invoices' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'invoices_objects_delete') THEN
    CREATE POLICY invoices_objects_delete ON storage.objects FOR DELETE
      USING (bucket_id = 'invoices' AND auth.role() = 'authenticated');
  END IF;
END $$;
