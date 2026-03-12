-- 031_export_jobs_and_exports_bucket.sql (idempotent)
-- export_jobs テーブルと exports Storage バケット。
-- 組織データエクスポートの履歴管理とファイル保管用。

-- ---------------------------------------------------------------------------
-- 1) export_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  file_path text,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_jobs_org_created_idx
  ON public.export_jobs (org_id, created_at DESC);

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: org の owner / executive_assistant のみ。
DROP POLICY IF EXISTS export_jobs_select_admin ON public.export_jobs;
CREATE POLICY export_jobs_select_admin ON public.export_jobs
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

-- INSERT/UPDATE/DELETE は API (service role) のみを想定するため、ポリシーは追加しない。
-- （service role は RLS をバイパスするため、クライアントからは直接書き込めない）

-- ---------------------------------------------------------------------------
-- 2) exports バケット（private）
-- path: org/{org_id}/exports/{job_id}.json
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- Read/Write: org の owner / executive_assistant のみ（Storage 経由で直接触る場合用）。
-- サインドURL経由の DL は API 側で制御する。

DROP POLICY IF EXISTS exports_objects_select ON storage.objects;
DROP POLICY IF EXISTS exports_objects_insert ON storage.objects;
DROP POLICY IF EXISTS exports_objects_update ON storage.objects;
DROP POLICY IF EXISTS exports_objects_delete ON storage.objects;

CREATE POLICY exports_objects_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'exports'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$' -- org_id
    AND public.is_org_member(split_part(name, '/', 2)::uuid)
  );

CREATE POLICY exports_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'exports'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

CREATE POLICY exports_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'exports'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    bucket_id = 'exports'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

CREATE POLICY exports_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'exports'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

