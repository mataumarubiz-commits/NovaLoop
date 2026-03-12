-- 028_content_templates_mvp2.sql
-- content_templates 拡張（デフォルト値 + 共通テンプレ + 権限調整）
-- - client_id を NULL 許可（共通テンプレ用）
-- - default_project_name / default_billable_flag / default_status / default_due_offset_days 追加
-- - RLS を owner / executive_assistant CRUD・member は select のみに変更

DO $$
BEGIN
  -- client_id を NULL 許可（既に NULL 可なら NOOP）
  BEGIN
    ALTER TABLE public.content_templates
      ALTER COLUMN client_id DROP NOT NULL;
  EXCEPTION
    WHEN others THEN
      -- カラムが存在しない / 既に条件を満たす場合は無視
      NULL;
  END;

  -- 新カラム追加（存在しない場合のみ）
  BEGIN
    ALTER TABLE public.content_templates
      ADD COLUMN IF NOT EXISTS default_project_name text,
      ADD COLUMN IF NOT EXISTS default_billable_flag boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS default_status text NOT NULL DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS default_due_offset_days int NOT NULL DEFAULT 0;
  EXCEPTION
    WHEN others THEN
      NULL;
  END;
END $$;

ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除
DROP POLICY IF EXISTS content_templates_select_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_insert_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_update_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_delete_org_members ON public.content_templates;

-- org メンバーは select 可
CREATE POLICY content_templates_select_org_members ON public.content_templates
  FOR SELECT
  USING (public.is_org_member(org_id));

-- owner / executive_assistant のみ insert/update/delete 可
CREATE POLICY content_templates_admin_write ON public.content_templates
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

