-- 026_ai_logs.sql (idempotent)
-- AI呼び出しログテーブル。org / user / mode / action / 成否 を記録する。

CREATE TABLE IF NOT EXISTS public.ai_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  mode text NOT NULL,
  action text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_logs_org_created_idx
  ON public.ai_logs (org_id, created_at DESC);

ALTER TABLE public.ai_logs ENABLE ROW LEVEL SECURITY;

-- org メンバーは自分の org のログを参照可能
DROP POLICY IF EXISTS ai_logs_select_org_members ON public.ai_logs;
CREATE POLICY ai_logs_select_org_members ON public.ai_logs
  FOR SELECT
  USING (public.is_org_member(org_id));

-- owner / executive_assistant のみ挿入可能（APIで利用）
DROP POLICY IF EXISTS ai_logs_insert_admin ON public.ai_logs;
CREATE POLICY ai_logs_insert_admin ON public.ai_logs
  FOR INSERT
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner','executive_assistant'));

