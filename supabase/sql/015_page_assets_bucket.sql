-- 015_page_assets_bucket.sql (idempotent)
-- Pages 画像用 Storage バケット。path: {org_id}/pages/{page_id}/{filename}
-- 004 の is_org_member / user_role_in_org を利用。Read: org メンバー、Write: owner/executive_assistant

INSERT INTO storage.buckets (id, name, public)
VALUES ('page-assets', 'page-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS page_assets_objects_select ON storage.objects;
CREATE POLICY page_assets_objects_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_org_member(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS page_assets_objects_insert ON storage.objects;
CREATE POLICY page_assets_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

DROP POLICY IF EXISTS page_assets_objects_update ON storage.objects;
CREATE POLICY page_assets_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

DROP POLICY IF EXISTS page_assets_objects_delete ON storage.objects;
CREATE POLICY page_assets_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );
