-- 004_storage_policies.sql (idempotent)
-- invoices バケットの Storage policy を org/role で制限する。
-- Read: 同一 org のメンバーのみ。Write: owner / executive_assistant のみ。
-- path の prefix = org_id とする（storage.objects の name が path の場合: split_part(name, '/', 1) = org_id）。

-- ---------------------------------------------------------------------------
-- 1) SECURITY DEFINER 関数（app_users を RLS 再帰なく参照するため）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.user_id = auth.uid()
      AND au.org_id = is_org_member.org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_role_in_org(org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.role
  FROM public.app_users au
  WHERE au.user_id = auth.uid()
    AND au.org_id = user_role_in_org.org_id
  LIMIT 1;
$$;

-- 実行権限（authenticated から呼べるようにする）
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_in_org(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) 既存の invoices 用ポリシーを削除してから再作成
--    （007 / 003 で作った invoices_objects_* を置き換える）
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS invoices_objects_select ON storage.objects;
DROP POLICY IF EXISTS invoices_objects_insert ON storage.objects;
DROP POLICY IF EXISTS invoices_objects_update ON storage.objects;
DROP POLICY IF EXISTS invoices_objects_delete ON storage.objects;

-- Read: authenticated かつ パス先頭が org_id で、その org のメンバー
CREATE POLICY invoices_objects_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_org_member(split_part(name, '/', 1)::uuid)
  );

-- Insert: authenticated かつ パス先頭が org_id で、その org で owner/executive_assistant
CREATE POLICY invoices_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'invoices'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

-- Update: 同上
CREATE POLICY invoices_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'invoices'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    bucket_id = 'invoices'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

-- Delete: 同上
CREATE POLICY invoices_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'invoices'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );
