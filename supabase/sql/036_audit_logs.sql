-- 036_audit_logs.sql (idempotent)
-- Pages 関連操作の監査ログ。page.create / page.update / page.duplicate / page.archive / page.restore / page.comment.create / page.comment.delete / page.revision.restore

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL DEFAULT 'page',
  resource_id uuid,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
  ON public.audit_logs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_resource_idx
  ON public.audit_logs (resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select_org_members ON public.audit_logs;
CREATE POLICY audit_logs_select_org_members ON public.audit_logs
  FOR SELECT
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.audit_logs.org_id
    )
  );

-- 挿入は API（service role）経由のみ想定。RLS で insert は owner/executive_assistant に限定
DROP POLICY IF EXISTS audit_logs_insert_admin ON public.audit_logs;
CREATE POLICY audit_logs_insert_admin ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.audit_logs.org_id
        and au.role in ('owner','executive_assistant')
    )
  );

COMMENT ON TABLE public.audit_logs IS 'Pages 操作の監査。action: page.create, page.update, page.duplicate, page.archive, page.restore, page.comment.create, page.comment.delete, page.revision.restore';
