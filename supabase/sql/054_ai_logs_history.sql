ALTER TABLE public.ai_logs
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS result_kind text,
  ADD COLUMN IF NOT EXISTS input_preview text,
  ADD COLUMN IF NOT EXISTS context_preview text,
  ADD COLUMN IF NOT EXISTS output_text text,
  ADD COLUMN IF NOT EXISTS apply_target text,
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP POLICY IF EXISTS ai_logs_select_org_members ON public.ai_logs;
DROP POLICY IF EXISTS ai_logs_select_safe_scope ON public.ai_logs;
CREATE POLICY ai_logs_select_safe_scope ON public.ai_logs
  FOR SELECT
  USING (
    public.is_org_member(org_id)
    AND (
      user_id = auth.uid()
      OR public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    )
  );
